/**
 * One-shot purge of the file-storage blobs nothing points at (ALB-234).
 *
 * The audit measured 501 MB — 28 % of file storage — referenced by NOTHING,
 * of which 564 out of 565 were the exact twin of a file still present
 * elsewhere. Their cause (a download proxy that stored a copy per click and
 * never removed it) was fixed first, on purpose: purging a leak that still
 * flows buys a few weeks.
 *
 * DESTRUCTIVE. Take a snapshot first (`convex export --prod`) — the runbook in
 * MIGRATIONS.md § « Purge des fichiers orphelins » spells out the order.
 * Idempotent: a second run finds nothing left to do.
 *
 * The selection is made by `scripts/storage-purge.mjs`, which sweeps the five
 * holder tables and hands the ids over in batches. This mutation does NOT
 * trust that list — it re-checks every blob at delete time, because the sweep
 * finished minutes ago:
 *
 * - **`documents` again**, on its index. The cheap half of the guarantee.
 * - **the age floor again**, which is the half that actually protects a user:
 *   an upload PUTs its bytes before the row pointing at them exists, so a
 *   blob seconds old with no holder is not an orphan, it is someone's file
 *   mid-flight.
 *
 * The other four holder tables (`inboundEmails`, `companyEmails`, `users`,
 * `organizations`) are not re-checked, and that is a reasoned exception to
 * the rule in KNOWN_ISSUES.md rather than an oversight: each only ever points
 * at a blob it has just created, so none of them can come to claim a blob
 * that was already old and unheld when the sweep saw it. Re-checking them
 * would mean a full scan of two heavy tables PER blob.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/** Mirrors MIN_ORPHAN_AGE_MS in scripts/lib/storage-holders.mjs. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000

export const deleteOrphans = internalMutation({
  args: { storageIds: v.array(v.id('_storage')), dryRun: v.boolean() },
  handler: async (ctx, { storageIds, dryRun }) => {
    let deleted = 0
    let bytes = 0
    let spared = 0

    for (const storageId of storageIds) {
      const meta = await ctx.db.system.get('_storage', storageId)
      // Already gone: the run is being replayed, or something else removed it.
      if (!meta) continue

      if (Date.now() - meta._creationTime < MIN_AGE_MS) {
        spared += 1
        continue
      }
      const claimed = await ctx.db
        .query('documents')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first()
      if (claimed) {
        spared += 1
        continue
      }

      bytes += meta.size
      deleted += 1
      if (dryRun) continue

      // The extracted text is keyed by the blob and useless without it, so it
      // goes along — leaving it behind would be a row describing nothing.
      const text = await ctx.db
        .query('documentTexts')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first()
      if (text) await ctx.db.delete('documentTexts', text._id)
      await ctx.storage.delete(storageId)
    }

    return { deleted, bytes, spared }
  },
})
