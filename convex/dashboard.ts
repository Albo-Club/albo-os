/**
 * Dashboard aggregates for an org (`/app/$orgSlug`). A single reactive
 * query: counts participations, sums deployed/distributed from the
 * deal-matched transactions, cash from the real balances, and the
 * estimated NAV from each deal's latest valuation (fallback: amount paid
 * if no valuation). The org-scoped `.collect()` calls are acceptable at
 * this tool's scale (2 users, low volumes).
 */

import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

const RECENT_TX = 5

export const getDashboard = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    // 1. Org deals (exited ones stay in deployed/distributed).
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const activeDeals = deals.filter(
      (deal) => deal.status === 'active' || deal.status === 'partially_exited',
    )

    // 2. Transactions: deployed (out) / distributed (in) per matched deal.
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .collect()
    const paidByDeal = new Map<string, number>()
    const receivedByDeal = new Map<string, number>()
    for (const tx of txs) {
      if (!tx.dealId) continue
      const map = tx.direction === 'out' ? paidByDeal : receivedByDeal
      map.set(tx.dealId, (map.get(tx.dealId) ?? 0) + tx.amount)
    }
    let deployedCents = 0
    let distributedCents = 0
    for (const deal of deals) {
      deployedCents += paidByDeal.get(deal._id) ?? 0
      distributedCents += receivedByDeal.get(deal._id) ?? 0
    }

    // 3. Estimated NAV: latest valuation per active deal, fallback amount
    //    paid (navIsPartial = at least one active deal without valuation).
    let navCents = 0
    let navIsPartial = false
    for (const deal of activeDeals) {
      const lastValuation = await ctx.db
        .query('valuations')
        .withIndex('by_deal_asof', (q) => q.eq('dealId', deal._id))
        .order('desc')
        .first()
      if (lastValuation) {
        navCents += lastValuation.fairValue
      } else {
        navCents += paidByDeal.get(deal._id) ?? 0
        navIsPartial = true
      }
    }

    // 4. Cash: real EUR balances of non-archived accounts.
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    let cashCents = 0
    for (const account of accounts) {
      if (account.archivedAt || account.currency !== 'EUR') continue
      cashCents += account.currentBalance ?? 0
    }

    // 5. Breakdown of deployed capital by instrument (active deals).
    const byInstrument = new Map<string, number>()
    for (const deal of activeDeals) {
      const paid = paidByDeal.get(deal._id) ?? 0
      if (paid <= 0) continue
      byInstrument.set(
        deal.instrumentKind,
        (byInstrument.get(deal.instrumentKind) ?? 0) + paid,
      )
    }

    // 6. Participations = distinct target companies of active deals.
    const participationsCount = new Set(
      activeDeals.map((deal) => deal.targetCompanyId),
    ).size

    // 7. Recent activity: latest transactions, enriched with account + deal.
    const recent = [...txs]
      .sort((a, b) => b.transactionDate - a.transactionDate)
      .slice(0, RECENT_TX)
    const recentTransactions = await Promise.all(
      recent.map(async (tx) => {
        const account = await ctx.db.get('bankAccounts', tx.bankAccountId)
        const deal = tx.dealId ? await ctx.db.get('deals', tx.dealId) : null
        const target = deal
          ? await ctx.db.get('companies', deal.targetCompanyId)
          : null
        return {
          _id: tx._id,
          transactionDate: tx.transactionDate,
          direction: tx.direction,
          amount: tx.amount,
          rawLabel: tx.rawLabel,
          accountLabel: account?.label ?? null,
          dealLabel: deal ? (deal.name ?? target?.name ?? null) : null,
        }
      }),
    )

    return {
      participationsCount,
      activeDealsCount: activeDeals.length,
      deployedCents,
      distributedCents,
      cashCents,
      navCents,
      navIsPartial,
      byInstrument: [...byInstrument.entries()]
        .map(([kind, paidCents]) => ({ kind, paidCents }))
        .sort((a, b) => b.paidCents - a.paidCents),
      recentTransactions,
    }
  },
})
