/// <reference types="vite/client" />
/**
 * Regression: connecting a bank Albo OS has never seen, and the history it
 * comes with.
 *
 * Two failures seen in production on a Natixis Wealth Management access
 * connected to CALTE (09/2026):
 * - the connector was absent from a hard-coded connector → org mapping, so
 *   the ingestion threw, the whole webhook transaction was rolled back and
 *   NOTHING appeared — a new bank required a deploy;
 * - the cutover floor sat at the account's creation date, so the history
 *   Powens delivered with that first sync was dropped on the floor.
 *
 * The mapping is gone since: no bank and no company is named in the code.
 *
 * Invariants under test:
 * - any connector creates the account in the org of the Powens user, under
 *   its root company, named after the connector — and a second org
 *   connecting the same bank gets its own account, sealed from the first;
 * - an account only Powens feeds has no cutover floor: everything delivered
 *   is ingested, however old;
 * - an account carrying a history of another origin (manual entry, CSV
 *   import) keeps its floor — Powens never re-ingests it by its own means.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness, TestOrg } from './regression.setup'

const CONNECTION = 'conn-natixis'
const POWENS_USER = 'powens-user-natixis'
const DAY_MS = 24 * 60 * 60 * 1000

/** A Powens payload account, with an optional single transaction. */
function payloadAccount(
  opts: {
    connectorName?: string
    powensAccountId?: string
    txId?: string
    txDateMs?: number
  } = {},
) {
  return {
    powensAccountId: opts.powensAccountId ?? 'acct-natixis-1',
    accountName: 'COMPTE TITRES',
    connectorName: opts.connectorName ?? 'Natixis Wealth Management',
    accountType: 'market',
    balanceUnits: 4321,
    currency: 'EUR',
    transactions: opts.txId
      ? [
          {
            powensTxId: opts.txId,
            valueUnits: -120.5,
            dateMs: opts.txDateMs ?? Date.now(),
            wording: 'FRAIS DE TENUE DE COMPTE',
            deleted: false,
          },
        ]
      : [],
  }
}

async function setup(): Promise<{ t: Harness; org: TestOrg }> {
  const t: Harness = setupHarness()
  const alice = await createUser(t, 'alice@test.dev')
  const org = await createOrg(t, 'calte', [
    { userId: alice.userId, role: 'owner' },
  ])
  await t.run(async (ctx) => {
    await ctx.db.insert('powensUsers', {
      orgId: org.orgId,
      powensUserId: POWENS_USER,
      authToken: 'token',
      createdAt: Date.now(),
    })
  })
  return { t, org }
}

async function ingest(
  t: Harness,
  accounts: Array<ReturnType<typeof payloadAccount>>,
) {
  return await t.mutation(internal.powens.ingestConnectionSync, {
    connectionId: CONNECTION,
    powensUserId: POWENS_USER,
    accounts,
  })
}

describe('new bank', () => {
  test('creates the account in the org of the connection, under its root company', async () => {
    const { t, org } = await setup()

    await ingest(t, [payloadAccount()])

    const accounts = await t.run(async (ctx) =>
      ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', org.orgId))
        .collect(),
    )
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      bankName: 'Natixis Wealth Management',
      label: 'COMPTE TITRES',
      ownerCompanyId: org.rootCompanyId,
      powensConnectionId: CONNECTION,
      powensAccountId: 'acct-natixis-1',
      accountKind: 'cto',
    })
  })

  test('a second org connecting the same bank is sealed from the first', async () => {
    const { t, org } = await setup()
    await ingest(t, [
      payloadAccount({ connectorName: 'Banque Palatine', powensAccountId: 'acct-pal' }),
    ])
    // Another org — a third party, or a subsidiary with its own login —
    // connects the very same bank under its own Powens user.
    const other = await createOrg(t, 'other-org', [
      { userId: (await createUser(t, 'carol@test.dev')).userId, role: 'owner' },
    ])
    await t.run(async (ctx) => {
      await ctx.db.insert('powensUsers', {
        orgId: other.orgId,
        powensUserId: 'powens-user-other',
        authToken: 'token-other',
        createdAt: Date.now(),
      })
    })
    await t.mutation(internal.powens.ingestConnectionSync, {
      connectionId: 'conn-other',
      powensUserId: 'powens-user-other',
      accounts: [
        {
          ...payloadAccount({
            connectorName: 'Banque Palatine',
            powensAccountId: 'acct-other',
            txId: 'tx-other',
          }),
          accountName: 'COMPTE COURANT',
        },
      ],
    })

    const theirs = await t.run(async (ctx) =>
      ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', other.orgId))
        .collect(),
    )
    expect(theirs).toHaveLength(1)
    expect(theirs[0]).toMatchObject({
      bankName: 'Banque Palatine',
      ownerCompanyId: other.rootCompanyId,
      powensAccountId: 'acct-other',
    })
    const ours = await t.run(async (ctx) =>
      ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', org.orgId))
        .collect(),
    )
    expect(ours).toHaveLength(1)
    expect(ours[0].powensAccountId).toBe('acct-pal')
  })
})

describe('cutover floor', () => {
  test('an account only Powens feeds ingests the history it is handed', async () => {
    const { t } = await setup()

    // First sync: the account is created by this very payload, which also
    // carries a transaction two months older than it.
    const summary = await ingest(t, [
      payloadAccount({ txId: 'tx-old', txDateMs: Date.now() - 60 * DAY_MS }),
    ])

    expect(summary).toMatchObject({ inserted: 1, skipped: 0 })
  })

  test('a history of another origin keeps the floor at the account creation', async () => {
    const { t, org } = await setup()
    await ingest(t, [payloadAccount()])
    const accountId = await t.run(async (ctx) => {
      const account = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', org.orgId))
        .first()
      if (!account) throw new Error('account not created')
      // Statements imported by hand, older than the connection.
      await ctx.db.insert('transactions', {
        orgId: org.orgId,
        bankAccountId: account._id,
        direction: 'out',
        amount: 5000,
        transactionDate: Date.now() - 90 * DAY_MS,
        rawLabel: 'RELEVE PAPIER',
        source: 'imported',
        matchStatus: 'unmatched',
        reconciled: false,
      })
      return account._id
    })

    const summary = await ingest(t, [
      payloadAccount({ txId: 'tx-old', txDateMs: Date.now() - 60 * DAY_MS }),
    ])

    expect(summary).toMatchObject({ inserted: 0, skipped: 1 })
    const txs = await t.run(async (ctx) =>
      ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) => q.eq('bankAccountId', accountId))
        .collect(),
    )
    expect(txs).toHaveLength(1)
  })
})

describe('catch-up scheduling', () => {
  /** How many catch-up actions the ingestion has scheduled so far, as Convex
   * records them in the system table. */
  async function backfillJobs(t: Harness): Promise<number> {
    return await t.run(async (ctx) => {
      const rows = await ctx.db.system.query('_scheduled_functions').collect()
      return rows.filter((r) => r.name === 'powens:backfillConnection').length
    })
  }

  /** The connection is ALREADY tracked and healthy — what the 6h poll leaves
   * behind. The health transition therefore cannot fire. */
  async function trackedConnection(t: Harness, org: TestOrg): Promise<void> {
    await t.run(async (ctx) => {
      await ctx.db.insert('powensConnections', {
        orgId: org.orgId,
        powensConnectionId: CONNECTION,
        connectorName: 'Natixis Wealth Management',
        lastPolledAt: Date.now(),
      })
    })
  }

  test('a new account on an already healthy connection is caught up', async () => {
    const { t, org } = await setup()
    await trackedConnection(t, org)

    await ingest(t, [payloadAccount()])

    expect(await backfillJobs(t)).toBe(1)
  })

  test('a later sync on the same account schedules nothing more', async () => {
    const { t, org } = await setup()
    await trackedConnection(t, org)
    await ingest(t, [payloadAccount()])

    await ingest(t, [payloadAccount({ txId: 'tx-1' })])

    expect(await backfillJobs(t)).toBe(1)
  })
})
