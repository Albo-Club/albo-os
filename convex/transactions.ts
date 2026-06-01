import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { recordDecision } from './lib/matchingLog'

/**
 * Transactions rattachées à un deal (rapprochement via `dealId`), triées par
 * date décroissante et enrichies du compte bancaire. Scopé à l'org du deal.
 */
export const listByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get(dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get(tx.bankAccountId)
        return {
          _id: tx._id,
          direction: tx.direction,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          reconciled: tx.reconciled,
          account: account
            ? { label: account.label, bankName: account.bankName }
            : null,
        }
      }),
    )
  },
})

/**
 * File de pointage : les transactions `unmatched` d'une org, triées par date
 * décroissante et enrichies du compte bancaire. Les transactions sans
 * `matchStatus` (pré-backfill) n'apparaissent pas — lancer
 * `transactions:backfillMatchStatus` d'abord.
 */
export const listUnmatched = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_matchStatus', (q) =>
        q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
      )
      .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get('bankAccounts', tx.bankAccountId)
        return {
          _id: tx._id,
          direction: tx.direction,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          account: account
            ? { label: account.label, bankName: account.bankName }
            : null,
        }
      }),
    )
  },
})

// ─── Pointage manuel transaction → deal ─────────────────────────────────────
//
// Invariant : `matchStatus === 'matched'` ⟺ `dealId != null`. `reconciled`
// (+ by/at) est un miroir dérivé maintenu pour les lecteurs existants
// (UI deal, vue Cash, agent) — ne jamais l'écrire ailleurs qu'ici.
// Chaque mutation écrit une ligne append-only dans `matchingDecisions`
// (dataset d'apprentissage de l'agent, phase 2).

/**
 * Rattache une transaction à un deal de la même org.
 */
export const matchTransaction = mutation({
  args: { transactionId: v.id('transactions'), dealId: v.id('deals') },
  handler: async (ctx, { transactionId, dealId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    const deal = await ctx.db.get('deals', dealId)
    if (!deal || deal.orgId !== tx.orgId) {
      throw new ConvexError('deal_wrong_org')
    }

    await ctx.db.patch('transactions', tx._id, {
      matchStatus: 'matched',
      dealId,
      reconciled: true,
      reconciledBy: user._id,
      reconciledAt: Date.now(),
    })
    await recordDecision(ctx, {
      transaction: tx,
      decision: 'matched',
      dealId,
      source: 'manual',
      decidedBy: user._id,
    })
    return null
  },
})

/**
 * Marque une transaction comme ne concernant aucun deal (loyer, paie, frais
 * bancaires, mouvement interne…).
 */
export const ignoreTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await ctx.db.patch('transactions', tx._id, {
      matchStatus: 'ignored',
      dealId: undefined,
      reconciled: false,
      reconciledBy: undefined,
      reconciledAt: undefined,
    })
    await recordDecision(ctx, {
      transaction: tx,
      decision: 'ignored',
      source: 'manual',
      decidedBy: user._id,
    })
    return null
  },
})

/**
 * Dé-pointe une transaction (retour à l'état `unmatched`). Le retour arrière
 * est loggé aussi — signal négatif utile à l'agent.
 */
export const unmatchTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await ctx.db.patch('transactions', tx._id, {
      matchStatus: 'unmatched',
      dealId: undefined,
      reconciled: false,
      reconciledBy: undefined,
      reconciledAt: undefined,
    })
    await recordDecision(ctx, {
      transaction: tx,
      decision: 'unmatched',
      source: 'manual',
      decidedBy: user._id,
    })
    return null
  },
})

/**
 * Backfill one-shot (idempotent) des transactions pré-existantes sans
 * `matchStatus`. Règle : `reconciled === true` + `dealId` → 'matched' ;
 * tout le reste → 'unmatched' (un `dealId` non validé humainement est
 * effacé pour préserver l'invariant matched ⟺ dealId).
 *
 * N'écrit RIEN dans `matchingDecisions` : un backfill n'est pas une décision
 * humaine, on ne pollue pas le dataset.
 *
 * À lancer manuellement par org :
 *   pnpm exec convex run transactions:backfillMatchStatus '{"orgId": "…"}' --prod
 */
export const backfillMatchStatus = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .collect()

    let matched = 0
    let unmatched = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.matchStatus !== undefined) {
        skipped += 1
        continue
      }
      if (tx.reconciled && tx.dealId) {
        await ctx.db.patch('transactions', tx._id, { matchStatus: 'matched' })
        matched += 1
      } else {
        await ctx.db.patch('transactions', tx._id, {
          matchStatus: 'unmatched',
          dealId: undefined,
        })
        unmatched += 1
      }
    }
    return { matched, unmatched, skipped }
  },
})
