/**
 * Retire the legacy `documents.extractedText` field (MIGRATIONS.md
 * « Chantier : retrait du champ legacy `documents.extractedText` »).
 *
 * The field is written by nothing and read by nothing since the extracted
 * text moved to `documentTexts` (one row per blob, read only when someone
 * opens the text), but prod rows still carry it — up to the 1 MiB document
 * cap each — and Convex reads whole rows: every Documents tab, every company
 * sheet, every agent listing pays for text nobody displays (cf.
 * KNOWN_ISSUES.md « Database I/O : un gros champ texte sur une ligne lue en
 * liste »).
 *
 * Two steps, "purge first, tighten later": this module empties the field in
 * prod; a follow-up PR drops it from the schema once no row carries it
 * (removing it earlier fails `convex deploy` on validation).
 *
 * The text is not thrown away. A row whose blob has no `documentTexts` yet
 * gets one from the legacy text — it spares an OCR pass, billed per page —
 * with `ocrState: 'extracted'` and `ocrChars`, and its `vectorState` reset so
 * `vectorize:backfillAll` indexes it (a document without text was marked
 * 'skipped', cf. vectorize.ts `documentSkipReason`). A row whose blob already
 * has its text just loses the duplicate.
 *
 * Leaf functions only — the loop lives in `scripts/legacy-extracted-text.mjs`
 * so the module never references itself through `internal.*` (cf.
 * KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer lui-même
 * hors déploiement »). Sizing: a `documents` row and a `documentTexts` row
 * can each approach 1 MiB, so `scanPage` is bounded in bytes and
 * `migrateBatch` takes a handful of ids per transaction.
 *
 * Idempotent: a second pass finds no row carrying the field.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { boundText } from '../lib/fileText'

/** Read budget per scan page — half the 8 MiB per-query limit. */
const PAGE_BYTES = 4 * 1024 * 1024

/** One page of `documents`, reduced to the rows still carrying the field. */
export const scanPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db
      .query('documents')
      .paginate({ cursor, numItems, maximumBytesRead: PAGE_BYTES })
    const legacy = []
    for (const doc of res.page) {
      if (doc.extractedText === undefined) continue
      legacy.push({ documentId: doc._id, chars: doc.extractedText.length })
    }
    return {
      legacy,
      seen: res.page.length,
      cursor: res.continueCursor,
      isDone: res.isDone,
    }
  },
})

/**
 * Move the legacy text of a few documents to `documentTexts`, then drop the
 * field. Re-reads every row: the batch was selected by a scan that finished
 * minutes ago, and a replayed batch must find nothing left to do.
 */
export const migrateBatch = internalMutation({
  args: { documentIds: v.array(v.id('documents')) },
  handler: async (ctx, { documentIds }) => {
    let copied = 0
    let dropped = 0
    let skipped = 0
    for (const documentId of documentIds) {
      const doc = await ctx.db.get('documents', documentId)
      // Gone, or already migrated by a replayed batch.
      if (!doc || doc.extractedText === undefined) {
        skipped += 1
        continue
      }
      const existing = await ctx.db
        .query('documentTexts')
        .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
        .first()
      // The blob already has its text (the live pipeline, or an earlier row of
      // the same fan-out in this very batch), or there is nothing to keep.
      if (existing || doc.extractedText.length === 0) {
        await ctx.db.patch('documents', documentId, {
          extractedText: undefined,
        })
        dropped += 1
        continue
      }
      const { text, truncated } = boundText(doc.extractedText)
      await ctx.db.insert('documentTexts', {
        storageId: doc.storageId,
        text,
        truncated,
      })
      await ctx.db.patch('documents', documentId, {
        extractedText: undefined,
        ocrState: 'extracted',
        ocrChars: text.length,
        vectorState: undefined,
        vectorDetail: undefined,
      })
      copied += 1
    }
    return { copied, dropped, skipped }
  },
})
