import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  applyCategorization,
  applyMatchToDeal,
  applyUnmatch,
} from './lib/pointage'
import { buildSearchText, normalizeSearch } from './lib/searchText'
import { vatCentsFromTtc, vatRateBpsValidator } from './lib/vat'

import type { Id } from './_generated/dataModel'

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
    const deal = await ctx.db.get("deals", dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get("bankAccounts", tx.bankAccountId)
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
          // Pointage généralisé (filtre de sécurité côté page Passif — une tx
          // allouée au passif est `matched` et ne devrait jamais être ici).
          allocation: tx.allocation ?? null,
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
 * bancaire. Même shape que `listUnmatched` (hors `allocation`).
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
          // TVA (statuts charge/produit uniquement) — null = à qualifier.
          vatRateBps: tx.vatRateBps ?? null,
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
// Invariant : `matchStatus === 'matched'` ⟺ rattachée à un deal
// (`dealId != null` + `allocation.kind === 'deal'`) OU allouée au passif
// (`dealId == null` + `allocation.kind === 'equity' | 'intercompany_loan'`,
// cf. convex/liabilities.ts:allocateTransaction). `reconciled` (+ by/at) est
// un miroir dérivé du pointage DEAL uniquement, maintenu pour les lecteurs
// existants (UI deal, vue Cash, agent).
// `allocation` (pointage généralisé) cohabite avec `dealId` :
// `dealId != null` ⟺ `allocation = { kind: 'deal', targetId: dealId }`
// (backfill des lignes pré-existantes : transactions:backfillAllocation).
// Chaque mutation deal écrit une ligne append-only dans `matchingDecisions`
// (dataset des suggestions de l'agent) ; le pointage passif n'y écrit jamais.
//
// Le cœur (patchs + invariants + logging) vit dans convex/lib/pointage.ts,
// partagé avec les outils agent (convex/agentToolsPointage.ts) — ne jamais
// réécrire ces patchs ici.

/**
 * Rattache une transaction à un deal de la même org.
 */
export const matchTransaction = mutation({
  args: { transactionId: v.id('transactions'), dealId: v.id('deals') },
  handler: async (ctx, { transactionId, dealId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyMatchToDeal(ctx, tx, dealId, user._id, 'manual')
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

    await applyCategorization(ctx, tx, 'ignored', user._id, 'manual')
    return null
  },
})

/**
 * Classe une transaction en charge courante (loyer, honoraires, frais…).
 * Sous-type d'« écarté » : même comportement qu'`ignoreTransaction`, seul le
 * statut diffère pour pouvoir consulter ces transactions plus tard.
 * `vatRateBps` (optionnel) pose le taux de TVA déductible — l'UI envoie 20 %
 * par défaut, ajustable ensuite via `setVatRate`.
 */
export const categorizeAsCharge = mutation({
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.optional(vatRateBpsValidator),
  },
  handler: async (ctx, { transactionId, vatRateBps }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'charge', user._id, 'manual', vatRateBps)
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

    await applyCategorization(ctx, tx, 'tax', user._id, 'manual')
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
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.optional(vatRateBpsValidator),
  },
  handler: async (ctx, { transactionId, vatRateBps }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(
      ctx,
      tx,
      'product',
      user._id,
      'manual',
      vatRateBps,
    )
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

    await applyCategorization(ctx, tx, 'internal_transfer', user._id, 'manual')
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
    vatRateBps: v.optional(vatRateBpsValidator),
  },
  handler: async (ctx, { transactionIds, status, vatRateBps }) => {
    const succeeded: Array<Id<'transactions'>> = []
    const failed: Array<{ id: Id<'transactions'>; reason: string }> = []

    for (const transactionId of transactionIds) {
      try {
        const tx = await ctx.db.get('transactions', transactionId)
        if (!tx) throw new ConvexError('not_found')
        const { user } = await requireOrgMember(ctx, tx.orgId)

        await applyCategorization(ctx, tx, status, user._id, 'manual', vatRateBps)
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

    await applyUnmatch(ctx, tx, user._id, 'manual')
    return null
  },
})

// ─── TVA (taux sur charges/produits, position récupérable) ──────────────────

/**
 * Pose ou efface (`null` = retour « à qualifier ») le taux de TVA d'une
 * transaction déjà classée en charge ou produit. Métadonnée, pas une décision
 * de pointage : n'écrit rien dans `matchingDecisions`.
 */
export const setVatRate = mutation({
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.union(vatRateBpsValidator, v.null()),
  },
  handler: async (ctx, { transactionId, vatRateBps }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)
    if (tx.matchStatus !== 'charge' && tx.matchStatus !== 'product') {
      throw new ConvexError('not_categorized')
    }

    await ctx.db.patch('transactions', transactionId, {
      vatRateBps: vatRateBps ?? undefined,
    })
    return null
  },
})

/**
 * Position de TVA de l'org : TVA déductible (charges qualifiées) − TVA
 * collectée (produits qualifiés), dérivée des montants TTC — rien n'est
 * stocké. Signée par le sens : une charge `in` (avoir fournisseur) se
 * soustrait, un produit `out` aussi. `unqualifiedCount` compte les
 * charges/produits sans taux (0 % = qualifié).
 */
export const getVatPosition = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    let deductibleCents = 0
    let collectedCents = 0
    let unqualifiedCount = 0
    for (const status of ['charge', 'product'] as const) {
      const rows = await ctx.db
        .query('transactions')
        .withIndex('by_org_matchStatus', (q) =>
          q.eq('orgId', orgId).eq('matchStatus', status),
        )
        .collect()
      for (const tx of rows) {
        if (tx.vatRateBps == null) {
          unqualifiedCount += 1
          continue
        }
        const vat = vatCentsFromTtc(tx.amount, tx.vatRateBps)
        if (status === 'charge') {
          deductibleCents += tx.direction === 'out' ? vat : -vat
        } else {
          collectedCents += tx.direction === 'in' ? vat : -vat
        }
      }
    }

    return {
      deductibleCents,
      collectedCents,
      netCents: deductibleCents - collectedCents,
      unqualifiedCount,
    }
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
 * À lancer manuellement ('{}' = toutes les orgs, ou cibler '{"orgId": "…"}') :
 *   pnpm exec convex run transactions:backfillMatchStatus '{}' --prod
 */
export const backfillMatchStatus = internalMutation({
  args: { orgId: v.optional(v.id('organizations')) },
  handler: async (ctx, { orgId }) => {
    const rows = orgId
      ? await ctx.db
          .query('transactions')
          .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
          .collect()
      : await ctx.db.query('transactions').collect()

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
 * À lancer manuellement ('{}' = toutes les orgs, ou cibler '{"orgId": "…"}') :
 *   pnpm exec convex run transactions:backfillSearchText '{}' --prod
 */
export const backfillSearchText = internalMutation({
  args: { orgId: v.optional(v.id('organizations')) },
  handler: async (ctx, { orgId }) => {
    const rows = orgId
      ? await ctx.db
          .query('transactions')
          .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
          .collect()
      : await ctx.db.query('transactions').collect()

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

/**
 * Backfill one-shot (idempotent) du pointage généralisé `allocation` sur les
 * transactions pré-existantes : toute transaction avec `dealId` non nul et
 * sans `allocation` reçoit `allocation = { kind: 'deal', targetId: dealId }`.
 * Ne touche pas `dealId` (cohabitation). Une transaction avec `allocation`
 * déjà renseignée est ignorée (relancer ne change rien).
 *
 * N'écrit RIEN dans `matchingDecisions` : un backfill n'est pas une décision
 * humaine, on ne pollue pas le dataset.
 *
 * À lancer manuellement par org :
 *   pnpm exec convex run transactions:backfillAllocation '{"orgId": "…"}' --prod
 */
export const backfillAllocation = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .collect()

    let updated = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.allocation !== undefined || tx.dealId == null) {
        skipped += 1
        continue
      }
      await ctx.db.patch('transactions', tx._id, {
        allocation: { kind: 'deal', targetId: tx.dealId },
      })
      updated += 1
    }
    return { updated, skipped }
  },
})
