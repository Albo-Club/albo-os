/**
 * Calibration of the duplicate detector (`convex/lib/reportDuplicate.ts`),
 * replayed over everything already filed.
 *
 * The detector decides, on a document the pipeline just read, whether the
 * company already carries it: certain → merged in silence, doubt → the mail
 * waits for a human, otherwise a new report. Thresholds picked on two real
 * cases prove nothing about the rest of the base, and the cost of being wrong
 * is asymmetric — a false certainty loses a report, a false doubt costs a
 * click. So before trusting them: replay the comparison on the history and
 * count what it WOULD have done.
 *
 * Each report is compared to the ones filed before it on the same entity,
 * exactly as the pipeline would have. A pair that comes back `duplicate` on a
 * base where the fiches are right is a false positive worth a threshold move;
 * the two double-filed documents of 09/2026 (QOMON, WARO) are the only
 * expected ones.
 *
 * Read-only: one internal QUERY, no mutation, nothing deleted. It reads
 * `rawContent` on every report, which the CLAUDE.md anti-pattern keeps out of
 * list queries — the text is the point here, and this is a one-shot audit run
 * by hand, never an app query.
 *
 * Execution (prod, read-only):
 *   node scripts/report-duplicates-audit.mjs
 */
import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { findDuplicate } from '../lib/reportDuplicate'

/** Reports compared per entity. Beyond that, nothing is in the window anyway. */
const PER_COMPANY = 40

export const scanPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query('companies').paginate({ cursor, numItems })
    const findings: Array<{
      company: string
      kind: string
      reason?: string
      similarity: number | null
      incoming: { title?: string; period?: string; emailDate?: number }
      twin: { title?: string; period?: string; emailDate?: number }
    }> = []
    let companies = 0
    let reports = 0

    for (const company of res.page) {
      if (company.kind !== 'portfolio') continue
      const rows = await ctx.db
        .query('companyReports')
        .withIndex('by_company_received', (q) => q.eq('companyId', company._id))
        .order('desc')
        .take(PER_COMPANY)
      companies++
      reports += rows.length

      // Rows come newest first, so everything AFTER one was already filed when
      // it arrived — the candidate set the pipeline would have seen.
      for (let i = 0; i < rows.length; i++) {
        const incoming = rows[i]
        if (incoming.emailDate === undefined) continue
        const verdict = findDuplicate(
          {
            title: incoming.title ?? '',
            subject: incoming.subject ?? '',
            receivedAt: incoming.emailDate,
            rawContent: incoming.rawContent,
            metrics: incoming.metrics,
          },
          rows.slice(i + 1).map((r) => ({
            reportId: r._id,
            title: r.title,
            subject: r.subject,
            emailDate: r.emailDate,
            reportPeriod: r.reportPeriod,
            rawContent: r.rawContent,
            metrics: r.metrics,
          })),
        )
        if (verdict.kind === 'new') continue
        const twin = rows.find((r) => r._id === verdict.reportId)
        findings.push({
          company: company.name,
          kind: verdict.kind,
          reason: verdict.reason,
          similarity: verdict.similarity,
          incoming: {
            title: incoming.title,
            period: incoming.reportPeriod,
            emailDate: incoming.emailDate,
          },
          twin: {
            title: twin?.title,
            period: twin?.reportPeriod,
            emailDate: twin?.emailDate,
          },
        })
      }
    }

    return {
      findings,
      companies,
      reports,
      cursor: res.continueCursor,
      isDone: res.isDone,
    }
  },
})
