/// <reference types="vite/client" />
/**
 * Regression: the same bank connected TWICE, and the duplicate transactions
 * it imported.
 *
 * Seen in production on the Natixis Wealth Management access of CALTE
 * (09/2026): two live Powens connections delivered the very same account.
 * Each hands out its own `powensAccountId`, so each takes the account over
 * from the other at every webhook (matching by IBAN), and each delivers the
 * same real movements under its own `powensTxId`. Dedup is by `powensTxId`
 * alone — nothing downstream could tell the two series apart, so every
 * movement landed twice.
 *
 * The invariant this pins down: **one account, one live connection.** Taking
 * an account over stays the rule when the connection feeding it is dead (that
 * is a reconnection, and it is why matching by IBAN exists at all); it is
 * refused when that connection is still alive.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness, TestOrg } from './regression.setup'
import type { Id } from './_generated/dataModel'

const IBAN = 'FR7630788001000123456789012'
const POWENS_USER = 'powens-user-natixis'
/** The two accesses to the same bank, as Powens numbers them. */
const CONN_A = 'conn-natixis-a'
const CONN_B = 'conn-natixis-b'

/** The same real account, as delivered by one connection or the other: same
 * IBAN, different Powens account id, different transaction ids. */
function payload(opts: { powensAccountId: string; txId: string }) {
  return {
    powensAccountId: opts.powensAccountId,
    accountName: 'CALTE',
    connectorName: 'Natixis Wealth Management',
    accountType: 'market',
    balanceUnits: 4321,
    currency: 'EUR',
    iban: IBAN,
    transactions: [
      {
        powensTxId: opts.txId,
        valueUnits: -120.5,
        dateMs: Date.now(),
        wording: 'FRAIS DE TENUE DE COMPTE',
        deleted: false,
      },
    ],
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
  connectionId: string,
  accounts: Array<ReturnType<typeof payload>>,
) {
  return await t.mutation(internal.powens.ingestConnectionSync, {
    connectionId,
    powensUserId: POWENS_USER,
    accounts,
  })
}

/** The org's single bank account, plus the transactions it carries. */
async function accountState(t: Harness, org: TestOrg) {
  return await t.run(async (ctx) => {
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', org.orgId))
      .collect()
    const txs = await Promise.all(
      accounts.map((a) =>
        ctx.db
          .query('transactions')
          .withIndex('by_account_date', (q) => q.eq('bankAccountId', a._id))
          .collect(),
      ),
    )
    return { accounts, txs: txs.flat() }
  })
}

/** First sync: connection A creates the account and its tracking row, which
 * is healthy by construction (`upsertConnectionStatus` stamps it). */
async function connectedViaA(t: Harness) {
  await ingest(t, CONN_A, [
    payload({ powensAccountId: 'acct-a', txId: 'tx-a-1' }),
  ])
}

describe('a second live connection on the same account', () => {
  test('is ignored instead of importing the same movements twice', async () => {
    const { t, org } = await setup()
    await connectedViaA(t)

    const summary = await ingest(t, CONN_B, [
      payload({ powensAccountId: 'acct-b', txId: 'tx-b-1' }),
    ])

    // The payload is skipped whole — nothing of connection B is written.
    expect(summary).toMatchObject({ inserted: 0, patched: 0, skipped: 1 })
    const { accounts, txs } = await accountState(t, org)
    expect(accounts).toHaveLength(1)
    // The account stays on the connection that already feeds it.
    expect(accounts[0]).toMatchObject({
      powensConnectionId: CONN_A,
      powensAccountId: 'acct-a',
    })
    // And it carries ONE movement, not the same one twice.
    expect(txs.map((tx) => tx.powensTxId)).toEqual(['tx-a-1'])
  })

  test('stays ignored sync after sync, without ever creating a second account', async () => {
    const { t, org } = await setup()
    await connectedViaA(t)

    await ingest(t, CONN_B, [
      payload({ powensAccountId: 'acct-b', txId: 'tx-b-1' }),
    ])
    await ingest(t, CONN_B, [
      payload({ powensAccountId: 'acct-b', txId: 'tx-b-2' }),
    ])

    const { accounts, txs } = await accountState(t, org)
    expect(accounts).toHaveLength(1)
    expect(txs).toHaveLength(1)
  })
})

describe('a reconnection still takes the account over', () => {
  test('when the connection feeding it needs re-authentication', async () => {
    const { t, org } = await setup()
    await connectedViaA(t)
    // What a broken access looks like — and the very reason it gets
    // reconnected under a new connection id.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('powensConnections')
        .withIndex('by_powens_connection', (q) =>
          q.eq('powensConnectionId', CONN_A),
        )
        .unique()
      if (!row) throw new Error('connection A not tracked')
      await ctx.db.patch('powensConnections', row._id, { state: 'wrongpass' })
    })

    await ingest(t, CONN_B, [
      payload({ powensAccountId: 'acct-b', txId: 'tx-b-1' }),
    ])

    const { accounts, txs } = await accountState(t, org)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      powensConnectionId: CONN_B,
      powensAccountId: 'acct-b',
    })
    expect(txs.map((tx) => tx.powensTxId).sort()).toEqual(['tx-a-1', 'tx-b-1'])
  })

  test('when the connection feeding it is not tracked at all', async () => {
    const { t, org } = await setup()
    await connectedViaA(t)
    // No row = nothing monitors that connection (an old, unmanaged Powens
    // user, or a connection the poll has since dropped). The takeover is what
    // puts the account back under watch.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('powensConnections')
        .withIndex('by_powens_connection', (q) =>
          q.eq('powensConnectionId', CONN_A),
        )
        .unique()
      if (row) await ctx.db.delete('powensConnections', row._id)
    })

    await ingest(t, CONN_B, [
      payload({ powensAccountId: 'acct-b', txId: 'tx-b-1' }),
    ])

    const { accounts } = await accountState(t, org)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].powensConnectionId).toBe(CONN_B)
  })
})

describe('the guard is per account, not per bank', () => {
  test('a second access delivering a DIFFERENT account is ingested normally', async () => {
    const { t, org } = await setup()
    await connectedViaA(t)

    // Two logins at the same bank is a legitimate setup (the `customLabel`
    // field exists to tell them apart). Only the same ACCOUNT twice is the
    // problem.
    await ingest(t, CONN_B, [
      {
        ...payload({ powensAccountId: 'acct-b', txId: 'tx-b-1' }),
        accountName: 'CALTIMO',
        iban: 'FR7630788001000999888777666',
      },
    ])

    const { accounts, txs } = await accountState(t, org)
    expect(accounts).toHaveLength(2)
    expect(txs).toHaveLength(2)
  })
})

/**
 * The cleanup side: `migrations/dedupPowensTransactions` removes what got in
 * before the guard existed. Its whole difficulty is that a perfect duplicate
 * also occurs for real (two identical transfers on the same day), so it must
 * never destroy a human decision — when in doubt it leaves the group alone.
 */
describe('dedupPowensTransactions', () => {
  const DATE = Date.parse('2026-09-01T00:00:00Z')

  async function account(t: Harness, org: TestOrg) {
    return await createBankAccount(t, org)
  }

  /** One Powens-delivered copy of the same movement. */
  async function copy(
    t: Harness,
    org: TestOrg,
    bankAccountId: Id<'bankAccounts'>,
    extra: Record<string, unknown> = {},
  ): Promise<Id<'transactions'>> {
    return await t.run(async (ctx) =>
      ctx.db.insert('transactions', {
        orgId: org.orgId,
        bankAccountId,
        direction: 'out',
        amount: 12050,
        transactionDate: DATE,
        rawLabel: 'FRAIS DE TENUE DE COMPTE',
        source: 'powens',
        powensTxId: `tx-${Math.random()}`,
        matchStatus: 'unmatched',
        reconciled: false,
        ...extra,
      }),
    )
  }

  async function plan(t: Harness, bankAccountId: Id<'bankAccounts'>) {
    return await t.query(internal.migrations.dedupPowensTransactions.dryRun, {
      bankAccountId,
    })
  }

  test('keeps the oldest copy when neither carries anything', async () => {
    const { t, org } = await setup()
    const bankAccountId = await account(t, org)
    const first = await copy(t, org, bankAccountId)
    await copy(t, org, bankAccountId)

    const dry = await plan(t, bankAccountId)
    expect(dry.expectedDeletions).toBe(1)
    expect(dry.groups[0]).toMatchObject({ reason: 'oldest' })
    expect(dry.groups[0].keep?._id).toBe(first)

    await t.mutation(internal.migrations.dedupPowensTransactions.apply, {
      bankAccountId,
      expectedDeletions: 1,
    })

    const after = await t.query(
      internal.migrations.dedupPowensTransactions.verify,
      { bankAccountId },
    )
    expect(after).toMatchObject({
      transactions: 1,
      remainingDuplicates: 0,
      danglingDecisions: 0,
    })
  })

  test('keeps the copy another row points at, however recent', async () => {
    const { t, org } = await setup()
    const bankAccountId = await account(t, org)
    await copy(t, org, bankAccountId)
    const pointed = await copy(t, org, bankAccountId)
    // A forecast entry claiming that exact row as its realization.
    await t.run(async (ctx) => {
      await ctx.db.insert('forecastEntries', {
        orgId: org.orgId,
        date: DATE,
        amountCents: 12050,
        direction: 'out',
        confidence: 'confirmed',
        status: 'realized',
        label: 'Frais',
        overridden: false,
        realizedTransactionId: pointed,
        currency: 'EUR',
      })
    })

    const dry = await plan(t, bankAccountId)
    expect(dry.groups[0]).toMatchObject({ reason: 'referenced' })
    expect(dry.groups[0].keep?._id).toBe(pointed)
  })

  test('leaves the group alone when the copies carry DIFFERENT decisions', async () => {
    const { t, org } = await setup()
    const bankAccountId = await account(t, org)
    await copy(t, org, bankAccountId, { matchStatus: 'charge' })
    await copy(t, org, bankAccountId, { matchStatus: 'internal_transfer' })

    const dry = await plan(t, bankAccountId)
    expect(dry).toMatchObject({ expectedDeletions: 0, needsReview: 1 })
    expect(dry.groups[0].review).toHaveLength(2)
  })

  test('refuses to apply a plan the operator has not read', async () => {
    const { t, org } = await setup()
    const bankAccountId = await account(t, org)
    await copy(t, org, bankAccountId)
    await copy(t, org, bankAccountId)

    await expectConvexError(
      t.mutation(internal.migrations.dedupPowensTransactions.apply, {
        bankAccountId,
        expectedDeletions: 5,
      }),
      'plan_changed:expected=5:actual=1',
    )
  })

  test('never touches a row Powens did not deliver', async () => {
    const { t, org } = await setup()
    const bankAccountId = await account(t, org)
    await copy(t, org, bankAccountId)
    // Same movement, entered by hand or imported from a statement.
    await t.run(async (ctx) => {
      await ctx.db.insert('transactions', {
        orgId: org.orgId,
        bankAccountId,
        direction: 'out',
        amount: 12050,
        transactionDate: DATE,
        rawLabel: 'FRAIS DE TENUE DE COMPTE',
        source: 'imported',
        matchStatus: 'unmatched',
        reconciled: false,
      })
    })

    const dry = await plan(t, bankAccountId)
    expect(dry.expectedDeletions).toBe(0)
  })
})
