/**
 * One-shot: relaunch the document readings that came back failed.
 *
 * Why it exists: `documentsExtract.run` reads a PDF through the Mistral OCR
 * API, and `convex/lib/ocr.ts` returns '' on ANY non-OK answer — an unreadable
 * file and a rate-limited request are recorded identically, as
 * `ocrState: 'failed'` / `ocrDetail: 'ocr_failed'`. So a bulk import that
 * schedules hundreds of readings at once can leave a pile of documents marked
 * unreadable that are in fact perfectly readable, one at a time. The CALTE
 * legal-docs lot (785 documents, cf. `legalDocsImport.ts`) left 171 of them.
 *
 * Nothing else ever revisits those rows: the hourly cron
 * (`documentsExtract.sweepStalePending`) only picks up readings stuck on
 * 'pending', never ones that ended on 'failed'. And the app's own
 * `documents:reextract` is a per-document mutation behind `requireOrgMember`,
 * so `convex run` (unauthenticated) cannot call it, and 171 clicks is not a
 * plan. This module is that same reset, in a loop, spaced out.
 *
 * The spacing IS the fix. Re-running the same burst would re-produce the same
 * failures; one reading every few seconds is what lets the API answer.
 *
 * Idempotent and resumable: it only ever picks rows currently on 'failed', so
 * a re-run skips what is already back to 'pending' or 'extracted'. A document
 * that fails again lands back on 'failed' and will be picked by the next run —
 * after two passes, what remains is genuinely unreadable, and `verify` of the
 * matching import lists them by name.
 *
 * Run it, then re-run until `relaunched` is 0:
 *   pnpm exec convex run --prod migrations/retryDocOcr:run '{"orgSlug":"calte"}'
 *   pnpm exec convex run --prod migrations/legalDocsImport:verify '{"orgSlug":"calte"}'
 *
 * `limit` caps a pass (try 5 first if unsure), `spacingSeconds` widens the gap
 * between readings if the API still refuses.
 */
import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'

const DEFAULT_SPACING_SECONDS = 3
const DEFAULT_LIMIT = 250

export const run = internalMutation({
  args: {
    orgSlug: v.string(),
    limit: v.optional(v.number()),
    spacingSeconds: v.optional(v.number()),
  },
  handler: async (ctx, { orgSlug, limit, spacingSeconds }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .first()
    if (!org) throw new ConvexError(`org_not_found:${orgSlug}`)

    // The index spans every org, so the org filter happens here. Bounded by
    // the number of failed readings, which is small by construction.
    const failed = (
      await ctx.db
        .query('documents')
        .withIndex('by_ocr_state', (q) => q.eq('ocrState', 'failed'))
        .collect()
    )
      .filter((doc) => doc.orgId === org._id)
      .slice(0, limit ?? DEFAULT_LIMIT)

    const spacingMs = (spacingSeconds ?? DEFAULT_SPACING_SECONDS) * 1000
    const byDetail: Record<string, number> = {}

    for (const [i, doc] of failed.entries()) {
      const detail = doc.ocrDetail ?? 'unknown'
      byDetail[detail] = (byDetail[detail] ?? 0) + 1

      // Same reset as `documents:reextract`: drop the cached text first,
      // otherwise the run adopts it and skips the reading.
      const cached = await ctx.db
        .query('documentTexts')
        .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
        .first()
      if (cached) await ctx.db.delete('documentTexts', cached._id)

      await ctx.db.patch('documents', doc._id, {
        ocrState: 'pending',
        ocrDetail: undefined,
        ocrChars: undefined,
        // The run re-schedules the semantic indexing once the text is back.
        vectorState: 'pending',
        vectorDetail: undefined,
      })
      await ctx.scheduler.runAfter(i * spacingMs, internal.documentsExtract.run, {
        documentId: doc._id,
      })
    }

    return {
      org: orgSlug,
      relaunched: failed.length,
      byDetail,
      lastReadingInMinutes: Math.ceil(
        (Math.max(failed.length - 1, 0) * spacingMs) / 60_000,
      ),
    }
  },
})
