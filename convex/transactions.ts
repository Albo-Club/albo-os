import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { recordDecision } from './lib/matchingLog'
import { buildSearchText, normalizeSearch } from './lib/searchText'

import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Borne des résultats de recherche full-text (le listing sans recherche garde
 * son `.collect()` historique — la file de pointage doit rester exhaustive).
 */
const SEARCH_LIMIT = 200

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
 *
 * `search` (optionnel) filtre par libellé/contrepartie via le search index
 * `search_text` (insensible casse/accents), scopé org + statut.
 */
export const listUnmatched = query({
  args: {
    orgId: v.id('organizations'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, search }) => {
    await requireOrgMember(ctx, orgId)

    const term = search ? normalizeSearch(search) : ''
    const rows = term
      ? await ctx.db
          .query('transactions')
          .withSearchIndex('search_text', (q) =>
            q
              .search('searchText', term)
              .eq('orgId', orgId)
              .eq('matchStatus', 'unmatched'),
          )
          .take(SEARCH_LIMIT)
      : await ctx.db
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

/**
 * Transactions d'une org dans un statut de pointage donné (consultation des
 * écartées : ignorées / charges / impôts / produits / virements internes, ou
 * des rattachées), triées par date décroissante et enrichies du compte
 * bancaire. Même shape que `listUnmatched`.
 *
 * `search` (optionnel) filtre par libellé/contrepartie via le search index
 * `search_text` (insensible casse/accents), scopé org + statut.
 */
export const listByStatus = query({
  args: {
    orgId: v.id('organizations'),
    status: v.union(
      v.literal('matched'),
      v.literal('ignored'),
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, status, search }) => {
    await requireOrgMember(ctx, orgId)

    const term = search ? normalizeSearch(search) : ''
    const rows = term
      ? await ctx.db
          .query('transactions')
          .withSearchIndex('search_text', (q) =>
            q
              .search('searchText', term)
              .eq('orgId', orgId)
              .eq('matchStatus', status),
          )
          .take(SEARCH_LIMIT)
      : await ctx.db
          .query('transactions')
          .withIndex('by_org_matchStatus', (q) =>
            q.eq('orgId', orgId).eq('matchStatus', status),
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
 * Logique unitaire de classement charge/impôt/produit/virement interne :
 * patch de la transaction + ligne `matchingDecisions`. Partagée par
 * `categorizeAsCharge`, `categorizeAsTax`, `categorizeAsProduct`,
 * `categorizeAsInternalTransfer` et `bulkCategorize` pour qu'elles ne
 * divergent jamais. L'appelant a déjà chargé la transaction et vérifié
 * l'appartenance à l'org.
 */
async function applyCategorization(
  ctx: MutationCtx,
  tx: Doc<'transactions'>,
  status: 'charge' | 'tax' | 'product' | 'internal_transfer',
  decidedBy: Id<'users'>,
) {
  await ctx.db.patch('transactions', tx._id, {
    matchStatus: status,
    dealId: undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: status,
    source: 'manual',
    decidedBy,
  })
}

/**
 * Classe une transaction en charge courante (loyer, honoraires, frais…).
 * Sous-type d'« écarté » : même comportement qu'`ignoreTransaction`, seul le
 * statut diffère pour pouvoir consulter ces transactions plus tard.
 */
export const categorizeAsCharge = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'charge', user._id)
    return null
  },
})

/**
 * Classe une transaction en impôt. Sous-type d'« écarté » : même comportement
 * qu'`ignoreTransaction`, seul le statut diffère pour pouvoir consulter ces
 * transactions plus tard.
 */
export const categorizeAsTax = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'tax', user._id)
    return null
  },
})

/**
 * Classe une transaction en produit : argent entrant non rattachable à un
 * deal (intérêts bancaires, remboursement divers…). Sous-type d'« écarté » :
 * même comportement qu'`ignoreTransaction`, seul le statut diffère pour
 * pouvoir consulter ces transactions plus tard.
 */
export const categorizeAsProduct = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'product', user._id)
    return null
  },
})

/**
 * Classe une transaction en virement interne (mouvement entre deux comptes de
 * l'utilisateur). V1 : simple étiquette, pas d'appariement des deux jambes
 * (sortie ↔ entrée). Sous-type d'« écarté » : même comportement
 * qu'`ignoreTransaction`, seul le statut diffère pour pouvoir consulter ces
 * transactions plus tard.
 */
export const categorizeAsInternalTransfer = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'internal_transfer', user._id)
    return null
  },
})

/**
 * Classement en masse en charge, impôt, produit ou virement interne. Chaque
 * transaction est traitée indépendamment (même chemin que l'unitaire : auth
 * par org de la tx, patch, ligne `matchingDecisions`) ; un échec sur l'une
 * n'empêche pas les autres. Retourne les ids classés et les échecs
 * (« appliquer ce qui passe »).
 */
export const bulkCategorize = mutation({
  args: {
    transactionIds: v.array(v.id('transactions')),
    status: v.union(
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
  },
  handler: async (ctx, { transactionIds, status }) => {
    const succeeded: Array<Id<'transactions'>> = []
    const failed: Array<{ id: Id<'transactions'>; reason: string }> = []

    for (const transactionId of transactionIds) {
      try {
        const tx = await ctx.db.get('transactions', transactionId)
        if (!tx) throw new ConvexError('not_found')
        const { user } = await requireOrgMember(ctx, tx.orgId)

        await applyCategorization(ctx, tx, status, user._id)
        succeeded.push(transactionId)
      } catch (err) {
        failed.push({
          id: transactionId,
          reason: err instanceof ConvexError ? String(err.data) : 'unknown',
        })
      }
    }

    return { succeeded, failed }
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

/**
 * Backfill one-shot (idempotent) du champ dérivé `searchText` (recherche
 * full-text) sur les transactions pré-existantes. Les écritures récentes le
 * posent déjà (Powens, import Airtable, CSV Mémo, agent) — une ligne sans
 * `searchText` est simplement invisible à la recherche.
 *
 * À lancer manuellement par org :
 *   pnpm exec convex run transactions:backfillSearchText '{"orgId": "…"}' --prod
 */
export const backfillSearchText = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .collect()

    let updated = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.searchText !== undefined) {
        skipped += 1
        continue
      }
      await ctx.db.patch('transactions', tx._id, {
        searchText: buildSearchText(tx.rawLabel, tx.counterparty),
      })
      updated += 1
    }
    return { updated, skipped }
  },
})
