/**
 * Public read queries for investor reports ingested by email (see
 * convex/reportInbox.ts for the ingestion pipeline). Writes are internal-only;
 * the UI reads through these org-scoped queries (CompanyReportsSection).
 */

import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

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
