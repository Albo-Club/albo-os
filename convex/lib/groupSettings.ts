/**
 * Convex-bound helpers for portfolio group settings (the presentation record
 * keyed by `companies.group`). Pure slug/aggregation logic lives in
 * lib/portfolioGroups.ts; this file only touches the DB.
 */

import { slugify, uniqueSlug } from './portfolioGroups'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>

/** Settings row of a group by its logical key, null if none. */
export async function getGroupSettings(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  group: string,
): Promise<Doc<'portfolioGroupSettings'> | null> {
  return await ctx.db
    .query('portfolioGroupSettings')
    .withIndex('by_org_group', (q) => q.eq('orgId', orgId).eq('group', group))
    .first()
}

/** Settings row of a group by its stable URL slug, null if none. */
export async function getGroupBySlug(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  slug: string,
): Promise<Doc<'portfolioGroupSettings'> | null> {
  return await ctx.db
    .query('portfolioGroupSettings')
    .withIndex('by_org_slug', (q) => q.eq('orgId', orgId).eq('slug', slug))
    .first()
}

export type GroupMeta = { slug: string; displayName: string }

/**
 * Map of an org's group settings keyed by logical key (`companies.group`),
 * built in one indexed read. Lets deal enrichment attach a group's slug +
 * display name without a per-row lookup.
 */
export async function buildGroupMeta(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Map<string, GroupMeta>> {
  const rows = await ctx.db
    .query('portfolioGroupSettings')
    .withIndex('by_org_group', (q) => q.eq('orgId', orgId))
    .collect()
  return new Map(
    rows.map((r) => [r.group, { slug: r.slug, displayName: r.displayName ?? r.group }]),
  )
}

/**
 * Ensures a settings row exists for `group`: returns the existing one, or
 * creates it with a stable slug (generated once, never changes) and
 * displayName = group. Idempotent — safe to call on every assignment.
 */
export async function ensureGroupSettings(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  group: string,
): Promise<Doc<'portfolioGroupSettings'>> {
  const existing = await getGroupSettings(ctx, orgId, group)
  if (existing) return existing

  const orgRows = await ctx.db
    .query('portfolioGroupSettings')
    .withIndex('by_org_slug', (q) => q.eq('orgId', orgId))
    .collect()
  const slug = uniqueSlug(
    slugify(group),
    orgRows.map((r) => r.slug),
  )
  const id = await ctx.db.insert('portfolioGroupSettings', {
    orgId,
    group,
    slug,
    displayName: group,
    blocks: [],
  })
  return (await ctx.db.get('portfolioGroupSettings', id))!
}
