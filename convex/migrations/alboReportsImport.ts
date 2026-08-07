/**
 * One-shot import of the Albo app investor reports into Albo OS (org `albo`).
 *
 * Albo app (Supabase, workspace « Albo 1 ») carries the reporting history that
 * predates the AgentMail pipeline — 184 rows back to January 2024, where Albo
 * OS only started receiving reports in July 2026. This brings the backlog over
 * so a participation's timeline is complete in one place.
 *
 * ── Why the decisions are frozen in a file, not computed here ──────────────
 * There is NO deterministic key that identifies the same report on both sides.
 * Each candidate was tried and each one fails on real rows:
 *   - period: Goodvest's Q2 update is `June - Q2 2026` in Albo app and
 *     `Q2 2026` in Albo OS; Loewi's liquidation notice has no period at all
 *     on the Albo OS side. Three duplicates slip through.
 *   - `period_sort_date`: same failure (2026-06-01 vs 2026-04-01 for Goodvest).
 *   - email date: 79 of 184 Albo app rows have none, and Albo OS often holds
 *     the forward date, not the original (AZmed: 65 seconds apart for the same
 *     report). Old periods also arrive late on BOTH sides — AZmed's 2024 and
 *     2025 annuals landed in Albo app on 03/04/2026.
 *   - RFC Message-ID: present on 73 of 184, and Albo OS ingests FORWARDS,
 *     which carry a new Message-ID. It never matches across the two.
 * So the 18 duplicates were identified by comparing CONTENT (headline, key
 * highlights, metrics) participation by participation, reviewed with Benjamin,
 * and frozen in `scripts/data/albo-reports-albo.json`. That file is the
 * decision; the guards below are only a backstop.
 *
 * Split of responsibilities — the model never carries the bytes:
 *   - `scripts/import-albo-reports.mjs` reads Supabase, resolves the frozen
 *     decisions, pulls each attachment from Supabase Storage and POSTs it to a
 *     Convex upload URL;
 *   - this module only mints those URLs and writes the rows.
 *
 * Idempotency: `companyReports.alboReportId` holds the uuid of the source row.
 * `importOne` returns `already_imported` when it is already there, so a re-run
 * is free and an interrupted run resumes by being re-run.
 *
 * ── Why this does NOT reuse `reportStore.storeForCompany` ─────────────────
 * That function UPDATES IN PLACE on a period collision (and deletes the
 * report's `documents` rows before rewriting them). Replaying a 2024 report
 * through it would overwrite the current Albo OS row for that period and drop
 * its attachments. Here a collision SKIPS, unless the decision file explicitly
 * opted that uuid in (`allowPeriodCollision` — six rows, each arbitrated).
 * For the same reason `companyIntelligence.latestReportId` is left alone: a
 * historical import must not repoint the current synthesis.
 *
 * Freshness (`companies.lastReportAt`) is safe to call: `recordReportOnCompany`
 * is monotonic, so a back-dated report never rewinds it.
 *
 * Vectorisation: rows land `vectorState: 'pending'` and are picked up by
 * `vectorize:backfillOrg albo` afterwards — scheduling 139 embeddings inline
 * would burst the provider quota (cf. MIGRATIONS.md).
 *
 * Metrics are copied AS-IS into `metrics` (Benjamin's call): they display, but
 * they do not feed `kpiSnapshots`, whose canonical catalogue differs. No LLM
 * runs during this import.
 *
 * ⚠️ MERGE FIRST. `convex run --prod` calls the code DEPLOYED in prod, and
 * prod is deployed by the Vercel build on `main`. These functions do not exist
 * in prod until this PR is merged. Merging is safe: nothing runs on deploy.
 *
 * Execution (prod, manual — cf. MIGRATIONS.md), AFTER the merge has deployed:
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-albo-reports.mjs --dry
 *   # STOP: check the plan (expect 139 to import, 18 duplicates skipped), then:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-albo-reports.mjs --apply
 *   pnpm exec convex run --prod migrations/alboReportsImport:verify '{}'
 *   pnpm exec convex run --prod vectorize:backfillAll '{}'
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { recordReportOnCompany } from '../lib/reportFreshness'
import { normalizePeriodDisplay, parsePeriod } from '../lib/reportPeriod'

import type { Id } from '../_generated/dataModel'

const MAX_BATCH = 100 // upload URLs minted per call
const PIPELINE_VERSION = 'albo-app-import'

/** Same union as `companyReports.reportType` — local so a drift breaks here. */
const reportTypeValidator = v.union(
  v.literal('monthly'),
  v.literal('bimonthly'),
  v.literal('quarterly'),
  v.literal('semi-annual'),
  v.literal('annual'),
)

/**
 * Mints upload URLs for the script. Auth-less by design: run through
 * `convex run --prod`, which has no user identity — the admin key is the
 * authorisation. Never exposed to the client.
 */
export const startUploads = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    if (count < 1 || count > MAX_BATCH) {
      throw new ConvexError(`count_out_of_range:1..${MAX_BATCH}`)
    }
    const urls: Array<string> = []
    for (let i = 0; i < count; i++)
      urls.push(await ctx.storage.generateUploadUrl())
    return urls
  },
})

/**
 * What the script needs for its dry run: for each target company, the reports
 * Albo OS already holds. The script compares this to the Supabase side and
 * prints the plan — so the collision check runs against LIVE data, not against
 * the snapshot the decision file was reviewed on.
 */
export const plan = internalQuery({
  args: { companyIds: v.array(v.id('companies')) },
  handler: async (ctx, { companyIds }) => {
    const out = []
    for (const companyId of companyIds) {
      const company = await ctx.db.get('companies', companyId)
      if (!company) {
        out.push({ companyId, name: null, missing: true, reports: [] })
        continue
      }
      const reports = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .collect()
      out.push({
        companyId,
        name: company.name,
        missing: false,
        // Only the light fields: these rows carry `rawContent`, and Convex
        // bills the whole row on read (cf. KNOWN_ISSUES.md « Database I/O »).
        reports: reports.map((r) => ({
          period: r.reportPeriod ?? null,
          title: r.title ?? null,
          alboReportId: r.alboReportId ?? null,
        })),
      })
    }
    return out
  },
})

/**
 * Writes one report and its attachments. The script has already uploaded the
 * bytes and passes the resulting storage ids.
 *
 * Three outcomes, always explicit — the script tallies them:
 *   - `already_imported`: this uuid is already anchored on a row (re-run)
 *   - `period_taken`: the (company, period) slot is occupied and this uuid was
 *     not opted into `allowPeriodCollision`. Nothing is written, nothing is
 *     overwritten. This is the backstop that makes a duplicate impossible even
 *     if the decision file were wrong.
 *   - `created`
 */
export const importOne = internalMutation({
  args: {
    alboReportId: v.string(),
    companyId: v.id('companies'),
    allowPeriodCollision: v.boolean(),
    title: v.string(),
    headline: v.optional(v.string()),
    keyHighlights: v.optional(v.array(v.string())),
    reportPeriod: v.optional(v.string()),
    periodSortDate: v.optional(v.number()),
    reportType: v.optional(reportTypeValidator),
    metrics: v.optional(v.any()),
    rawContent: v.optional(v.string()),
    cleanedHtml: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    subject: v.optional(v.string()),
    emailDate: v.optional(v.number()),
    files: v.array(
      v.object({
        storageId: v.id('_storage'),
        filename: v.string(),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        text: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get('companies', args.companyId)
    if (!company) throw new ConvexError(`company_not_found:${args.companyId}`)
    if (company.kind !== 'portfolio') {
      throw new ConvexError(`company_not_portfolio:${company.name}`)
    }

    const already = await ctx.db
      .query('companyReports')
      .withIndex('by_albo_report', (q) =>
        q.eq('alboReportId', args.alboReportId),
      )
      .first()
    if (already) {
      return { status: 'already_imported' as const, reportId: already._id }
    }

    // French months → English, whitespace collapsed, so the stored period
    // matches the pipeline's own vocabulary and `parsePeriod` resolves it.
    const period = args.reportPeriod
      ? normalizePeriodDisplay(args.reportPeriod)
      : undefined

    if (period && !args.allowPeriodCollision) {
      const taken = await ctx.db
        .query('companyReports')
        .withIndex('by_company_period', (q) =>
          q.eq('companyId', args.companyId).eq('reportPeriod', period),
        )
        .first()
      if (taken) return { status: 'period_taken' as const, reportId: taken._id }
    }

    // Prefer the period we can parse ourselves; fall back to the sort date
    // Albo app computed (it labels a bimonthly on its first month, we do not).
    const parsed = period ? parsePeriod(period) : null
    const periodSortDate = parsed?.startMs ?? args.periodSortDate

    const reportId: Id<'companyReports'> = await ctx.db.insert(
      'companyReports',
      {
        orgId: company.orgId,
        companyId: args.companyId,
        // Not 'email': these never came through our inbox, they were ingested by
        // another product. `alboReportId` is what names the real provenance.
        source: 'upload',
        fromEmail: args.fromEmail,
        subject: args.subject,
        emailDate: args.emailDate,
        title: args.title,
        headline: args.headline,
        keyHighlights: args.keyHighlights,
        reportPeriod: period,
        periodSortDate,
        reportType: args.reportType,
        metrics: args.metrics,
        rawContent: args.rawContent,
        cleanedHtml: args.cleanedHtml,
        status: 'completed',
        pipelineVersion: PIPELINE_VERSION,
        processedAt: Date.now(),
        vectorState: 'pending',
        alboReportId: args.alboReportId,
      },
    )

    // Monotonic — a back-dated report never rewinds the entity's freshness.
    await recordReportOnCompany(ctx, args.companyId, {
      receivedAt: args.emailDate ?? Date.now(),
      periodSortDate,
    })

    // Attachments → `documents`, mirroring what `reportStore.storeForCompany`
    // writes for an email-ingested report: same `kind`, same `reportId` link,
    // `vectorState` left unset (the report's own entry covers the text).
    for (const f of args.files) {
      await ctx.db.insert('documents', {
        orgId: company.orgId,
        companyId: args.companyId,
        title: f.filename,
        kind: 'reporting',
        period: periodSortDate,
        storageId: f.storageId,
        contentType: f.contentType,
        size: f.size,
        source: 'upload',
        uploadedAt: Date.now(),
        reportId,
        ...(f.text
          ? { ocrState: 'extracted' as const, ocrChars: f.text.length }
          : {}),
      })
      // Carry the text Albo app already extracted rather than paying Mistral
      // to read the file again (cf. MIGRATIONS.md, `documents.extractedText`).
      if (f.text) {
        const existing = await ctx.db
          .query('documentTexts')
          .withIndex('by_storage', (q) => q.eq('storageId', f.storageId))
          .first()
        if (!existing) {
          await ctx.db.insert('documentTexts', {
            storageId: f.storageId,
            text: f.text,
            truncated: false,
          })
        }
      }
    }

    return { status: 'created' as const, reportId }
  },
})

/**
 * Post-import check: per company, how many reports came from the import and
 * how many periods carry more than one row. A period with several rows is not
 * an error by itself — six were opted in deliberately — so the caller compares
 * this list against `allowPeriodCollision` in the decision file.
 */
export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'albo'))
      .unique()
    if (!org) throw new ConvexError('org_not_found:albo')

    const reports = await ctx.db
      .query('companyReports')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()

    const byCompany = new Map<
      string,
      {
        name: string
        total: number
        imported: number
        periods: Map<string, number>
      }
    >()
    for (const r of reports) {
      const key = r.companyId
      let row = byCompany.get(key)
      if (!row) {
        const company = await ctx.db.get('companies', r.companyId)
        row = {
          name: company?.name ?? '?',
          total: 0,
          imported: 0,
          periods: new Map(),
        }
        byCompany.set(key, row)
      }
      row.total += 1
      if (r.alboReportId) row.imported += 1
      const p = r.reportPeriod ?? '(none)'
      row.periods.set(p, (row.periods.get(p) ?? 0) + 1)
    }

    const companies = []
    const sharedPeriods = []
    for (const [companyId, row] of byCompany) {
      companies.push({
        companyId,
        name: row.name,
        total: row.total,
        imported: row.imported,
      })
      for (const [period, n] of row.periods) {
        if (n > 1) sharedPeriods.push({ company: row.name, period, rows: n })
      }
    }
    companies.sort((a, b) => a.name.localeCompare(b.name))

    return {
      totalReports: reports.length,
      totalImported: reports.filter((r) => r.alboReportId).length,
      companies,
      // Expect exactly the rows opted into `allowPeriodCollision`.
      sharedPeriods,
    }
  },
})
