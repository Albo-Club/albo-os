/**
 * Public read queries for investor reports ingested by email (see
 * convex/reportInbox.ts for the ingestion pipeline). Writes are internal-only;
 * the UI reads through these org-scoped queries (CompanyReportsSection).
 */

import { ConvexError, v } from 'convex/values'
import { internalQuery, query } from './_generated/server'
import { readMembership } from './lib/agentScope'
import { requireOrgMember } from './lib/auth'
import { storageUnitFor } from './lib/metricCatalog'
import { listSilentCompanies } from './lib/reportFreshness'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

/** A company's reports, most recent period first (light fields for the list). */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const rows = await ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(200)

    return rows.map((r) => ({
      _id: r._id,
      title: r.title ?? null,
      headline: r.headline ?? null,
      reportPeriod: r.reportPeriod ?? null,
      periodSortDate: r.periodSortDate ?? null,
      reportType: r.reportType ?? null,
      status: r.status,
      fromEmail: r.fromEmail ?? null,
      emailDate: r.emailDate ?? null,
      processedAt: r.processedAt ?? null,
    }))
  },
})

/** Full content of one report (for the detail dialog). */
export const getById = query({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) throw new ConvexError('not_found')
    await requireOrgMember(ctx, report.orgId)

    return {
      _id: report._id,
      title: report.title ?? null,
      headline: report.headline ?? null,
      keyHighlights: report.keyHighlights ?? [],
      reportPeriod: report.reportPeriod ?? null,
      reportType: report.reportType ?? null,
      metrics: (report.metrics ?? {}) as Record<string, number>,
      rawContent: report.rawContent ?? null,
      cleanedHtml: report.cleanedHtml ?? null,
      fromEmail: report.fromEmail ?? null,
      subject: report.subject ?? null,
      emailDate: report.emailDate ?? null,
    }
  },
})

// ─── Agent variants (re-check membership via actorUserId) ────────────────────

const AGENT_LIST_DEFAULT = 20
const AGENT_LIST_MAX = 50

async function getOrgCompany(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
): Promise<Doc<'companies'>> {
  const company = await ctx.db.get('companies', companyId)
  if (!company || company.orgId !== orgId) throw new ConvexError('not_found')
  return company
}

/**
 * The flat `metrics` map holds bare numbers keyed by catalog key; readers have
 * no way to know the unit. Restate it as a list carrying the storage unit.
 */
function describeMetrics(
  metrics: Record<string, number>,
): Array<{ key: string; value: number; unit: string }> {
  return Object.entries(metrics).map(([key, value]) => ({
    key,
    value,
    unit: storageUnitFor(key) ?? 'unknown',
  }))
}

export const listInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    companyId: v.id('companies'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, actorUserId, companyId, limit }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgCompany(ctx, orgId, companyId)

    const take = Math.min(
      Math.max(limit ?? AGENT_LIST_DEFAULT, 1),
      AGENT_LIST_MAX,
    )
    const rows = await ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(take)

    return rows.map((r) => ({
      _id: r._id,
      title: r.title ?? null,
      headline: r.headline ?? null,
      reportPeriod: r.reportPeriod ?? null,
      periodSortDate: r.periodSortDate ?? null,
      reportType: r.reportType ?? null,
      status: r.status,
      fromEmail: r.fromEmail ?? null,
      emailDate: r.emailDate ?? null,
    }))
  },
})

/**
 * The org's silent participations — companies past the org's silence
 * threshold without a received report (cf. lib/reportFreshness.ts). Same
 * detection as the badge on the participations list and the To do tab.
 */
export const silentInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    return await listSilentCompanies(ctx, orgId, Date.now())
  },
})

export const getInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    reportId: v.id('companyReports'),
  },
  handler: async (ctx, { orgId, actorUserId, reportId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const report = await ctx.db.get('companyReports', reportId)
    if (!report || report.orgId !== orgId) throw new ConvexError('not_found')

    // No rawContent/cleanedHtml here: they run up to 150k chars and would
    // swamp the context. That text is already indexed — read it through
    // `searchDocuments` (convex/vectorize.ts).
    return {
      _id: report._id,
      companyId: report.companyId,
      title: report.title ?? null,
      headline: report.headline ?? null,
      keyHighlights: report.keyHighlights ?? [],
      reportPeriod: report.reportPeriod ?? null,
      reportType: report.reportType ?? null,
      status: report.status,
      metrics: describeMetrics((report.metrics ?? {}) as Record<string, number>),
      subject: report.subject ?? null,
      fromEmail: report.fromEmail ?? null,
      emailDate: report.emailDate ?? null,
    }
  },
})
