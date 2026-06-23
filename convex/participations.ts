import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { lastValuationCents, transactionTotals } from './deals'
import { getGroupBySlug, getGroupSettings } from './lib/groupSettings'
import {
  aggregateEntities,
  resolveBlocks,
  sanitizeBlocks,
} from './lib/portfolioGroups'
import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel>

/** Residual value of a deal for the TVPI — mirrors the client `residualCents`
 * (ParticipationsTable): 0 if exited/written off, else last valuation, falling
 * back to cost. */
function residualCents(
  deal: Doc<'deals'>,
  paidActual: number,
  valuation: number | null,
): number {
  if (deal.status === 'fully_exited' || deal.status === 'written_off') return 0
  // paidActual is always a number here (transactionTotals); no `?? 0` needed.
  return valuation ?? paidActual
}

/** Consolidated totals of one entity from its deals. */
async function entityTotals(ctx: Ctx, orgId: Id<'organizations'>, companyId: Id<'companies'>) {
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_org_target', (q) =>
      q.eq('orgId', orgId).eq('targetCompanyId', companyId),
    )
    .collect()
  let committed = 0
  let paid = 0
  let received = 0
  let residual = 0
  for (const d of deals) {
    const [{ paidActual, received: rec }, valuation] = await Promise.all([
      transactionTotals(ctx, d._id),
      lastValuationCents(ctx, d._id),
    ])
    committed += d.committedAmount ?? 0
    paid += paidActual
    received += rec
    residual += residualCents(d, paidActual, valuation)
  }
  return { committed, paid, received, residual, dealsCount: deals.length }
}

/**
 * Consolidated view of a portfolio group, addressed by its stable slug.
 * Returns per-entity totals + the group aggregate + the resolved KPI block
 * config. Computes ONLY derivable metrics (no TRI/duration/etc.).
 */
export const getGroup = query({
  args: { orgId: v.id('organizations'), slug: v.string() },
  handler: async (ctx, { orgId, slug }) => {
    await requireOrgMember(ctx, orgId)
    const settings = await getGroupBySlug(ctx, orgId, slug)
    if (!settings) throw new ConvexError('not_found')

    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_group', (q) =>
        q.eq('orgId', orgId).eq('group', settings.group),
      )
      .collect()
    const active = companies.filter((c) => !c.archivedAt)

    const entities = await Promise.all(
      active.map(async (c) => {
        const totals = await entityTotals(ctx, orgId, c._id)
        return {
          companyId: c._id,
          name: c.name,
          domain: c.domain ?? null,
          committed: totals.committed,
          paid: totals.paid,
          received: totals.received,
          tvpi:
            totals.paid > 0
              ? (totals.received + totals.residual) / totals.paid
              : null,
          dealsCount: totals.dealsCount,
          residual: totals.residual,
        }
      }),
    )

    const totals = aggregateEntities(entities)
    return {
      group: settings.group,
      displayName: settings.displayName ?? settings.group,
      groupKind: settings.groupKind ?? null,
      slug: settings.slug,
      entities: entities.map(({ residual: _r, ...e }) => e),
      totals,
      entityCount: entities.length,
      dealsCount: entities.reduce((n, e) => n + e.dealsCount, 0),
      blocks: resolveBlocks(settings.blocks),
    }
  },
})

/**
 * Distinct non-empty group keys of the org, resolved to their settings row
 * (displayName + slug). Feeds the assignment combobox and group links.
 */
export const listGroups = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const keys = new Set<string>()
    for (const c of companies) {
      if (!c.archivedAt && c.group) keys.add(c.group)
    }
    // Resolve each key via its settings row (ensured at assignment time).
    return await Promise.all(
      Array.from(keys)
        .sort((a, b) => a.localeCompare(b))
        .map(async (group) => {
          const settings = await getGroupSettings(ctx, orgId, group)
          return {
            group,
            displayName: settings?.displayName ?? group,
            slug: settings?.slug ?? null,
          }
        }),
    )
  },
})

/** Persists the KPI block config (order + visibility) of a group. */
export const setGroupBlocks = mutation({
  args: {
    orgId: v.id('organizations'),
    slug: v.string(),
    blocks: v.array(v.object({ key: v.string(), visible: v.boolean() })),
  },
  handler: async (ctx, { orgId, slug, blocks }) => {
    await requireOrgMember(ctx, orgId)
    const settings = await getGroupBySlug(ctx, orgId, slug)
    if (!settings) throw new ConvexError('not_found')
    await ctx.db.patch('portfolioGroupSettings', settings._id, {
      blocks: sanitizeBlocks(blocks),
    })
    return settings._id
  },
})

/** Renames a group's display name (the slug and logical key never change). */
export const setGroupDisplayName = mutation({
  args: {
    orgId: v.id('organizations'),
    slug: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { orgId, slug, displayName }) => {
    await requireOrgMember(ctx, orgId)
    const settings = await getGroupBySlug(ctx, orgId, slug)
    if (!settings) throw new ConvexError('not_found')
    const trimmed = displayName.trim()
    await ctx.db.patch('portfolioGroupSettings', settings._id, {
      displayName: trimmed === '' ? settings.group : trimmed,
    })
    return settings._id
  },
})

/** Sets a group's organizational nature (badge label only — no KPI impact). */
export const setGroupKind = mutation({
  args: {
    orgId: v.id('organizations'),
    slug: v.string(),
    groupKind: v.union(v.literal('sponsor'), v.literal('group')),
  },
  handler: async (ctx, { orgId, slug, groupKind }) => {
    await requireOrgMember(ctx, orgId)
    const settings = await getGroupBySlug(ctx, orgId, slug)
    if (!settings) throw new ConvexError('not_found')
    await ctx.db.patch('portfolioGroupSettings', settings._id, { groupKind })
    return settings._id
  },
})
