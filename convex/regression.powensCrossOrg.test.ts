/// <reference types="vite/client" />
/**
 * Regression: a bank account attached to another org than the one holding
 * the Powens connection that feeds it.
 *
 * One bank login carries the accounts of several companies of the group (a
 * Palatine access holding the current accounts of two SCIs). The connection
 * stays with the org that created it; each account is reassigned to its own
 * company (`cash.moveAccountToOrg`), which stamps `powensFeedOrgId`.
 *
 * Invariants under test:
 * - the move carries the transactions and refuses to break existing links;
 * - `powensFeedOrgId` is the ONLY thing that lets a Powens user write
 *   outside its own org — nothing else does;
 * - a reconnection (new connection id, new account ids) takes the moved
 *   account over instead of duplicating it back into the feed org;
 * - the connection keeps listing the account it feeds, from the feed org.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'

const CONNECTION = 'conn-1'
const POWENS_USER = 'powens-user-1'
const IBAN = 'FR7612345678901234567890123'

/** A Powens payload account, with an optional single transaction. */
function payloadAccount(
  opts: {
    powensAccountId?: string
    iban?: string
    txId?: string
    txDateMs?: number
  } = {},
) {
  return {
    powensAccountId: opts.powensAccountId ?? 'acct-1',
    accountName: 'CC SCI CHAPELLE',
    connectorName: 'Palatine',
    iban: opts.iban ?? IBAN,
    accountType: 'checking',
    balanceUnits: 1234.56,
    currency: 'EUR',
    transactions: opts.txId
      ? [
          {
            powensTxId: opts.txId,
            valueUnits: -56.78,
            dateMs: opts.txDateMs ?? Date.now() + 60_000,
            wording: 'LOYER',
            deleted: false,
          },
        ]
      : [],
  }
}

/**
 * Feed org (holds the Powens connection and one Palatine account) + target
 * org (the SCI the account really belongs to). Alice is admin on both, Bob
 * only on the feed org.
 */
async function setup() {
  const t: Harness = setupHarness()
  const alice = await createUser(t, 'alice@test.dev')
  const bob = await createUser(t, 'bob@test.dev')
  const feed = await createOrg(t, 'feed-org', [
    { userId: alice.userId, role: 'owner' },
    { userId: bob.userId, role: 'owner' },
  ])
  const target = await createOrg(t, 'target-org', [
    { userId: alice.userId, role: 'owner' },
  ])
  const accountId = await t.run(async (ctx) => {
    await ctx.db.insert('powensUsers', {
      orgId: feed.orgId,
      powensUserId: POWENS_USER,
      authToken: 'token',
      createdAt: Date.now(),
    })
    return await ctx.db.insert('bankAccounts', {
      orgId: feed.orgId,
      ownerCompanyId: feed.rootCompanyId,
      bankName: 'Palatine',
      label: 'CC SCI CHAPELLE',
      iban: IBAN,
      currency: 'EUR',
      powensConnectionId: CONNECTION,
      powensAccountId: 'acct-1',
    })
  })
  return { t, alice, bob, feed, target, accountId }
}

async function moveToTarget(
  ctx: Awaited<ReturnType<typeof setup>>,
): Promise<void> {
  await ctx.alice.as.mutation(api.cash.moveAccountToOrg, {
    bankAccountId: ctx.accountId,
    targetOrgId: ctx.target.orgId,
    ownerCompanyId: ctx.target.rootCompanyId,
  })
}

/** Ingests one webhook payload for the managed Powens user. */
async function ingest(
  t: Harness,
  accounts: Array<ReturnType<typeof payloadAccount>>,
  connectionId = CONNECTION,
) {
  return await t.mutation(internal.powens.ingestConnectionSync, {
    connectionId,
    powensUserId: POWENS_USER,
    accounts,
  })
}

describe('moveAccountToOrg', () => {
  test('carries the account, its transactions and the feed-org stamp', async () => {
    const s = await setup()
    await ingest(s.t, [payloadAccount({ txId: 'tx-1' })])

    await moveToTarget(s)

    const { account, transactions } = await s.t.run(async (ctx) => ({
      account: await ctx.db.get('bankAccounts', s.accountId),
      transactions: await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) =>
          q.eq('bankAccountId', s.accountId),
        )
        .collect(),
    }))
    expect(account?.orgId).toBe(s.target.orgId)
    expect(account?.ownerCompanyId).toBe(s.target.rootCompanyId)
    // The authorization that lets the feed org keep writing here.
    expect(account?.powensFeedOrgId).toBe(s.feed.orgId)
    expect(transactions).toHaveLength(1)
    expect(transactions[0].orgId).toBe(s.target.orgId)
  })

  test('coming back home clears the feed-org stamp', async () => {
    const s = await setup()
    await moveToTarget(s)
    await s.alice.as.mutation(api.cash.moveAccountToOrg, {
      bankAccountId: s.accountId,
      targetOrgId: s.feed.orgId,
      ownerCompanyId: s.feed.rootCompanyId,
    })
    const account = await s.t.run((ctx) =>
      ctx.db.get('bankAccounts', s.accountId),
    )
    expect(account?.orgId).toBe(s.feed.orgId)
    expect(account?.powensFeedOrgId).toBeUndefined()
  })

  test('refuses a matched transaction, a placement, a loan', async () => {
    const s = await setup()
    await ingest(s.t, [payloadAccount({ txId: 'tx-1' })])
    const txId = await s.t.run(async (ctx) => {
      const tx = await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) =>
          q.eq('bankAccountId', s.accountId),
        )
        .first()
      await ctx.db.patch('transactions', tx!._id, {
        matchStatus: 'matched',
        allocation: { kind: 'equity', targetId: 'whatever' },
      })
      return tx!._id
    })
    await expectConvexError(
      s.alice.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: s.target.rootCompanyId,
      }),
      'account_has_matched_transactions',
    )

    // Unmatched again, but the account now backs a placement.
    await s.t.run(async (ctx) => {
      await ctx.db.patch('transactions', txId, {
        matchStatus: 'unmatched',
        allocation: undefined,
      })
    })
    const dealId = await s.t.run(async (ctx) =>
      ctx.db.insert('deals', {
        orgId: s.feed.orgId,
        investorCompanyId: s.feed.rootCompanyId,
        targetCompanyId: await ctx.db.insert('companies', {
          orgId: s.feed.orgId,
          name: 'Cible',
          kind: 'portfolio',
        }),
        status: 'active',
        instrumentKind: 'capitalization_account',
        committedAmount: 100000,
        currency: 'EUR',
        bankAccountId: s.accountId,
      }),
    )
    await expectConvexError(
      s.alice.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: s.target.rootCompanyId,
      }),
      'account_used_by_deal',
    )
    await s.t.run((ctx) => ctx.db.delete('deals', dealId))

    await s.t.run(async (ctx) => {
      await ctx.db.insert('loans', {
        orgId: s.feed.orgId,
        label: 'Prêt test',
        lenderName: 'Banque',
        principalCents: 100000,
        signedDate: Date.now(),
        firstPaymentDate: Date.now(),
        durationMonths: 12,
        amortizationKind: 'constant_annuity',
        rateBps: 100,
        rateKind: 'fixed',
        paymentFrequency: 'monthly',
        status: 'active',
        bankAccountId: s.accountId,
      })
    })
    await expectConvexError(
      s.alice.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: s.target.rootCompanyId,
      }),
      'account_used_by_loan',
    )
  })

  test('needs admin on the target org and a group entity as owner', async () => {
    const s = await setup()
    // Bob is owner of the feed org but not a member of the target one.
    await expectConvexError(
      s.bob.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: s.target.rootCompanyId,
      }),
      'not_a_member',
    )
    const portfolioId = await createPortfolioCompany(
      s.t,
      s.target.orgId,
      'Une participation',
    )
    await expectConvexError(
      s.alice.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: portfolioId,
      }),
      'owner_not_group_entity',
    )
    // An entity of a third org is not an owner for the target either.
    await expectConvexError(
      s.alice.as.mutation(api.cash.moveAccountToOrg, {
        bankAccountId: s.accountId,
        targetOrgId: s.target.orgId,
        ownerCompanyId: s.feed.rootCompanyId,
      }),
      'owner_not_in_target_org',
    )
  })
})

describe('ingestion of a moved account', () => {
  test('keeps feeding it from the org holding the connection', async () => {
    const s = await setup()
    await moveToTarget(s)
    await ingest(s.t, [payloadAccount({ txId: 'tx-after-move' })])

    const { accounts, transactions } = await s.t.run(async (ctx) => ({
      accounts: await ctx.db.query('bankAccounts').collect(),
      transactions: await ctx.db.query('transactions').collect(),
    }))
    // No duplicate created back into the feed org.
    expect(accounts).toHaveLength(1)
    expect(accounts[0].orgId).toBe(s.target.orgId)
    expect(transactions).toHaveLength(1)
    // The transaction lands in the org the ACCOUNT belongs to.
    expect(transactions[0].orgId).toBe(s.target.orgId)
  })

  test('a reconnection takes the moved account over instead of duplicating it', async () => {
    const s = await setup()
    await moveToTarget(s)
    // Reconnection: brand-new connection id AND account id, same IBAN.
    await ingest(
      s.t,
      [
        payloadAccount({
          powensAccountId: 'acct-99',
          txId: 'tx-after-reconnect',
        }),
      ],
      'conn-2',
    )

    const accounts = await s.t.run((ctx) =>
      ctx.db.query('bankAccounts').collect(),
    )
    expect(accounts).toHaveLength(1)
    expect(accounts[0]._id).toBe(s.accountId)
    expect(accounts[0].orgId).toBe(s.target.orgId)
    expect(accounts[0].powensAccountId).toBe('acct-99')
    expect(accounts[0].powensConnectionId).toBe('conn-2')
  })

  test('an account of another org that nothing feeds from here is refused', async () => {
    const s = await setup()
    // Same account, moved WITHOUT the feed stamp (as a hand-made row would
    // be): the Powens user of the feed org must not write into it.
    await s.t.run(async (ctx) => {
      await ctx.db.patch('bankAccounts', s.accountId, {
        orgId: s.target.orgId,
        ownerCompanyId: s.target.rootCompanyId,
        powensFeedOrgId: undefined,
      })
    })
    await ingest(s.t, [payloadAccount({ txId: 'tx-refused' })])

    const transactions = await s.t.run((ctx) =>
      ctx.db.query('transactions').collect(),
    )
    expect(transactions).toHaveLength(0)
  })
})

describe('connection monitoring across orgs', () => {
  test('the connection lists the account it feeds, from the feed org', async () => {
    const s = await setup()
    await ingest(s.t, [payloadAccount()])
    await moveToTarget(s)

    const fromFeedOrg = await s.alice.as.query(api.powens.listConnections, {
      orgId: s.feed.orgId,
    })
    expect(fromFeedOrg).toHaveLength(1)
    // Feeding an account = not obsolete, so its health is still watched.
    expect(fromFeedOrg[0].health).not.toBe('obsolete')
    expect(fromFeedOrg[0].accountLabels).toEqual(['CC SCI CHAPELLE'])

    // The target org sees no connection at all — and above all no phantom
    // "untracked" one, which would read as a dead connection.
    const fromTargetOrg = await s.alice.as.query(api.powens.listConnections, {
      orgId: s.target.orgId,
    })
    expect(fromTargetOrg).toEqual([])
  })

  test('the catch-up sees the accounts of the connection, wherever they live', async () => {
    const s = await setup()
    await ingest(s.t, [payloadAccount({ txId: 'tx-1' })])
    await moveToTarget(s)

    const rows = await s.t.query(internal.powens.listAccountsForBackfill, {
      powensConnectionId: CONNECTION,
    })
    expect(rows.map((r) => r.bankAccountId)).toEqual([s.accountId])
  })
})
