/**
 * Dashboard aggregates for an org (`/app/$orgSlug`). A single reactive
 * query: counts participations, sums deployed/distributed from the
 * deal-matched transactions, cash from the real balances, the estimated
 * NAV from each deal's latest valuation (fallback: amount paid if no
 * valuation), and a monthly NAV trend (`navSeries`) for the hero sparkline.
 *
 * Reads are per deal via the `by_deal` (transactions) and `by_deal_asof`
 * (valuations) indexes — never a full org collect: the transactions table
 * grows unbounded with bank imports and a full scan here made the dashboard
 * take seconds to render. The per-deal transactions + valuations are read
 * once and reused for the point totals AND the monthly series, so the
 * sparkline's last point reconciles with the hero's point NAV.
 */

import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { residualValueCents } from './lib/metrics'

const RECENT_TX = 5
// Cap the sparkline to the last two years of monthly points.
const MAX_SERIES_POINTS = 24

/** Start (UTC) of the month following `ms`. */
function nextMonthStart(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

export const getDashboard = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    // 1. Org deals (exited ones stay in deployed/distributed).
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    // 2. Per-deal reads in a single pass: matched transactions (dated) via
    //    `by_deal` and the full valuation history via `by_deal_asof` (asc by
    //    asOf, valuations are sparse). Reused for both the point totals and
    //    the monthly series below.
    const perDeal = await Promise.all(
      deals.map(async (deal) => {
        const txs = await ctx.db
          .query('transactions')
          .withIndex('by_deal', (q) => q.eq('dealId', deal._id))
          .collect()
        const valuations = await ctx.db
          .query('valuations')
          .withIndex('by_deal_asof', (q) => q.eq('dealId', deal._id))
          .collect()
        const isActive =
          deal.status === 'active' || deal.status === 'partially_exited'
        return { deal, txs, valuations, isActive }
      }),
    )

    // 3. Deployed (out) / distributed (in), never netted — same definition as
    //    the deal detail page.
    const paidByDeal = new Map<string, number>()
    let deployedCents = 0
    let distributedCents = 0
    for (const { deal, txs } of perDeal) {
      let paid = 0
      let received = 0
      for (const tx of txs) {
        if (tx.direction === 'out') paid += tx.amount
        else received += tx.amount
      }
      paidByDeal.set(deal._id, paid)
      deployedCents += paid
      distributedCents += received
    }

    // 4. Estimated NAV: latest valuation per active deal, fallback amount paid
    //    (navIsPartial = at least one active deal without a valuation).
    let navCents = 0
    let navIsPartial = false
    for (const { deal, valuations, isActive } of perDeal) {
      const last = valuations.at(-1)
      // residualValueCents returns 0 for exited/written-off deals, so the
      // non-active ones contribute nothing (same as the previous `continue`).
      navCents += residualValueCents({
        status: deal.status,
        lastValuationCents: last?.fairValue ?? null,
        paidActual: paidByDeal.get(deal._id) ?? 0,
      })
      if (isActive && !last) navIsPartial = true
    }

    // 5. Cash: real EUR balances of non-archived accounts (+ their count).
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    let cashCents = 0
    let accountsCount = 0
    for (const account of accounts) {
      if (account.archivedAt || account.currency !== 'EUR') continue
      cashCents += account.currentBalance ?? 0
      accountsCount += 1
    }

    // 6. Breakdown of deployed capital by instrument (active deals).
    const byInstrument = new Map<string, number>()
    for (const { deal, isActive } of perDeal) {
      if (!isActive) continue
      const paid = paidByDeal.get(deal._id) ?? 0
      if (paid <= 0) continue
      byInstrument.set(
        deal.instrumentKind,
        (byInstrument.get(deal.instrumentKind) ?? 0) + paid,
      )
    }

    // 7. Participations = distinct target companies of active deals.
    const participationsCount = new Set(
      perDeal
        .filter((row) => row.isActive)
        .map((row) => row.deal.targetCompanyId),
    ).size

    // 8. Monthly NAV trend (hero sparkline), over the current holdings
    //    (active + partially exited). For each month-end: latest valuation
    //    as-of that month, else cumulative paid — same fallback as the point
    //    NAV, so the last point equals navCents.
    const active = perDeal.filter((row) => row.isActive)
    const dates: Array<number> = []
    for (const { txs, valuations } of active) {
      for (const tx of txs) dates.push(tx.transactionDate)
      for (const valuation of valuations) dates.push(valuation.asOf)
    }
    let navSeries: Array<{ month: number; navCents: number }> = []
    if (dates.length > 0) {
      const start = new Date(Math.min(...dates))
      const now = new Date()
      const months: Array<number> = []
      let year = start.getUTCFullYear()
      let month = start.getUTCMonth()
      const endYear = now.getUTCFullYear()
      const endMonth = now.getUTCMonth()
      while (year < endYear || (year === endYear && month <= endMonth)) {
        months.push(Date.UTC(year, month, 1))
        month += 1
        if (month > 11) {
          month = 0
          year += 1
        }
      }
      navSeries = months.slice(-MAX_SERIES_POINTS).map((monthStart) => {
        const boundary = nextMonthStart(monthStart)
        let nav = 0
        for (const { txs, valuations } of active) {
          // Latest valuation with asOf before the month boundary (asc order).
          let fairValue: number | null = null
          for (const valuation of valuations) {
            if (valuation.asOf < boundary) fairValue = valuation.fairValue
            else break
          }
          if (fairValue !== null) {
            nav += fairValue
            continue
          }
          // Fallback: capital paid so far (mirrors the point-NAV fallback).
          let paid = 0
          for (const tx of txs) {
            if (tx.direction === 'out' && tx.transactionDate < boundary) {
              paid += tx.amount
            }
          }
          nav += paid
        }
        return { month: monthStart, navCents: nav }
      })
    }

    // 9. Recent activity: latest transactions (indexed `take`, not a full
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
      activeDealsCount: active.length,
      deployedCents,
      distributedCents,
      cashCents,
      accountsCount,
      navCents,
      navIsPartial,
      navSeries,
      byInstrument: [...byInstrument.entries()]
        .map(([kind, paidCents]) => ({ kind, paidCents }))
        .sort((a, b) => b.paidCents - a.paidCents),
      recentTransactions,
    }
  },
})
