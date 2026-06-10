/**
 * Cash flow forecast — couche prévisionnelle déterministe.
 *
 * - `forecastRules` : causes récurrentes (loyer SCI, salaires, échéances…).
 * - `forecastEntries` : occurrences datées, générées par `expandRules`
 *   (idempotent via `derivedKey`) ou créées à la main.
 *
 * Régénération sans casse : une entry dérivée éditée à la main
 * (`overridden: true`) ou déjà réalisée/annulée n'est JAMAIS réécrite par
 * `expandRules`. Le date-math vit dans convex/lib/recurrence.ts (pur, testé
 * par tests/recurrence.test.ts).
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAppUser, requireOrgMember } from './lib/auth'
import {
  addMonthsUtc,
  buildMonthlyBalance,
  entryUpsertAction,
  expandOccurrences,
  ruleDerivedKey,
} from './lib/recurrence'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'

// Validators locaux (pattern deals.ts) — à garder alignés avec schema.ts.
const directionValidator = v.union(v.literal('in'), v.literal('out'))

const frequencyValidator = v.union(
  v.literal('weekly'),
  v.literal('monthly'),
  v.literal('quarterly'),
  v.literal('yearly'),
)

const confidenceValidator = v.union(
  v.literal('confirmed'),
  v.literal('expected'),
  v.literal('probable'),
)

// Borne haute de l'horizon de projection (10 ans), garde-fou contre une
// expansion démesurée en une seule mutation.
const MAX_HORIZON_MONTHS = 120

export function assertValidHorizon(horizonMonths: number) {
  if (
    !Number.isInteger(horizonMonths) ||
    horizonMonths < 1 ||
    horizonMonths > MAX_HORIZON_MONTHS
  ) {
    throw new ConvexError('invalid_horizon')
  }
}

/**
 * Résout le périmètre d'orgs : `orgId` fourni → cette org (membership
 * requis) ; absent → toutes les orgs dont l'utilisateur est membre
 * (pattern convex/aggregate.ts).
 */
async function resolveOrgScope(
  ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
  orgId: Id<'organizations'> | undefined,
): Promise<Array<Id<'organizations'>>> {
  if (orgId) {
    await requireOrgMember(ctx, orgId)
    return [orgId]
  }
  const user = await requireAppUser(ctx)
  const memberships = await ctx.db
    .query('organizationMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .collect()
  return memberships.map((m) => m.orgId)
}

// ─── Validation des champs de règle ─────────────────────────────────────────

function assertValidRuleFields(rule: {
  amountCents: number
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  interval: number
  anchorDay: number
  startDate: number
  endDate?: number
}) {
  // Cents entiers strictement positifs — pas de float monétaire.
  if (!Number.isInteger(rule.amountCents) || rule.amountCents <= 0) {
    throw new ConvexError('invalid_amount')
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new ConvexError('invalid_interval')
  }
  const maxAnchor = rule.frequency === 'weekly' ? 7 : 31
  if (
    !Number.isInteger(rule.anchorDay) ||
    rule.anchorDay < 1 ||
    rule.anchorDay > maxAnchor
  ) {
    throw new ConvexError('invalid_anchor_day')
  }
  if (rule.endDate !== undefined && rule.endDate < rule.startDate) {
    throw new ConvexError('invalid_date_range')
  }
}

// ─── Règles ──────────────────────────────────────────────────────────────────

/**
 * Insertion d'une règle (validation incluse) — cœur partagé entre la
 * mutation publique et l'outil agent (convex/agentToolsForecasts.ts).
 * L'appelant a déjà vérifié l'appartenance à l'org.
 */
export async function insertRule(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    orgId: Id<'organizations'>
    label: string
    amountCents: number
    direction: 'in' | 'out'
    category?: string
    frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
    interval?: number
    anchorDay: number
    startDate: number
    endDate?: number
    active?: boolean
  },
): Promise<Id<'forecastRules'>> {
  const interval = args.interval ?? 1
  assertValidRuleFields({ ...args, interval })
  return await ctx.db.insert('forecastRules', {
    orgId: args.orgId,
    label: args.label,
    amountCents: args.amountCents,
    direction: args.direction,
    category: args.category,
    frequency: args.frequency,
    interval,
    anchorDay: args.anchorDay,
    startDate: args.startDate,
    endDate: args.endDate,
    active: args.active ?? true,
    sourceType: 'manual',
  })
}

/** Crée une règle récurrente (ex. loyer SCI mensuel) dans une org. */
export const createRule = mutation({
  args: {
    orgId: v.id('organizations'),
    label: v.string(),
    amountCents: v.number(),
    direction: directionValidator,
    category: v.optional(v.string()),
    frequency: frequencyValidator,
    interval: v.optional(v.number()), // défaut 1
    anchorDay: v.number(),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    active: v.optional(v.boolean()), // défaut true
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    return await insertRule(ctx, args)
  },
})

/**
 * Met à jour une règle. N'affecte pas les entries déjà générées : relancer
 * `expandRules` pour resynchroniser les occurrences non protégées.
 */
export const updateRule = mutation({
  args: {
    ruleId: v.id('forecastRules'),
    patch: v.object({
      label: v.optional(v.string()),
      amountCents: v.optional(v.number()),
      direction: v.optional(directionValidator),
      category: v.optional(v.string()),
      frequency: v.optional(frequencyValidator),
      interval: v.optional(v.number()),
      anchorDay: v.optional(v.number()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { ruleId, patch }) => {
    const rule = await ctx.db.get('forecastRules', ruleId)
    if (!rule) throw new ConvexError('not_found')
    await requireOrgMember(ctx, rule.orgId)
    assertValidRuleFields({ ...rule, ...patch })
    await ctx.db.patch('forecastRules', ruleId, patch)
    return null
  },
})

// ─── Expansion règles → occurrences ──────────────────────────────────────────

/**
 * Déplie les règles actives en `forecastEntries` sur `horizonMonths` mois,
 * de max(startDate, now) à now + horizon. Idempotent : upsert par
 * `derivedKey` ("rule:{ruleId}:{YYYY-MM-DD}").
 *
 * - Entry absente → création (confidence `confirmed`, status `pending`).
 * - Entry existante non protégée → resynchro montant/label/catégorie/direction.
 * - Entry protégée (overridden, réalisée ou annulée) → SKIP.
 *
 * Sans `orgId` : toutes les orgs dont l'utilisateur est membre.
 */
export const expandRules = mutation({
  args: {
    orgId: v.optional(v.id('organizations')),
    horizonMonths: v.number(),
  },
  handler: async (ctx, { orgId, horizonMonths }) => {
    assertValidHorizon(horizonMonths)
    const orgIds = await resolveOrgScope(ctx, orgId)
    return await expandRulesForOrgs(ctx, orgIds, horizonMonths)
  },
})

/**
 * Cœur de l'expansion (sans auth) — partagé entre la mutation publique et
 * l'outil agent. L'appelant a déjà vérifié l'appartenance aux orgs.
 */
export async function expandRulesForOrgs(
  ctx: GenericMutationCtx<DataModel>,
  orgIds: Array<Id<'organizations'>>,
  horizonMonths: number,
) {
  const now = Date.now()
  const horizonEnd = addMonthsUtc(now, horizonMonths)

  let rulesProcessed = 0
  let created = 0
  let updated = 0
  let skippedProtected = 0

  for (const oid of orgIds) {
    const rules = await ctx.db
      .query('forecastRules')
      .withIndex('by_org', (q) => q.eq('orgId', oid))
      .collect()

    for (const rule of rules) {
      if (!rule.active) continue
      rulesProcessed += 1

      const occurrences = expandOccurrences(
        rule,
        Math.max(rule.startDate, now),
        horizonEnd,
      )

      for (const occurrence of occurrences) {
        const derivedKey = ruleDerivedKey(rule._id, occurrence)
        const existing = await ctx.db
          .query('forecastEntries')
          .withIndex('by_derivedKey', (q) => q.eq('derivedKey', derivedKey))
          .unique()

        // La décision (create/update/skip) est pure et testée dans
        // tests/recurrence.test.ts — ici uniquement le glue DB.
        if (existing === null) {
          await ctx.db.insert('forecastEntries', {
            orgId: oid,
            date: occurrence,
            amountCents: rule.amountCents,
            direction: rule.direction,
            confidence: 'confirmed',
            status: 'pending',
            label: rule.label,
            category: rule.category,
            ruleId: rule._id,
            derivedKey,
            overridden: false,
            currency: 'EUR',
          })
          created += 1
        } else if (entryUpsertAction(existing) === 'skip') {
          skippedProtected += 1
        } else {
          // Resynchro depuis la règle (la date est figée par la derivedKey).
          await ctx.db.patch('forecastEntries', existing._id, {
            amountCents: rule.amountCents,
            direction: rule.direction,
            label: rule.label,
            category: rule.category,
          })
          updated += 1
        }
      }
    }
  }

  return { rulesProcessed, created, updated, skippedProtected }
}

// ─── Solde projeté ────────────────────────────────────────────────────────────

/**
 * Solde de trésorerie projeté, agrégé AU MOIS sur `horizonMonths` mois.
 *
 * - Solde de départ = somme des `bankAccounts.currentBalance` réels (comptes
 *   EUR non archivés) des orgs du périmètre.
 * - Flux mensuel = somme des `forecastEntries` `pending` du mois (du début du
 *   mois courant à now + horizon), filtrées par `minConfidence` (`confirmed`
 *   = engagé seulement ; `expected` = engagé + attendu ; absent = tout).
 * - Seul l'EUR est agrégé ; les comptes/entries non-EUR sont comptés dans
 *   `ignoredNonEur*` pour visibilité.
 *
 * Sans `orgId` : consolidé sur toutes les orgs dont l'utilisateur est membre.
 */
export const getForecastBalance = query({
  args: {
    orgId: v.optional(v.id('organizations')),
    horizonMonths: v.number(),
    minConfidence: v.optional(confidenceValidator),
  },
  handler: async (ctx, { orgId, horizonMonths, minConfidence }) => {
    assertValidHorizon(horizonMonths)
    const orgIds = await resolveOrgScope(ctx, orgId)
    return await computeForecastBalanceForOrgs(
      ctx,
      orgIds,
      horizonMonths,
      minConfidence,
    )
  },
})

/**
 * Cœur du solde projeté (sans auth) — partagé entre la query publique et
 * l'outil agent. L'appelant a déjà vérifié l'appartenance aux orgs.
 */
export async function computeForecastBalanceForOrgs(
  ctx: GenericQueryCtx<DataModel>,
  orgIds: Array<Id<'organizations'>>,
  horizonMonths: number,
  minConfidence?: 'confirmed' | 'expected' | 'probable',
) {
  const now = Date.now()
  const nowDate = new Date(now)
  // Fenêtre : du 1er du mois courant (les entries du mois encore pending
  // comptent dans la trajectoire) à now + horizon.
  const windowStart = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    1,
  )
  const windowEnd = addMonthsUtc(now, horizonMonths)

  // 1. Solde de départ = soldes réels courants (Powens) des comptes EUR.
  let startingBalanceCents = 0
  let ignoredNonEurAccounts = 0
  for (const oid of orgIds) {
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', oid))
      .collect()
    for (const account of accounts) {
      if (account.archivedAt) continue
      if (account.currency !== 'EUR') {
        ignoredNonEurAccounts += 1
        continue
      }
      startingBalanceCents += account.currentBalance ?? 0
    }
  }

  // 2. Entries prévisionnelles du périmètre dans la fenêtre.
  // TODO(neutralisation inter-entités) : au consolidé (orgId absent),
  // exclure ici les entries dont `counterpartyOrgId` appartient à `orgIds`
  // (flux internes au groupe). Champ présent au schéma, non lu en MVP.
  const entries: Array<Doc<'forecastEntries'>> = []
  for (const oid of orgIds) {
    const orgEntries = await ctx.db
      .query('forecastEntries')
      .withIndex('by_org_and_date', (q) =>
        q.eq('orgId', oid).gte('date', windowStart).lte('date', windowEnd),
      )
      .collect()
    entries.push(...orgEntries)
  }

  // 3. Agrégation mensuelle pure (testée dans tests/recurrence.test.ts).
  const { months, ignoredNonEurEntries } = buildMonthlyBalance({
    entries,
    startingBalanceCents,
    windowStart,
    windowEnd,
    minConfidence,
  })

  return {
    startingBalanceCents,
    currency: 'EUR',
    ignoredNonEurAccounts,
    ignoredNonEurEntries,
    months,
  }
}

// ─── Pointage prévu → réalisé ────────────────────────────────────────────────

/**
 * Marque une entry comme réalisée en la rattachant à une transaction réelle
 * de la même org (calqué sur transactions.ts:matchTransaction). Ne touche pas
 * à la transaction elle-même : le pointage transaction → deal (matchStatus,
 * reconciled) reste exclusivement géré par convex/transactions.ts.
 */
export const markEntryRealized = mutation({
  args: {
    entryId: v.id('forecastEntries'),
    transactionId: v.id('transactions'),
  },
  handler: async (ctx, { entryId, transactionId }) => {
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry) throw new ConvexError('not_found')
    await requireOrgMember(ctx, entry.orgId)

    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx || tx.orgId !== entry.orgId) {
      throw new ConvexError('transaction_wrong_org')
    }

    await ctx.db.patch('forecastEntries', entry._id, {
      status: 'realized',
      realizedTransactionId: transactionId,
    })
    return null
  },
})

// ─── CRUD manuel des entries ─────────────────────────────────────────────────

/** Crée une entry 100 % manuelle (sans règle ni derivedKey). */
export const createManualEntry = mutation({
  args: {
    orgId: v.id('organizations'),
    date: v.number(),
    amountCents: v.number(),
    direction: directionValidator,
    confidence: confidenceValidator,
    label: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      throw new ConvexError('invalid_amount')
    }
    return await ctx.db.insert('forecastEntries', {
      orgId: args.orgId,
      date: args.date,
      amountCents: args.amountCents,
      direction: args.direction,
      confidence: args.confidence,
      status: 'pending',
      label: args.label,
      category: args.category,
      overridden: false,
      currency: 'EUR',
    })
  },
})

/**
 * Édite une entry. Si elle est dérivée d'une règle (`ruleId` non null), elle
 * passe `overridden: true` : expandRules ne la réécrira plus jamais.
 */
export const updateEntry = mutation({
  args: {
    entryId: v.id('forecastEntries'),
    patch: v.object({
      date: v.optional(v.number()),
      amountCents: v.optional(v.number()),
      direction: v.optional(directionValidator),
      confidence: v.optional(confidenceValidator),
      label: v.optional(v.string()),
      category: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { entryId, patch }) => {
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry) throw new ConvexError('not_found')
    await requireOrgMember(ctx, entry.orgId)
    if (
      patch.amountCents !== undefined &&
      (!Number.isInteger(patch.amountCents) || patch.amountCents <= 0)
    ) {
      throw new ConvexError('invalid_amount')
    }
    await ctx.db.patch('forecastEntries', entry._id, {
      ...patch,
      // Une entry dérivée éditée à la main devient protégée de la régénération.
      ...(entry.ruleId ? { overridden: true } : {}),
    })
    return null
  },
})

/** Annule une entry : elle ne compte plus dans le solde projeté. */
export const cancelEntry = mutation({
  args: { entryId: v.id('forecastEntries') },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry) throw new ConvexError('not_found')
    await requireOrgMember(ctx, entry.orgId)
    await ctx.db.patch('forecastEntries', entry._id, { status: 'cancelled' })
    return null
  },
})
