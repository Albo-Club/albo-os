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
 * `scanHolders` answers the only question that makes a deletion safe: WHO
 * still points at a blob. "No `documents` row" is not "unreferenced" — six
 * places in the schema hold a storage reference, and an attachment living on
 * a received email is perfectly in use while being invisible to `describe`.
 * It sweeps one holder table per call so the script can build the reverse
 * index (blob → holders) in a single pass per table, instead of one query
 * per blob.
 *
 * That sweep knowingly reads whole rows of two heavy tables (`documents`
 * carries the legacy `extractedText`, `inboundEmails` its bodies), which the
 * CLAUDE.md anti-pattern forbids — for a LIST QUERY the app runs constantly.
 * This is a one-shot audit run by hand: the bytes are paid once, and the
 * alternative (a point lookup per blob) reads the same rows anyway.
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

/**
 * One page of a table that can hold a storage reference, reduced to the
 * references it holds. Six places in the schema point at a blob, and a blob
 * is only deletable when NONE of them does.
 *
 * `companyEmails` is the retired email timeline: declared, still carrying its
 * attachments, read by nothing. It is swept like the others precisely so its
 * weight can be told apart from the live holders rather than assumed.
 */
export const scanHolders = internalQuery({
  args: {
    table: v.union(
      v.literal('documents'),
      v.literal('documentTexts'),
      v.literal('inboundEmails'),
      v.literal('companyEmails'),
      v.literal('users'),
      v.literal('organizations'),
    ),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  handler: async (ctx, { table, cursor, numItems }) => {
    const opts = { cursor, numItems }
    // One branch per table: the row shapes differ, so a single generic
    // `ctx.db.query(table)` would not type-check against `.storageId`.
    switch (table) {
      case 'documents': {
        const res = await ctx.db.query('documents').paginate(opts)
        return page(res, res.page.map((r) => r.storageId))
      }
      case 'documentTexts': {
        const res = await ctx.db.query('documentTexts').paginate(opts)
        return page(res, res.page.map((r) => r.storageId))
      }
      case 'inboundEmails': {
        const res = await ctx.db.query('inboundEmails').paginate(opts)
        // The attachment is stored before it is routed, so `storageId` is
        // optional here: a row can list a file it never managed to keep.
        return page(
          res,
          res.page.flatMap((r) =>
            r.attachments.flatMap((a) => (a.storageId ? [a.storageId] : [])),
          ),
        )
      }
      case 'companyEmails': {
        const res = await ctx.db.query('companyEmails').paginate(opts)
        return page(
          res,
          res.page.flatMap((r) => (r.attachments ?? []).map((a) => a.storageId)),
        )
      }
      case 'users': {
        const res = await ctx.db.query('users').paginate(opts)
        return page(
          res,
          res.page.flatMap((r) => (r.avatarStorageId ? [r.avatarStorageId] : [])),
        )
      }
      case 'organizations': {
        const res = await ctx.db.query('organizations').paginate(opts)
        return page(
          res,
          res.page.flatMap((r) => (r.logoStorageId ? [r.logoStorageId] : [])),
        )
      }
    }
  },
})

/** Shared envelope so every branch above returns the same shape. */
function page(
  res: { continueCursor: string; isDone: boolean },
  storageIds: Array<string>,
) {
  return { storageIds, cursor: res.continueCursor, isDone: res.isDone }
}
