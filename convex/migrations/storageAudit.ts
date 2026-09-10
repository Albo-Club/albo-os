/**
 * Read-only audit of what actually occupies Convex FILE storage (ALB-234).
 *
 * The cost of automated backups is an EGRESS cost: Convex bills the bytes
 * leaving the platform on every `convex export`, so the size of the base is
 * multiplied by the number of exports (0,132 $/GB beyond the 1 GB included
 * per month). Knowing WHERE those bytes are — a handful of scanned PDFs, or
 * a long tail — decides whether the lever is compression, deduplication, or
 * neither.
 *
 * It also groups blobs by their `sha256`, which turns "these two files have
 * the same size" into "these two files ARE the same bytes". Deduplicating is
 * the one saving that costs no quality, unlike compressing a scan — but a
 * duplicate is not automatically waste: the same PDF legitimately attached to
 * two companies is two references, not a mistake. Hence: measure, name who
 * points at each copy, decide afterwards.
 *
 * Writes nothing, deletes nothing, downloads no file. Safe on prod at any
 * time, no snapshot needed.
 *
 * Two deliberately dumb queries; the aggregation lives in
 * `scripts/storage-audit.mjs`, which drives the pagination through
 * `convex run` (same shape as `scripts/import-legal-docs.mjs`). Keeping the
 * loop out of Convex avoids an action that would have to reference its own
 * module through `internal.*` — and `convex/_generated/*` is never edited by
 * hand.
 *
 * `scanPage` reads the `_storage` system table (tiny rows: id, size,
 * contentType). `describe` joins ONLY the biggest blobs back to `documents`
 * via `by_storage` to name them — deliberately capped, because a `documents`
 * row still carries the legacy `extractedText` field, so sweeping the whole
 * table would itself be the "big text field on a listed row" anti-pattern
 * this audit exists to price (cf. CLAUDE.md).
 *
 * Scope: FILE storage only. Database storage is billed on a separate line
 * and is read off the dashboard (Convex → Settings → Usage).
 *
 * Execution (prod, read-only):
 *   node scripts/storage-audit.mjs
 *   node scripts/storage-audit.mjs --top 50
 */
import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'

/** One page of `_storage` metadata, so the sweep stays bounded. */
export const scanPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.system.query('_storage').paginate({ cursor, numItems })
    return {
      rows: res.page.map((f) => ({
        storageId: f._id,
        size: f.size,
        contentType: f.contentType,
        createdAt: f._creationTime,
        // Convex stores a content hash per blob, so identical bytes are
        // provable rather than guessed from a matching size.
        sha256: f.sha256,
      })),
      cursor: res.continueCursor,
      isDone: res.isDone,
    }
  },
})

/**
 * Name a handful of blobs from the `documents` row pointing at them. A blob
 * can back several rows (the report fan-out shares one file across matched
 * entities), so the first row is enough to say WHAT the file is.
 */
export const describe = internalQuery({
  args: { storageIds: v.array(v.id('_storage')) },
  handler: async (ctx, { storageIds }) => {
    const out = []
    for (const storageId of storageIds) {
      const row = await ctx.db
        .query('documents')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first()
      out.push({
        storageId,
        title: row?.title ?? '(aucune ligne documents)',
        kind: row?.kind,
        // 'upload' = browser, 'email' = forwarded report attachment. The
        // entry point decides where compression would have to live.
        source: row?.source,
        inline: row?.inline ?? false,
        ocrChars: row?.ocrChars,
      })
    }
    return out
  },
})
