/// <reference types="vite/client" />
/**
 * Regression: transaction → deal matching (pointage).
 *
 * Invariants (convex/lib/pointage.ts + KNOWN_ISSUES « Pointage »):
 * - `matchStatus === 'matched'` ⟺ `dealId != null` + `allocation.kind ===
 *   'deal'`; `reconciled` mirrors the deal matching.
 * - Every human decision appends a row to `matchingDecisions` — the log is
 *   append-only: an unmatch adds a row, it never rewrites the previous one.
 * - Cross-org matching is refused (`deal_wrong_org`).
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function pointageSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'pointage@test.dev')
  const org = await createOrg(t, 'org-pointage', [
    { userId: user.userId, role: 'owner' },
  ])
  const target = await createPortfolioCompany(t, org.orgId, 'Target')
  const dealId = await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'share',
    committedAmount: 10_000_000,
  })
  const accountId = await createBankAccount(t, org)
  const txId = await createTransaction(t, org.orgId, accountId, {
    direction: 'out',
    amount: 10_000_000,
    rawLabel: 'VIR TARGET',
  })
  return { t, user, org, dealId, txId }
}

describe('pointage: match / unmatch', () => {
  test('matching sets the full matched state and leaves the queue', async () => {
    const { t, user, org, dealId, txId } = await pointageSetup()

    const result = await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    // No pending forecast entry linked to the deal → nothing to follow up.
    expect(result).toEqual({ pendingEntry: null })

    const tx = await t.run(async (ctx) => ctx.db.get('transactions', txId))
    expect(tx).toMatchObject({
      matchStatus: 'matched',
      dealId,
      allocation: { kind: 'deal', targetId: dealId },
      reconciled: true,
      reconciledBy: user.userId,
    })
    expect(tx?.reconciledAt).toBeTypeOf('number')

    const queue = await user.as.query(api.transactions.listUnmatched, {
      orgId: org.orgId,
    })
    expect(queue.map((row) => row._id)).not.toContain(txId)

    // The deal's realized metrics see the matched flow (Versé).
    const deals = await user.as.query(api.deals.list, { orgId: org.orgId })
    expect(deals[0].paidActual).toBe(10_000_000)
  })

  test('unmatching restores the unmatched state completely', async () => {
    const { t, user, org, dealId, txId } = await pointageSetup()

    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    await user.as.mutation(api.transactions.unmatchTransaction, {
      transactionId: txId,
    })

    const tx = await t.run(async (ctx) => ctx.db.get('transactions', txId))
    expect(tx).toMatchObject({ matchStatus: 'unmatched', reconciled: false })
    expect(tx?.dealId).toBeUndefined()
    expect(tx?.allocation).toBeUndefined()
    expect(tx?.reconciledBy).toBeUndefined()
    expect(tx?.reconciledAt).toBeUndefined()

    const queue = await user.as.query(api.transactions.listUnmatched, {
      orgId: org.orgId,
    })
    expect(queue.map((row) => row._id)).toContain(txId)
  })

  test('matching a transaction to a deal of another org is refused', async () => {
    const { t, user, txId } = await pointageSetup()
    const otherOrg = await createOrg(t, 'org-other', [
      { userId: user.userId, role: 'owner' },
    ])
    const otherTarget = await createPortfolioCompany(
      t,
      otherOrg.orgId,
      'Other target',
    )
    const otherDeal = await user.as.mutation(api.deals.create, {
      orgId: otherOrg.orgId,
      investorCompanyId: otherOrg.rootCompanyId,
      targetCompanyId: otherTarget,
      instrumentKind: 'share',
    })

    await expectConvexError(
      user.as.mutation(api.transactions.matchTransaction, {
        transactionId: txId,
        dealId: otherDeal,
      }),
      'deal_wrong_org',
    )
  })
})

describe('pointage: deal-linked forecast entry follow-up', () => {
  test('matching returns the closest pending entry of the deal (same direction)', async () => {
    const { user, org, dealId, txId } = await pointageSetup()
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000

    // Same direction, 20 days away — outside suggestForecastMatches' ±10d
    // window on purpose: the deal link alone must surface it.
    const farEntry = await user.as.mutation(api.forecasts.createManualEntry, {
      orgId: org.orgId,
      date: now - 20 * DAY,
      amountCents: 10_000_000,
      direction: 'out',
      confidence: 'expected',
      label: 'Appel de fonds T3',
      dealId,
    })
    // Closer by date but wrong direction — never suggested.
    await user.as.mutation(api.forecasts.createManualEntry, {
      orgId: org.orgId,
      date: now - 1 * DAY,
      amountCents: 5_000_000,
      direction: 'in',
      confidence: 'expected',
      label: 'Distribution',
      dealId,
    })

    const result = await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    expect(result.pendingEntry).toMatchObject({
      _id: farEntry,
      label: 'Appel de fonds T3',
      amountCents: 10_000_000,
      direction: 'out',
    })
  })
})

describe('pointage: matchingDecisions is append-only', () => {
  test('match then unmatch appends two rows and never rewrites the first', async () => {
    const { t, user, org, dealId, txId } = await pointageSetup()

    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    const afterMatch = await t.run(async (ctx) =>
      ctx.db
        .query('matchingDecisions')
        .withIndex('by_transaction', (q) => q.eq('transactionId', txId))
        .collect(),
    )
    expect(afterMatch).toHaveLength(1)
    expect(afterMatch[0]).toMatchObject({
      orgId: org.orgId,
      decision: 'matched',
      dealId,
      source: 'manual',
      decidedBy: user.userId,
    })

    await user.as.mutation(api.transactions.unmatchTransaction, {
      transactionId: txId,
    })
    const afterUnmatch = await t.run(async (ctx) =>
      ctx.db
        .query('matchingDecisions')
        .withIndex('by_transaction', (q) => q.eq('transactionId', txId))
        .collect(),
    )
    expect(afterUnmatch).toHaveLength(2)
    // The first decision is untouched (append-only log, agent dataset).
    const first = afterUnmatch.find((row) => row._id === afterMatch[0]._id)
    expect(first).toMatchObject({ decision: 'matched', dealId })
    const second = afterUnmatch.find((row) => row._id !== afterMatch[0]._id)
    expect(second).toMatchObject({ decision: 'unmatched' })
    expect(second?.dealId).toBeUndefined()
  })
})
