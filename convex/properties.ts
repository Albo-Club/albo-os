/**
 * Real estate: the properties a group company holds, and their dated
 * valuations.
 *
 * NOTHING derivable is stored. There is no cost-price column, no operating
 * result, no yield and no latent gain: the pure engine
 * `convex/lib/properties.ts` recomputes all of them on every read, exactly
 * as `lib/amortization.ts` rebuilds a loan's schedule and `liabilities.ts`
 * derives a current-account balance. What IS entered is the amount of a cost
 * line item left on the `manual` source — and that is a source, not a cached
 * total (SPEC D43).
 *
 * A property belongs to exactly ONE org (the holding company), so every
 * function goes through `requireOrgMember`. The cross-org case belongs to
 * the guarantee that bites on the property, and is handled there by
 * `requireGuaranteeParty`.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  COST_POSTES,
  costBasisTotalCents,
  exitCashflows,
  latentGainCents,
  netYield,
  operatingResult,
  resolveCostBasis,
} from './lib/properties'
import { xirr } from './lib/xirr'
import {
  propertyAssetType,
  propertyCostPoste,
  propertyCostSource,
  propertyStatus,
  propertyUsage,
} from './schema'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { PropertyFlow } from './lib/properties'

// ─── Shared reads ───────────────────────────────────────────────────────────

/** Last known valuation of a property, or null when it has never been valued. */
async function lastValuationCents(
  ctx: QueryCtx,
  propertyId: Id<'properties'>,
): Promise<number | null> {
  const valuation = await ctx.db
    .query('propertyValuations')
    .withIndex('by_property_asof', (q) => q.eq('propertyId', propertyId))
    .order('desc')
    .first()
  return valuation ? valuation.valueCents : null
}

/**
 * The transactions matched to a property, in the shape the pure engine
 * expects. Same pattern as the loan sheet: index on
 * `(orgId, allocation.targetId)`, then filter the kind in JS — the index
 * does not carry it.
 */
async function flowsOf(
  ctx: QueryCtx,
  property: Doc<'properties'>,
): Promise<Array<PropertyFlow & { _id: Id<'transactions'>; rawLabel: string }>> {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_org_allocation_target', (q) =>
      q
        .eq('orgId', property.orgId)
        .eq('allocation.targetId', property._id as string),
    )
    .collect()
  return txs
    .filter((tx) => tx.allocation?.kind === 'property')
    .map((tx) => ({
      _id: tx._id,
      transactionDate: tx.transactionDate,
      direction: tx.direction,
      amount: tx.amount,
      category: tx.allocation?.category,
      rawLabel: tx.rawLabel,
    }))
    .sort((a, b) => b.transactionDate - a.transactionDate)
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * An org's properties with their headline figures, for the Immobilier tab.
 *
 * Reads the flows because a property's cost price and yield ARE its flows —
 * unlike the loans list, which can show an outstanding without reading a
 * single transaction. A matching gesture therefore does re-run this query;
 * that is the price of a list that shows real figures rather than entered
 * ones.
 */
export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const now = Date.now()

    const properties = await ctx.db
      .query('properties')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const rows = await Promise.all(
      properties.map(async (property) => {
        const flows = await flowsOf(ctx, property)
        const postes = resolveCostBasis(property.costBasis, flows)
        const costCents = costBasisTotalCents(postes)
        const currentValueCents = await lastValuationCents(ctx, property._id)
        const operating = operatingResult(flows, now)
        return {
          _id: property._id,
          name: property.name,
          address: property.address,
          propertyType: property.propertyType,
          usage: property.usage,
          surfaceSqm: property.surfaceSqm ?? null,
          status: property.status,
          acquiredDate: property.acquiredDate ?? null,
          costBasisCents: costCents,
          currentValueCents,
          latentGainCents: latentGainCents(currentValueCents, costCents),
          netResultCents: operating.netCents,
          netYield: netYield(operating.netCents, costCents),
        }
      }),
    )
    // Held first, sold last; then the most valuable — a sold property stays
    // listed (C9), it just stops being what the page is about.
    rows.sort((a, b) => {
      const rank = (s: string) => (s === 'held' ? 0 : 1)
      const byStatus = rank(a.status) - rank(b.status)
      if (byStatus !== 0) return byStatus
      return (b.currentValueCents ?? 0) - (a.currentValueCents ?? 0)
    })

    return {
      properties: rows,
      // Only what is still held: adding a sold property's last valuation to
      // the portfolio would count money that has left.
      totalValueCents: rows.reduce(
        (sum, row) =>
          row.status === 'held' ? sum + (row.currentValueCents ?? 0) : sum,
        0,
      ),
    }
  },
})

/**
 * Lightweight property targets for the matching combobox: ids + labels only.
 * Reads NO transaction, exactly like `loans.listOptions` — a matching
 * gesture must not invalidate the options list.
 *
 * A SOLD property stays in the list, unlike a settled loan: the closing
 * flows (the balance of the sale, the last charges) land after the sale and
 * still have to be matched to it.
 */
export const listOptions = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const properties = await ctx.db
      .query('properties')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return properties.map((property) => ({
      _id: property._id,
      name: property.name,
      address: property.address,
      status: property.status,
    }))
  },
})

/**
 * The property sheet: the row, its cost basis line item by line item with
 * the source of each, its trailing-twelve-month operating result, its
 * valuations and its matched flows.
 *
 * NOT the securities biting on it: those are read from the guarantee's own
 * side (`guarantees:listBySubjectProperty`), so that the property sheet and
 * the loan sheet describe the same row through the same code (D13).
 *
 * Every figure is derived. Matching a flow to a property is a POINTAGE
 * gesture; the sheet only reads (SPEC D41).
 */
export const getById = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get('properties', propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)
    const now = Date.now()

    const flows = await flowsOf(ctx, property)
    const postes = resolveCostBasis(property.costBasis, flows)
    const costBasisCents = costBasisTotalCents(postes)
    const currentValueCents = await lastValuationCents(ctx, propertyId)
    const operating = operatingResult(flows, now)

    const valuationRows = await ctx.db
      .query('propertyValuations')
      .withIndex('by_property_asof', (q) => q.eq('propertyId', propertyId))
      .order('desc')
      .collect()

    // Exit IRR — a resold marchand de biens only. On a property still held
    // there is no exit to measure, and an IRR on an open position would be
    // a number without a meaning.
    const exitIrr =
      property.status === 'sold'
        ? xirr(
            exitCashflows(postes, flows, {
              acquiredDate: property.acquiredDate,
              saleDate: property.saleDate,
              salePriceCents: property.salePriceCents,
            }).map((flow) => ({ amount: flow.amount, date: flow.date })),
          )
        : null

    return {
      property,
      costBasis: postes,
      costBasisCents,
      currentValueCents,
      latentGainCents: latentGainCents(currentValueCents, costBasisCents),
      operating,
      netYield: netYield(operating.netCents, costBasisCents),
      exitIrr,
      valuations: valuationRows.map((row) => ({
        _id: row._id,
        asOf: row.asOf,
        valueCents: row.valueCents,
        source: row.source ?? null,
        notes: row.notes ?? null,
      })),
      transactions: flows.map((flow) => ({
        _id: flow._id,
        transactionDate: flow.transactionDate,
        direction: flow.direction,
        amount: flow.amount,
        category: flow.category ?? null,
        rawLabel: flow.rawLabel,
      })),
    }
  },
})

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * At most ONE row per line item, and a `manual` amount that is a real
 * amount. Two rows for the same `poste` would give it two sources — the one
 * thing D43 exists to prevent.
 */
function assertValidCostBasis(
  costBasis: Array<{
    poste: Doc<'properties'>['costBasis'][number]['poste']
    source: Doc<'properties'>['costBasis'][number]['source']
    manualAmountCents?: number
  }>,
) {
  const seen = new Set<string>()
  for (const entry of costBasis) {
    if (seen.has(entry.poste)) throw new ConvexError('duplicate_cost_poste')
    seen.add(entry.poste)
    if (entry.manualAmountCents != null && entry.manualAmountCents < 0) {
      throw new ConvexError('invalid_amount')
    }
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

const costBasisValidator = v.array(
  v.object({
    poste: propertyCostPoste,
    source: propertyCostSource,
    manualAmountCents: v.optional(v.number()),
  }),
)

const propertyFields = {
  name: v.string(),
  address: v.string(),
  propertyType: propertyAssetType,
  usage: propertyUsage,
  surfaceSqm: v.optional(v.number()),
  acquiredDate: v.optional(v.number()),
  costBasis: costBasisValidator,
  notes: v.optional(v.string()),
}

export const create = mutation({
  args: { orgId: v.id('organizations'), ...propertyFields },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('invalid_label')
    assertValidCostBasis(args.costBasis)

    return await ctx.db.insert('properties', {
      orgId: args.orgId,
      name,
      address: args.address.trim(),
      propertyType: args.propertyType,
      usage: args.usage,
      surfaceSqm: args.surfaceSqm,
      acquiredDate: args.acquiredDate,
      costBasis: args.costBasis,
      status: 'held',
      notes: args.notes?.trim() || undefined,
    })
  },
})

/**
 * Full replacement of the editable fields (the dialog is prefilled with the
 * current values), sale included — a property sold by mistake has to be
 * putbackable.
 *
 * A sale price without a date (or the reverse) is refused: the exit IRR
 * needs both, and half a sale would silently produce no return at all.
 */
export const update = mutation({
  args: {
    propertyId: v.id('properties'),
    status: propertyStatus,
    saleDate: v.optional(v.number()),
    salePriceCents: v.optional(v.number()),
    ...propertyFields,
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get('properties', args.propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('invalid_label')
    assertValidCostBasis(args.costBasis)
    if (args.status === 'sold' && (!args.saleDate || args.salePriceCents == null)) {
      throw new ConvexError('missing_sale')
    }
    if (args.salePriceCents != null && args.salePriceCents < 0) {
      throw new ConvexError('invalid_amount')
    }

    await ctx.db.patch('properties', args.propertyId, {
      name,
      address: args.address.trim(),
      propertyType: args.propertyType,
      usage: args.usage,
      surfaceSqm: args.surfaceSqm,
      acquiredDate: args.acquiredDate,
      costBasis: args.costBasis,
      status: args.status,
      // Held again = the sale is undone; leaving the two fields would keep a
      // price on a property that is not sold.
      saleDate: args.status === 'sold' ? args.saleDate : undefined,
      salePriceCents: args.status === 'sold' ? args.salePriceCents : undefined,
      notes: args.notes?.trim() || undefined,
    })
    return null
  },
})

/**
 * Switches ONE cost line item between its entered amount and its matched
 * flows — the « Source » column of the sheet, which is the switch itself
 * (SPEC D43).
 *
 * `manualAmountCents` is kept when moving to `flows`: switching back must
 * not mean re-typing it.
 */
export const setCostPosteSource = mutation({
  args: {
    propertyId: v.id('properties'),
    poste: propertyCostPoste,
    source: propertyCostSource,
    manualAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, { propertyId, poste, source, manualAmountCents }) => {
    const property = await ctx.db.get('properties', propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)
    if (manualAmountCents != null && manualAmountCents < 0) {
      throw new ConvexError('invalid_amount')
    }

    const existing = property.costBasis.find((row) => row.poste === poste)
    const next = property.costBasis.filter((row) => row.poste !== poste)
    next.push({
      poste,
      source,
      manualAmountCents: manualAmountCents ?? existing?.manualAmountCents,
    })
    // Stable display order, so the sheet never reshuffles on a switch.
    next.sort(
      (a, b) => COST_POSTES.indexOf(a.poste) - COST_POSTES.indexOf(b.poste),
    )
    await ctx.db.patch('properties', propertyId, { costBasis: next })
    return null
  },
})

/**
 * Deletes a property. Refused while a guarantee bites on it
 * (`has_guarantees` — a pledged asset never disappears in silence, C12),
 * while transactions are matched to it (`has_allocations`), or while
 * documents hang off it (`has_documents`).
 */
export const remove = mutation({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get('properties', propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)

    const guarantee = await ctx.db
      .query('guarantees')
      .withIndex('by_subject_property', (q) =>
        q.eq('subjectPropertyId', propertyId),
      )
      .first()
    if (guarantee) throw new ConvexError('has_guarantees')

    const allocated = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q
          .eq('orgId', property.orgId)
          .eq('allocation.targetId', propertyId as string),
      )
      .first()
    if (allocated) throw new ConvexError('has_allocations')

    const doc = await ctx.db
      .query('documents')
      .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
      .first()
    if (doc) throw new ConvexError('has_documents')

    // The valuation series has no life of its own — it goes with the asset.
    const valuations = await ctx.db
      .query('propertyValuations')
      .withIndex('by_property_asof', (q) => q.eq('propertyId', propertyId))
      .collect()
    for (const row of valuations) {
      await ctx.db.delete('propertyValuations', row._id)
    }
    await ctx.db.delete('properties', propertyId)
    return null
  },
})

// ─── Valuations ─────────────────────────────────────────────────────────────

/**
 * Adds a dated valuation. One per date — re-entering the same date replaces
 * the previous one rather than stacking a second truth on it (same rule as
 * a loan's rate steps).
 */
export const addValuation = mutation({
  args: {
    propertyId: v.id('properties'),
    asOf: v.number(),
    valueCents: v.number(),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get('properties', args.propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)
    if (args.valueCents < 0) throw new ConvexError('invalid_amount')

    const existing = await ctx.db
      .query('propertyValuations')
      .withIndex('by_property_asof', (q) =>
        q.eq('propertyId', args.propertyId).eq('asOf', args.asOf),
      )
      .first()
    if (existing) {
      await ctx.db.patch('propertyValuations', existing._id, {
        valueCents: args.valueCents,
        source: args.source?.trim() || undefined,
        notes: args.notes?.trim() || undefined,
      })
      return existing._id
    }

    return await ctx.db.insert('propertyValuations', {
      orgId: property.orgId,
      propertyId: args.propertyId,
      asOf: args.asOf,
      valueCents: args.valueCents,
      source: args.source?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    })
  },
})

export const removeValuation = mutation({
  args: { valuationId: v.id('propertyValuations') },
  handler: async (ctx, { valuationId }) => {
    const valuation = await ctx.db.get('propertyValuations', valuationId)
    if (!valuation) throw new ConvexError('not_found')
    await requireOrgMember(ctx, valuation.orgId)
    await ctx.db.delete('propertyValuations', valuationId)
    return null
  },
})

// ─── Shared read core (guarantees and agent tools reuse it after auth) ──────

/** Last known value of a property — the figure a pledge margin compares to. */
export async function propertyValueCents(
  ctx: QueryCtx,
  propertyId: Id<'properties'>,
): Promise<number | null> {
  return await lastValuationCents(ctx, propertyId)
}
