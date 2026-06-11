/**
 * Deal business plan (`dealProjections`): expected dated lines, versions
 * 'initial' (BP at closing, frozen) and 'revised' (updated BP).
 * Actuals live in the transactions matched to the deal — never here.
 *
 * Bulk entry per version (`replaceVersion` = delete + insert): this is what
 * makes writes idempotent and trivial for the agent (paste a BP).
 */

import { ConvexError, v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { readMembership } from './lib/agentScope'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const versionValidator = v.union(v.literal('initial'), v.literal('revised'))

const lineValidator = v.object({
  period: v.number(), // ms epoch, start of period
  amountCents: v.number(), // positive
  direction: v.union(v.literal('in'), v.literal('out')),
  notes: v.optional(v.string()),
})

const MAX_LINES = 200

type Line = {
  period: number
  amountCents: number
  direction: 'in' | 'out'
  notes?: string
}

async function getOrgDeal(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
): Promise<Doc<'deals'>> {
  const deal = await ctx.db.get('deals', dealId)
  if (!deal || deal.orgId !== orgId) throw new ConvexError('not_found')
  return deal
}

function assertValidLines(lines: Array<Line>) {
  if (lines.length > MAX_LINES) throw new ConvexError('too_many_lines')
  const seen = new Set<number>()
  for (const line of lines) {
    if (!Number.isInteger(line.amountCents) || line.amountCents <= 0) {
      throw new ConvexError('invalid_amount')
    }
    if (!Number.isFinite(line.period)) throw new ConvexError('invalid_period')
    // Uniqueness (version, period) — Convex has no unique constraint at the schema.
    if (seen.has(line.period)) throw new ConvexError('duplicate_period')
    seen.add(line.period)
  }
}

function pickLine(row: Doc<'dealProjections'>) {
  return {
    _id: row._id,
    version: row.version,
    period: row.period,
    amountCents: row.amountCents,
    direction: row.direction,
    notes: row.notes ?? null,
  }
}

async function listForDeal(ctx: QueryCtx, dealId: Id<'deals'>) {
  const rows = await ctx.db
    .query('dealProjections')
    .withIndex('by_deal_version', (q) => q.eq('dealId', dealId))
    .collect()
  rows.sort((a, b) => a.period - b.period)
  return {
    initial: rows.filter((r) => r.version === 'initial').map(pickLine),
    revised: rows.filter((r) => r.version === 'revised').map(pickLine),
  }
}

/** Replaces ALL lines of a version (bulk entry, idempotent). */
async function replaceVersionCore(
  ctx: MutationCtx,
  deal: Doc<'deals'>,
  version: 'initial' | 'revised',
  lines: Array<Line>,
) {
  assertValidLines(lines)
  const existing = await ctx.db
    .query('dealProjections')
    .withIndex('by_deal_version', (q) =>
      q.eq('dealId', deal._id).eq('version', version),
    )
    .collect()
  for (const row of existing) {
    await ctx.db.delete('dealProjections', row._id)
  }
  for (const line of lines) {
    await ctx.db.insert('dealProjections', {
      orgId: deal.orgId,
      dealId: deal._id,
      version,
      period: line.period,
      amountCents: line.amountCents,
      direction: line.direction,
      notes: line.notes,
    })
  }
  return { replaced: existing.length, inserted: lines.length }
}

/** A deal's BP, lines sorted by period, grouped by version. */
export const listByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    return await listForDeal(ctx, dealId)
  },
})

export const replaceVersion = mutation({
  args: {
    dealId: v.id('deals'),
    version: versionValidator,
    lines: v.array(lineValidator),
  },
  handler: async (ctx, { dealId, version, lines }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    return await replaceVersionCore(ctx, deal, version, lines)
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
    return await listForDeal(ctx, dealId)
  },
})

export const replaceVersionInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
    version: versionValidator,
    lines: v.array(lineValidator),
  },
  handler: async (ctx, { orgId, actorUserId, dealId, version, lines }) => {
    await readMembership(ctx, orgId, actorUserId)
    const deal = await getOrgDeal(ctx, orgId, dealId)
    return await replaceVersionCore(ctx, deal, version, lines)
  },
})
