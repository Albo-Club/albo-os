/**
 * One-shot: digest the portal history. Every VASCO/Parallel communication
 * already cached becomes a report, through the same door new ones now take
 * (`convex/vascoIngest.ts`).
 *
 * Why a command and not a flag on the cron: the cron only ever sees what
 * ARRIVES. The ~190 publications already held (128 on `calte`, 61 on `albo`)
 * were pulled before the channel existed, so nothing will ever come back for
 * them — this is that return trip, run once per scope.
 *
 * ── Run it in stages, and look between them ────────────────────────────────
 * `companyId` narrows the run to a single entity, and that is the point: the
 * value of a digested publication cannot be known before one is read (the
 * substance may sit in a PDF that OCR handles well, or not at all). So the
 * agreed order is one entity, then one org, then the rest — a decision after
 * each, rather than a bet on 190 rows.
 *
 *   # 1. One entity, both channels, little volume: is the result worth it?
 *   pnpm exec convex run --prod migrations/vascoReportsBackfill:plan \
 *     '{"orgSlug":"albo"}'
 *   pnpm exec convex run --prod migrations/vascoReportsBackfill:run \
 *     '{"orgSlug":"albo","companyId":"<BackMarket>"}'
 *
 *   # 2. The four Albo participations served by both channels.
 *   pnpm exec convex run --prod migrations/vascoReportsBackfill:run '{"orgSlug":"albo"}'
 *
 *   # 3. The fourteen CALTE SPVs, which hold no report at all today.
 *   pnpm exec convex run --prod migrations/vascoReportsBackfill:run '{"orgSlug":"calte"}'
 *
 * Re-running is free: the anchor is the portal's own communication id, so a
 * publication already ingested is skipped and an interrupted run resumes.
 *
 * What it cannot damage: a report that came by mail. `storeForCompany` lets a
 * portal publication take a FREE (company, period) slot and never an occupied
 * one — the guard that makes this backfill safe to run at all, pinned by
 * `regression.vascoIngest.test.ts`.
 *
 * Cost, and why the stages also bound it: each publication downloads its
 * files, OCRs the PDFs and runs one model call, then its entity's synthesis
 * re-runs. Bounded, not free — and scheduling 190 at once is the shape that
 * bursts a provider quota (cf. MIGRATIONS.md on the vectorisation backfill).
 *
 * ⚠️ MERGE FIRST — `convex run --prod` calls the code deployed in prod, and
 * prod is deployed by the Vercel build on `main`.
 */
import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalQuery } from '../_generated/server'
import { inboundKey } from '../vascoIngest'

import type { Id } from '../_generated/dataModel'

type Target = {
  companyId: Id<'companies'>
  orgId: Id<'organizations'>
  name: string
  clientSlug: string
  issuerId: string
  pending: number
  ingested: number
}

/** The entities in scope and what each still owes, without writing anything. */
export const plan = internalQuery({
  args: {
    orgSlug: v.string(),
    companyId: v.optional(v.id('companies')),
  },
  handler: async (ctx, { orgSlug, companyId }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .first()
    if (!org) throw new ConvexError(`org_not_found:${orgSlug}`)

    const companies = (
      await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', org._id))
        .collect()
    ).filter(
      (c) =>
        c.kind === 'portfolio' &&
        c.archivedAt == null &&
        c.vascoClientSlug &&
        c.vascoIssuerId &&
        (!companyId || c._id === companyId),
    )

    const comms = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()

    const targets: Array<Target> = []
    for (const company of companies) {
      const clientSlug = company.vascoClientSlug as string
      const issuerId = company.vascoIssuerId as string
      let pending = 0
      let ingested = 0
      for (const c of comms) {
        if (c.clientSlug !== clientSlug || c.issuerId !== issuerId) continue
        const seen = await ctx.db
          .query('inboundEmails')
          .withIndex('by_message_id', (q) =>
            q.eq('agentmailMessageId', inboundKey(clientSlug, c.communicationId)),
          )
          .first()
        if (seen) ingested += 1
        else pending += 1
      }
      targets.push({
        companyId: company._id,
        orgId: company.orgId,
        name: company.name,
        clientSlug,
        issuerId,
        pending,
        ingested,
      })
    }
    targets.sort((a, b) => a.name.localeCompare(b.name))

    return {
      org: orgSlug,
      entities: targets.length,
      pending: targets.reduce((n, t) => n + t.pending, 0),
      alreadyIngested: targets.reduce((n, t) => n + t.ingested, 0),
      targets,
    }
  },
})

/**
 * Digest what `plan` reports as pending. One ingestion per ISSUER, sequential:
 * each downloads files and starts a pipeline per publication, so running them
 * one after another keeps the burst that follows proportionate.
 */
export const run = internalAction({
  args: {
    orgSlug: v.string(),
    companyId: v.optional(v.id('companies')),
  },
  handler: async (ctx, { orgSlug, companyId }) => {
    const planned: { targets: Array<Target> } = await ctx.runQuery(
      internal.migrations.vascoReportsBackfill.plan,
      { orgSlug, companyId },
    )

    // An issuer can carry several entities: ingesting once fans the
    // publication out to all of them, so ingesting per entity would be the
    // same work done twice.
    const done = new Set<string>()
    const results = []
    for (const target of planned.targets) {
      const key = `${target.clientSlug}:${target.issuerId}`
      if (done.has(key)) continue
      done.add(key)
      const outcome: { ingested: number; skipped: number } = await ctx.runAction(
        internal.vascoIngest.ingestIssuer,
        {
          orgId: target.orgId,
          clientSlug: target.clientSlug,
          issuerId: target.issuerId,
        },
      )
      results.push({ name: target.name, ...outcome })
    }

    return {
      org: orgSlug,
      issuers: results.length,
      ingested: results.reduce((n, r) => n + r.ingested, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      results,
    }
  },
})
