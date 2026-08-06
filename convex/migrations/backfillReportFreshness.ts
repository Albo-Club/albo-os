/**
 * One-shot backfill of `companies.lastReportAt` / `lastReportCoverageAt`,
 * all orgs.
 *
 * Silence detection used to recompute those two dates by scanning the whole
 * `companyReports` table of the org on every read — and Convex reads whole
 * rows, so it re-read every report's `rawContent` (up to 300k chars) and
 * `cleanedHtml` to extract two numbers. They now live on the entity, written
 * at ingestion (`lib/reportFreshness.ts:recordReportOnCompany`). Reports
 * stored BEFORE that change left the entity blank — and a blank entity reads
 * as « never gave news », which counts its silence from the first
 * disbursement instead of its last report.
 *
 * Write semantics: recomputes both dates from the reports and writes only
 * when the stored value differs (idempotent — a re-run after the fix is a
 * no-op). Uses the same rule as the old scan, `emailDate ?? _creationTime`,
 * so rows predating `emailDate` keep an evaluable date. Non-destructive: a
 * company without any report is left untouched.
 *
 * Also the repair tool if the copy ever drifts from the reports — `report`
 * names the entities where they disagree.
 *
 * Execution (prod, manual):
 *   pnpm exec convex run --prod migrations/backfillReportFreshness:dryRun
 *   # STOP: eyeball the before→after list, then:
 *   pnpm exec convex run --prod migrations/backfillReportFreshness:apply
 *   pnpm exec convex run --prod migrations/backfillReportFreshness:report
 */
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

type Pending = {
  companyId: Id<'companies'>
  orgSlug: string
  name: string
  from: { lastReportAt: number | null; coverageAt: number | null }
  to: { lastReportAt: number; coverageAt: number | null }
}

type Resolved = {
  toFix: Array<Pending>
  alreadyExact: number
  withoutReport: number
}

/** Recompute both dates from the reports, per company, for every org. */
async function resolve(ctx: Ctx): Promise<Resolved> {
  const orgs = await ctx.db.query('organizations').collect()
  const toFix: Array<Pending> = []
  let alreadyExact = 0
  let withoutReport = 0

  for (const org of orgs) {
    // One pass over the org's reports — the very scan this backfill exists to
    // remove from the read path. Acceptable here: it runs by hand, once.
    const lastReport = new Map<Id<'companies'>, number>()
    const coverage = new Map<Id<'companies'>, number>()
    const reports = await ctx.db
      .query('companyReports')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const report of reports) {
      const receivedAt = report.emailDate ?? report._creationTime
      const known = lastReport.get(report.companyId)
      if (known === undefined || receivedAt > known) {
        lastReport.set(report.companyId, receivedAt)
      }
      if (report.periodSortDate !== undefined) {
        const covered = coverage.get(report.companyId)
        if (covered === undefined || report.periodSortDate > covered) {
          coverage.set(report.companyId, report.periodSortDate)
        }
      }
    }

    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const company of companies) {
      const expected = lastReport.get(company._id)
      if (expected === undefined) {
        withoutReport += 1
        continue
      }
      const expectedCoverage = coverage.get(company._id) ?? null
      if (
        company.lastReportAt === expected &&
        (company.lastReportCoverageAt ?? null) === expectedCoverage
      ) {
        alreadyExact += 1
        continue
      }
      toFix.push({
        companyId: company._id,
        orgSlug: org.slug,
        name: company.name,
        from: {
          lastReportAt: company.lastReportAt ?? null,
          coverageAt: company.lastReportCoverageAt ?? null,
        },
        to: { lastReportAt: expected, coverageAt: expectedCoverage },
      })
    }
  }

  return { toFix, alreadyExact, withoutReport }
}

const iso = (ms: number | null) =>
  ms === null ? '—' : new Date(ms).toISOString().slice(0, 10)

const describe = (p: Pending) =>
  `[${p.orgSlug}] ${p.name}: reçu ${iso(p.from.lastReportAt)} → ${iso(p.to.lastReportAt)}, couvre ${iso(p.from.coverageAt)} → ${iso(p.to.coverageAt)}`

/** Read-only preview of what `apply` would write. */
export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, alreadyExact, withoutReport } = await resolve(ctx)
    return {
      willFix: toFix.length,
      alreadyExact,
      withoutReport,
      changes: toFix.map(describe),
    }
  },
})

/** Writes the recomputed dates. Idempotent. */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { toFix, alreadyExact, withoutReport } = await resolve(ctx)
    for (const p of toFix) {
      await ctx.db.patch('companies', p.companyId, {
        lastReportAt: p.to.lastReportAt,
        ...(p.to.coverageAt !== null
          ? { lastReportCoverageAt: p.to.coverageAt }
          : {}),
      })
    }
    return {
      fixed: toFix.length,
      alreadyExact,
      withoutReport,
      changes: toFix.map(describe),
    }
  },
})

/** Post-run check: nothing left to fix means the copy matches the reports. */
export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, alreadyExact, withoutReport } = await resolve(ctx)
    return {
      stillDiverging: toFix.length,
      exact: alreadyExact,
      withoutReport,
      diverging: toFix.map(describe),
    }
  },
})
