/**
 * Text extraction for a single stored document (manual uploads).
 *
 * Same reading rules as the report pipeline's content router
 * (`reportExtract.ts`), reduced to one file: PDF → Mistral OCR, image → OCR
 * (logo-sized ones skipped), Excel/CSV → parsers, anything else → kept
 * without extraction. Closed world: the run always ends by recording one of
 * 'extracted' | 'skipped' | 'failed' on the document, so a document is never
 * left silently unreadable — and a failed read never touches the file.
 *
 * The text itself is written once per storage blob (`documentTexts`), which
 * is what lets the report fan-out share a single extraction across the
 * `documents` rows of every matched entity.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { csvToText, excelToText } from './lib/excel'
import { EXCEL_EXTS, MIN_OCR_IMAGE_BYTES, boundText, ext, isImage } from './lib/fileText'
import { ocrImage, ocrPdf } from './lib/ocr'

import type { Id } from './_generated/dataModel'

type ExtractState = 'extracted' | 'skipped' | 'failed'

interface ExtractTarget {
  storageId: Id<'_storage'>
  title: string
  contentType?: string
  /** Set when the blob's text was already extracted (report fan-out, re-upload). */
  existingChars: number | null
}

/**
 * A manual upload carries a user-chosen title that may have no extension, so
 * the content type leads and the title's extension is the fallback (for email
 * attachments the title IS the filename).
 */
function classify(title: string, contentType?: string): 'pdf' | 'excel' | 'csv' | 'image' | 'other' {
  const e = ext(title)
  const ct = contentType ?? ''
  if (e === 'pdf' || ct === 'application/pdf') return 'pdf'
  if (EXCEL_EXTS.has(e) || ct.includes('spreadsheet') || ct.includes('ms-excel')) return 'excel'
  if (e === 'csv' || ct === 'text/csv') return 'csv'
  if (isImage(title, contentType)) return 'image'
  return 'other'
}

// ─── Reads & writes ──────────────────────────────────────────────────────────

export const getTarget = internalQuery({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<ExtractTarget | null> => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    const existing = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    return {
      storageId: doc.storageId,
      title: doc.title,
      contentType: doc.contentType,
      existingChars: existing ? existing.text.length : null,
    }
  },
})

/** Upsert the extracted text of a storage blob (one row per blob). */
export const saveStorageText = internalMutation({
  args: {
    storageId: v.id('_storage'),
    text: v.string(),
    truncated: v.boolean(),
  },
  handler: async (ctx, { storageId, text, truncated }) => {
    const existing = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first()
    if (existing) {
      await ctx.db.patch('documentTexts', existing._id, { text, truncated })
    } else {
      await ctx.db.insert('documentTexts', { storageId, text, truncated })
    }
    return null
  },
})

export const setState = internalMutation({
  args: {
    documentId: v.id('documents'),
    ocrState: v.union(
      v.literal('extracted'),
      v.literal('skipped'),
      v.literal('failed'),
    ),
    ocrDetail: v.optional(v.string()),
    ocrChars: v.optional(v.number()),
  },
  handler: async (ctx, { documentId, ocrState, ocrDetail, ocrChars }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    await ctx.db.patch('documents', documentId, { ocrState, ocrDetail, ocrChars })
    return null
  },
})

// ─── The run ─────────────────────────────────────────────────────────────────

export const run = internalAction({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const target: ExtractTarget | null = await ctx.runQuery(internal.documentsExtract.getTarget, {
      documentId,
    })
    if (!target) return null

    // The blob's text is already known (report attachment, or the same file
    // uploaded twice): adopt it instead of paying for a second OCR.
    if (target.existingChars !== null) {
      await ctx.runMutation(internal.documentsExtract.setState, {
        documentId,
        ocrState: 'extracted',
        ocrChars: target.existingChars,
      })
      // Text available → semantic index (skips non-upload rows itself).
      await ctx.scheduler.runAfter(0, internal.vectorize.indexDocument, {
        documentId,
      })
      return null
    }

    const blob = await ctx.storage.get(target.storageId)
    if (!blob) {
      await ctx.runMutation(internal.documentsExtract.setState, {
        documentId,
        ocrState: 'failed',
        ocrDetail: 'download_failed',
      })
      return null
    }
    const buf = await blob.arrayBuffer()

    let text = ''
    let state: ExtractState = 'skipped'
    let detail: string | undefined

    switch (classify(target.title, target.contentType)) {
      case 'pdf': {
        text = await ocrPdf(buf)
        if (text) state = 'extracted'
        else {
          state = 'failed'
          detail = 'ocr_failed'
        }
        break
      }
      case 'excel': {
        try {
          text = excelToText(buf, target.title)
          if (text) state = 'extracted'
          else detail = 'empty_workbook'
        } catch (err) {
          console.warn(`[documentsExtract] excel parse failed for ${target.title}:`, err)
          state = 'failed'
          detail = 'parse_failed'
        }
        break
      }
      case 'csv': {
        text = csvToText(buf, target.title)
        state = 'extracted'
        break
      }
      case 'image': {
        if (buf.byteLength < MIN_OCR_IMAGE_BYTES) {
          detail = 'small_image_skipped'
        } else {
          text = await ocrImage(buf, target.contentType ?? 'image/png')
          if (text) state = 'extracted'
          else {
            state = 'failed'
            detail = 'ocr_failed'
          }
        }
        break
      }
      default:
        detail = 'unsupported_format'
    }

    if (state === 'extracted') {
      const bounded = boundText(text)
      await ctx.runMutation(internal.documentsExtract.saveStorageText, {
        storageId: target.storageId,
        text: bounded.text,
        truncated: bounded.truncated,
      })
      await ctx.runMutation(internal.documentsExtract.setState, {
        documentId,
        ocrState: 'extracted',
        ocrChars: bounded.text.length,
      })
      // Fresh text → semantic index (skips non-upload rows itself).
      await ctx.scheduler.runAfter(0, internal.vectorize.indexDocument, {
        documentId,
      })
    } else {
      await ctx.runMutation(internal.documentsExtract.setState, {
        documentId,
        ocrState: state,
        ocrDetail: detail,
      })
    }

    console.log(`[documentsExtract] ${target.title}: ${state}${detail ? ` (${detail})` : ''}`)
    return null
  },
})
