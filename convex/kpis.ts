/**
 * KPIs portfolio (`kpiSnapshots`) : une ligne = une valeur de métrique sur
 * une période pour une company (ARR, GMV, cash, headcount, NAV/TVPI d'un
 * fonds…). Table déclarée depuis le départ, exposée ici pour la première
 * fois (UI + agent).
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

const LIST_LIMIT = 200

async function getOrgCompany(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
): Promise<Doc<'companies'>> {
  const company = await ctx.db.get('companies', companyId)
  if (!company || company.orgId !== orgId) throw new ConvexError('not_found')
  return company
}

function normalizeMetricType(raw: string): string {
  const metric = raw.trim().toLowerCase()
  if (!metric) throw new ConvexError('invalid_metric')
  return metric
}

function assertValidSnapshot(args: {
  periodStart: number
  periodEnd: number
  value: number
}) {
  if (!Number.isFinite(args.value)) throw new ConvexError('invalid_value')
  if (args.periodEnd < args.periodStart) {
    throw new ConvexError('invalid_date_range')
  }
}

function pickSnapshot(row: Doc<'kpiSnapshots'>) {
  return {
    _id: row._id,
    metricType: row.metricType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    value: row.value,
    unit: row.unit ?? null,
    source: row.source ?? null,
    capturedAt: row.capturedAt,
  }
}

async function listForCompany(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  metricType?: string,
) {
  const rows = await ctx.db
    .query('kpiSnapshots')
    .withIndex('by_company_metric', (q) => {
      const base = q.eq('companyId', companyId)
      return metricType ? base.eq('metricType', metricType) : base
    })
    .take(LIST_LIMIT)
  rows.sort((a, b) => b.periodEnd - a.periodEnd)
  return rows.map(pickSnapshot)
}

/** KPIs d'une company, les plus récents d'abord (filtre métrique optionnel). */
export const listByCompany = query({
  args: {
    companyId: v.id('companies'),
    metricType: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, metricType }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    return await listForCompany(
      ctx,
      companyId,
      metricType ? normalizeMetricType(metricType) : undefined,
    )
  },
})

export const create = mutation({
  args: {
    companyId: v.id('companies'),
    metricType: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    value: v.number(),
    unit: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get('companies', args.companyId)
    if (!company) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, company.orgId)
    assertValidSnapshot(args)

    return await ctx.db.insert('kpiSnapshots', {
      orgId: company.orgId,
      companyId: args.companyId,
      metricType: normalizeMetricType(args.metricType),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      value: args.value,
      unit: args.unit,
      source: args.source,
      capturedAt: Date.now(),
      capturedBy: user._id,
    })
  },
})

export const remove = mutation({
  args: { snapshotId: v.id('kpiSnapshots') },
  handler: async (ctx, { snapshotId }) => {
    const snapshot = await ctx.db.get('kpiSnapshots', snapshotId)
    if (!snapshot) throw new ConvexError('not_found')
    await requireOrgMember(ctx, snapshot.orgId)
    await ctx.db.delete('kpiSnapshots', snapshotId)
    return null
  },
})

// ─── Variantes agent (re-check membership via actorUserId) ──────────────────

export const listInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    companyId: v.id('companies'),
    metricType: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, companyId, metricType }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgCompany(ctx, orgId, companyId)
    return await listForCompany(
      ctx,
      companyId,
      metricType ? normalizeMetricType(metricType) : undefined,
    )
  },
})

export const createInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    companyId: v.id('companies'),
    metricType: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    value: v.number(),
    unit: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, ...args }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgCompany(ctx, orgId, args.companyId)
    assertValidSnapshot(args)

    const id = await ctx.db.insert('kpiSnapshots', {
      orgId,
      companyId: args.companyId,
      metricType: normalizeMetricType(args.metricType),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      value: args.value,
      unit: args.unit,
      source: args.source,
      capturedAt: Date.now(),
      capturedBy: actorUserId,
    })
    return { _id: id }
  },
})
