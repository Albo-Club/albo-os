/**
 * Deal valuations — timestamped history in `valuations` (fairValue in
 * cents). Until now the table was only written by seed/Airtable import;
 * this module exposes read/create (UI + agent).
 */

import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { readMembership } from './lib/agentScope'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

async function getOrgDeal(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
): Promise<Doc<'deals'>> {
  const deal = await ctx.db.get('deals', dealId)
  if (!deal || deal.orgId !== orgId) throw new ConvexError('not_found')
  return deal
}

function assertValidValuation(args: { asOf: number; fairValue: number }) {
  if (!Number.isInteger(args.fairValue) || args.fairValue <= 0) {
    throw new ConvexError('invalid_amount')
  }
  if (!Number.isFinite(args.asOf)) {
    throw new ConvexError('invalid_date')
  }
}

function pickValuation(row: Doc<'valuations'>) {
  return {
    _id: row._id,
    asOf: row.asOf,
    fairValue: row.fairValue,
    valuationMethod: row.valuationMethod ?? null,
    source: row.source ?? null,
    notes: row.notes ?? null,
  }
}

/** Valuation history of a deal, most recent first. */
export const list = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('valuations')
      .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
      .order('desc')
      .collect()
    return rows.map(pickValuation)
  },
})

/** Adds a valuation to a deal (fairValue in cents, asOf ms epoch). */
export const create = mutation({
  args: {
    dealId: v.id('deals'),
    asOf: v.number(),
    fairValue: v.number(),
    valuationMethod: v.optional(v.string()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get('deals', args.dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    assertValidValuation(args)

    return await ctx.db.insert('valuations', {
      orgId: deal.orgId,
      dealId: args.dealId,
      asOf: args.asOf,
      fairValue: args.fairValue,
      valuationMethod: args.valuationMethod,
      source: args.source,
      notes: args.notes,
    })
  },
})

// ─── Agent variants (re-check membership via actorUserId) ───────────────────

export const listInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
  },
  handler: async (ctx, { orgId, actorUserId, dealId }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgDeal(ctx, orgId, dealId)
    const rows = await ctx.db
      .query('valuations')
      .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
      .order('desc')
      .take(50)
    return rows.map(pickValuation)
  },
})

export const createInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
    asOf: v.number(),
    fairValue: v.number(),
    valuationMethod: v.optional(v.string()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, ...args }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgDeal(ctx, orgId, args.dealId)
    assertValidValuation(args)

    const id = await ctx.db.insert('valuations', {
      orgId,
      dealId: args.dealId,
      asOf: args.asOf,
      fairValue: args.fairValue,
      valuationMethod: args.valuationMethod,
      source: args.source,
      notes: args.notes,
    })
    return { _id: id }
  },
})
