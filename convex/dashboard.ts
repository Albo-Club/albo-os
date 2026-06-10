/**
 * Agrégats du tableau de bord d'une org (`/app/$orgSlug`). Une seule query
 * réactive : compte les participations, somme le déployé/distribué depuis
 * les transactions pointées deal, la trésorerie depuis les soldes réels,
 * et la NAV estimée depuis la dernière valo de chaque deal (fallback :
 * montant versé si aucune valo). Les `.collect()` org-scopés sont
 * acceptables à l'échelle de l'outil (2 users, volumes faibles).
 */

import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

const RECENT_TX = 5

export const getDashboard = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    // 1. Deals de l'org (les exités restent dans déployé/distribué).
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const activeDeals = deals.filter(
      (deal) => deal.status === 'active' || deal.status === 'partially_exited',
    )

    // 2. Transactions : déployé (out) / distribué (in) par deal pointé.
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

    // 3. NAV estimée : dernière valo par deal actif, fallback montant versé
    //    (navIsPartial = au moins un deal actif sans valo).
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

    // 4. Trésorerie : soldes réels EUR des comptes non archivés.
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    let cashCents = 0
    for (const account of accounts) {
      if (account.archivedAt || account.currency !== 'EUR') continue
      cashCents += account.currentBalance ?? 0
    }

    // 5. Répartition du déployé par instrument (deals actifs).
    const byInstrument = new Map<string, number>()
    for (const deal of activeDeals) {
      const paid = paidByDeal.get(deal._id) ?? 0
      if (paid <= 0) continue
      byInstrument.set(
        deal.instrumentKind,
        (byInstrument.get(deal.instrumentKind) ?? 0) + paid,
      )
    }

    // 6. Participations = sociétés cibles distinctes des deals actifs.
    const participationsCount = new Set(
      activeDeals.map((deal) => deal.targetCompanyId),
    ).size

    // 7. Activité récente : dernières transactions, enrichies compte + deal.
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
