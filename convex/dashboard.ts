/**
 * Dashboard aggregates for an org (`/app/$orgSlug`). A single reactive
 * query: counts participations, sums deployed/distributed from the
 * deal-matched transactions, cash from the real balances, and the
 * estimated NAV from each deal's latest valuation (fallback: amount paid
 * if no valuation). Transactions are read per deal via the `by_deal`
 * index (+ an indexed `take` for the recent feed) — never a full org
 * collect: the transactions table grows unbounded with bank imports and
 * a full scan here made the dashboard take seconds to render.
 */

import { v } from 'convex/values'
import { query } from './_generated/server'
import { lastValuationCents, transactionTotals } from './deals'
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

    // 2. Transactions: deployed (out) / distributed (in) per matched deal,
    //    read per deal via the `by_deal` index (only matched rows are read).
    const totals = await Promise.all(
      deals.map((deal) => transactionTotals(ctx, deal._id)),
    )
    const paidByDeal = new Map<string, number>()
    let deployedCents = 0
    let distributedCents = 0
    deals.forEach((deal, i) => {
      paidByDeal.set(deal._id, totals[i].paidActual)
      deployedCents += totals[i].paidActual
      distributedCents += totals[i].received
    })

    // 3. Estimated NAV: latest valuation per active deal (parallel indexed
    //    point reads), fallback amount paid (navIsPartial = at least one
    //    active deal without valuation).
    const lastValuations = await Promise.all(
      activeDeals.map((deal) => lastValuationCents(ctx, deal._id)),
    )
    let navCents = 0
    let navIsPartial = false
    activeDeals.forEach((deal, i) => {
      const fairValue = lastValuations[i]
      if (fairValue !== null) {
        navCents += fairValue
      } else {
        navCents += paidByDeal.get(deal._id) ?? 0
        navIsPartial = true
      }
    })

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

    // 7. Recent activity: latest transactions (indexed `take`, not a full
    //    collect + sort), enriched with account + deal.
    const recent = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .order('desc')
      .take(RECENT_TX)
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
