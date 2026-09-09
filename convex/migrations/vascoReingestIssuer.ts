/**
 * One-shot repair: undo one issuer's portal ingestion so it can be redone with
 * the group-wide fan-out.
 *
 * ── The bug it repairs ─────────────────────────────────────────────────────
 * The ingestion anchor is `vasco:<clientSlug>:<communicationId>` — keyed by
 * PORTAL, not by org, which is right: one publication, ingested once. But the
 * entities it landed on were looked up in the calling org ALONE. The same SPV
 * is often held by two of the group's companies — CALTE and Albo Club both
 * subscribed to Bernay, each with its own fiche — so the first org to run
 * claimed the eight ids and the second found nothing left to do. Result:
 * Albo's Bernay fiche carried all eight publications and CALTE's carried none,
 * and the run reported `0` for it, which reads exactly like "nothing to do".
 *
 * `vascoIngest.pendingForIssuer` now looks the entities up across every org,
 * so a fresh ingestion serves both fiches. What it cannot do is repair the
 * rows already written: the anchor makes them a no-op forever. Hence this.
 *
 * ── What it does, and why deleting is safe here ────────────────────────────
 * It removes the inbound rows of one issuer's publications and every report
 * they produced, so the backfill can create them again — this time on every
 * fiche. Deleting is acceptable precisely because nothing is lost: the portal
 * still holds every publication, and its own id is what will bring them back.
 * The rows are also days old at most, born of this very migration.
 *
 * It reuses `reportInbox.removeReportForCompany`, what the fiche's delete
 * button runs: the report row, its `documents`, the storage blobs no other row
 * references, the KPI snapshots it sourced and its semantic index entry.
 * Re-implementing that here would have left orphans behind.
 *
 * It does NOT reuse `reportsOfInbound` to find them. That helper works off the
 * AgentMail message id — which a portal report does not carry — and off the
 * `reportIds` back-link, which only a completed pipeline writes. It answers
 * empty here, and a deletion that finds nothing is worse than one that fails.
 *
 * ⚠️ Scope is ONE issuer, named explicitly. There is no "repair everything"
 * mode: a deletion that walks the whole portal on its own is exactly the shape
 * that turns a small fix into an incident.
 *
 * Runbook (prod). `dryRun` is the default and writes nothing:
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/vascoReingestIssuer:run \
 *     '{"clientSlug":"parallel","issuerId":"18"}'
 *   # read the plan, then:
 *   pnpm exec convex run --prod migrations/vascoReingestIssuer:run \
 *     '{"clientSlug":"parallel","issuerId":"18","apply":true}'
 *   pnpm exec convex run --prod migrations/vascoReportsBackfill:run '{"orgSlug":"calte"}'
 *
 * The re-ingestion mails an announcement again — the publications are marked
 * announced in the cache already, so `claimArrivals` finds nothing and stays
 * silent. Deleting the reports does not touch that marker, and that is what
 * keeps the repair quiet.
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { removeReportForCompany } from '../reportInbox'

import type { Doc, Id } from '../_generated/dataModel'

export const run = internalMutation({
  args: {
    clientSlug: v.string(),
    issuerId: v.string(),
    apply: v.optional(v.boolean()),
  },
  handler: async (ctx, { clientSlug, issuerId, apply = false }) => {
    // The entities of this issuer, group-wide — the same lookup the fixed
    // ingestion does, so the repair sees exactly what it will serve.
    const companies = (await ctx.db.query('companies').collect()).filter(
      (c) =>
        c.vascoClientSlug === clientSlug && c.vascoIssuerId === issuerId,
    )
    if (companies.length === 0) {
      throw new ConvexError(`no_entity_linked:${clientSlug}:${issuerId}`)
    }

    // Every portal-born report on those fiches, and the inbound rows behind
    // them. Going through the reports rather than through the cache is what
    // makes the repair exact: it removes what was actually written, never what
    // the portal happens to list today.
    const inboundIds = new Set<Id<'inboundEmails'>>()
    const doomed: Array<Doc<'companyReports'>> = []
    const reportTitles: Array<string> = []
    for (const company of companies) {
      const reports = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', company._id))
        .collect()
      for (const report of reports) {
        if (report.source !== 'vasco' || !report.inboundEmailId) continue
        inboundIds.add(report.inboundEmailId)
        doomed.push(report)
        reportTitles.push(`${company.name} — ${report.title ?? '(sans titre)'}`)
      }
    }

    const plan = {
      clientSlug,
      issuerId,
      entities: companies.map((c) => ({ name: c.name, orgId: c.orgId })),
      inboundRows: inboundIds.size,
      reports: reportTitles.length,
      reportTitles,
      applied: apply,
    }
    if (!apply) return plan

    // The reports listed above are the ones removed — not a set re-derived
    // from the inbound row. `reportInbox.reportsOfInbound` cannot serve here:
    // it works off the AgentMail message id, which a portal report does not
    // carry, and off the `reportIds` back-link, which only the full pipeline
    // writes. Deriving the list twice, by two different routes, is how a
    // deletion misses a row and leaves it pointing at a queue row that is gone.
    for (const inboundEmailId of inboundIds) {
      const row = await ctx.db.get('inboundEmails', inboundEmailId)
      // Refuse anything that is not a portal row: the anchor is what this
      // repair is about, and an email-born report must never be swept up by it.
      if (row && row.origin !== 'vasco') {
        throw new ConvexError(`not_a_portal_row:${inboundEmailId}`)
      }
    }
    for (const report of doomed) {
      await removeReportForCompany(ctx, report, { deleteFiles: true })
    }
    for (const inboundEmailId of inboundIds) {
      if (await ctx.db.get('inboundEmails', inboundEmailId)) {
        await ctx.db.delete('inboundEmails', inboundEmailId)
      }
    }
    return { ...plan, removedReports: doomed.length }
  },
})
