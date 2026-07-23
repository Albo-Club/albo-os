/**
 * Brick 4 — content extraction: the closed-world router.
 *
 * Runs after identification (brick 3). Every attachment and every detected
 * link ends in EXACTLY one of three states — 'extracted' (text obtained),
 * 'stored' (kept without extraction: unknown formats, small images), or
 * 'failed' (with a machine-code detail) — so an unforeseen format can never
 * produce an unforeseen error. A failing source never stops the run; only
 * "no content at all" sends the row to the review queue ('no_content').
 *
 * Sources: body, PDF (Mistral OCR — the configured chat model doesn't read
 * PDFs), images (OCR, small logos skipped), Excel/CSV, Notion (public pages,
 * failure = nominal), Google Drive (public exports), DocSend (docsend2pdf.com,
 * per validated decision), tracking links (resolved only when no direct link).
 * Everything else → catch-all 'stored'.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { downloadAttachment } from './agentmail'
import { csvToText, excelToText } from './lib/excel'
import { downloadDocSend } from './lib/docsend'
import { fetchNotionText } from './lib/notion'
import { ocrImage, ocrPdf } from './lib/ocr'
import { detectLinks, htmlToText, resolveTrackingUrl } from './lib/reportLinks'
import type { Id } from './_generated/dataModel'

const MAX_FILE_BYTES = 20 * 1024 * 1024 // Convex storage cap
const MIN_OCR_IMAGE_BYTES = 15_000 // below this, images are logos/signatures
const MAX_EXTRACTED_CHARS = 150_000 // combined text budget (1MB doc cap)
const MAX_LINKS_PER_KIND = 3

const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

interface SourceOutcome {
  kind: string
  label: string
  state: 'extracted' | 'stored' | 'failed'
  detail?: string
  chars?: number
}

function ext(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function isImage(filename: string, contentType?: string): boolean {
  return IMAGE_EXTS.has(ext(filename)) || Boolean(contentType?.startsWith('image/'))
}

// ─── Claim + persist ─────────────────────────────────────────────────────────

export const markExtracting = internalMutation({
  args: { inboundEmailId: v.id('inboundEmails') },
  handler: async (ctx, { inboundEmailId }): Promise<boolean> => {
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row || row.status !== 'received' || !row.matchedCompanies || row.sources) {
      return false
    }
    await ctx.db.patch('inboundEmails', inboundEmailId, { status: 'processing' })
    return true
  },
})

export const setExtraction = internalMutation({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    sources: v.array(
      v.object({
        kind: v.string(),
        label: v.string(),
        state: v.union(v.literal('extracted'), v.literal('stored'), v.literal('failed')),
        detail: v.optional(v.string()),
        chars: v.optional(v.number()),
      }),
    ),
    extractedText: v.optional(v.string()),
    attachmentStorageIds: v.array(
      v.object({ attachmentId: v.string(), storageId: v.id('_storage') }),
    ),
    noContent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('inboundEmails', args.inboundEmailId)
    if (!row) return null
    const byId = new Map(args.attachmentStorageIds.map((a) => [a.attachmentId, a.storageId]))
    const attachments = row.attachments.map((a) => ({
      ...a,
      storageId: byId.get(a.attachmentId) ?? a.storageId,
    }))
    await ctx.db.patch('inboundEmails', args.inboundEmailId, {
      attachments,
      sources: args.sources,
      extractedText: args.extractedText,
      ...(args.noContent
        ? { status: 'needs_review' as const, statusReason: 'no_content' }
        : { status: 'received' as const }),
    })
    // Chain report sheet + metrics + storage (brick 5), or notify the
    // no-content failure (brick 6).
    if (!args.noContent) {
      await ctx.scheduler.runAfter(0, internal.reportStore.run, {
        inboundEmailId: args.inboundEmailId,
      })
    } else {
      await ctx.scheduler.runAfter(0, internal.reportNotify.send, {
        inboundEmailId: args.inboundEmailId,
        kind: 'failure',
        reason: 'no_content',
      })
    }
    return null
  },
})

// ─── Link downloads ──────────────────────────────────────────────────────────

async function downloadGDrive(
  url: string,
  fileId: string,
): Promise<{ buf: ArrayBuffer; kind: 'pdf' | 'excel' | 'other'; contentType: string } | null> {
  let target: string
  let kind: 'pdf' | 'excel' | 'other' = 'other'
  if (url.includes('/spreadsheets/')) {
    target = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`
    kind = 'excel'
  } else if (url.includes('/document/')) {
    target = `https://docs.google.com/document/d/${fileId}/export?format=pdf`
    kind = 'pdf'
  } else if (url.includes('/presentation/')) {
    target = `https://docs.google.com/presentation/d/${fileId}/export?format=pdf`
    kind = 'pdf'
  } else {
    target = `https://drive.google.com/uc?export=download&id=${fileId}`
  }
  try {
    const res = await fetch(target, { redirect: 'follow' })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    // A private file redirects to an HTML sign-in page — not a download.
    if (contentType.includes('text/html')) return null
    const buf = await res.arrayBuffer()
    if (kind === 'other') {
      if (contentType.includes('pdf')) kind = 'pdf'
      else if (contentType.includes('spreadsheet') || contentType.includes('ms-excel'))
        kind = 'excel'
    }
    return { buf, kind, contentType }
  } catch {
    return null
  }
}

// ─── The run ─────────────────────────────────────────────────────────────────

export const run = internalAction({
  args: { inboundEmailId: v.id('inboundEmails') },
  handler: async (ctx, { inboundEmailId }) => {
    const claimed: boolean = await ctx.runMutation(internal.reportExtract.markExtracting, {
      inboundEmailId,
    })
    if (!claimed) return null

    const row = await ctx.runQuery(internal.reportIdentify.getRow, { inboundEmailId })
    if (!row) return null

    const outcomes: Array<SourceOutcome> = []
    const texts: Array<string> = []
    const attachmentStorageIds: Array<{ attachmentId: string; storageId: Id<'_storage'> }> = []

    const addText = (header: string, text: string) => {
      texts.push(`--- ${header} ---\n${text}`)
    }

    // 1. Email body
    const bodyText = row.bodyText || (row.bodyHtml ? htmlToText(row.bodyHtml) : '')
    if (bodyText.trim()) {
      addText('CORPS DU MAIL', bodyText.trim())
      outcomes.push({ kind: 'body', label: 'email', state: 'extracted', chars: bodyText.length })
    }

    // 2. Attachments — every file ends in exactly one state. A file already
    //    in Convex storage (Gmail-captured email, cf. gmail.processAsReport)
    //    is read from there — never fetched from AgentMail, never re-stored.
    for (const att of row.attachments) {
      const label = att.filename
      let buf: ArrayBuffer | null
      if (att.storageId) {
        const blob = await ctx.storage.get(att.storageId)
        buf = blob ? await blob.arrayBuffer() : null
      } else {
        buf = await downloadAttachment(row.agentmailInboxId, row.agentmailMessageId, att.attachmentId)
      }
      if (!buf) {
        outcomes.push({ kind: 'other', label, state: 'failed', detail: 'download_failed' })
        continue
      }
      if (buf.byteLength > MAX_FILE_BYTES) {
        outcomes.push({ kind: 'other', label, state: 'failed', detail: 'file_too_large' })
        continue
      }
      const storageId =
        att.storageId ??
        (await ctx.storage.store(
          new Blob([buf], { type: att.contentType ?? 'application/octet-stream' }),
        ))
      attachmentStorageIds.push({ attachmentId: att.attachmentId, storageId })

      const e = ext(att.filename)
      if (e === 'pdf' || att.contentType === 'application/pdf') {
        const text = await ocrPdf(buf)
        if (text) {
          addText(`PDF ${label}`, text)
          outcomes.push({ kind: 'pdf', label, state: 'extracted', chars: text.length })
        } else {
          outcomes.push({ kind: 'pdf', label, state: 'failed', detail: 'ocr_failed' })
        }
      } else if (EXCEL_EXTS.has(e)) {
        try {
          const text = excelToText(buf, att.filename)
          if (text) {
            addText(`EXCEL ${label}`, text)
            outcomes.push({ kind: 'excel', label, state: 'extracted', chars: text.length })
          } else {
            outcomes.push({ kind: 'excel', label, state: 'stored', detail: 'empty_workbook' })
          }
        } catch (err) {
          console.warn(`[reportExtract] excel parse failed for ${label}:`, err)
          outcomes.push({ kind: 'excel', label, state: 'failed', detail: 'parse_failed' })
        }
      } else if (e === 'csv') {
        const text = csvToText(buf, att.filename)
        addText(`CSV ${label}`, text)
        outcomes.push({ kind: 'excel', label, state: 'extracted', chars: text.length })
      } else if (isImage(att.filename, att.contentType)) {
        if (buf.byteLength < MIN_OCR_IMAGE_BYTES) {
          // Logos / signature images: keep, don't OCR.
          outcomes.push({ kind: 'image', label, state: 'stored', detail: 'small_image_skipped' })
        } else {
          const text = await ocrImage(buf, att.contentType ?? 'image/png')
          if (text) {
            addText(`IMAGE ${label}`, text)
            outcomes.push({ kind: 'image', label, state: 'extracted', chars: text.length })
          } else {
            outcomes.push({ kind: 'image', label, state: 'failed', detail: 'ocr_failed' })
          }
        }
      } else {
        // Catch-all: unknown formats are stored, never an error.
        outcomes.push({ kind: 'other', label, state: 'stored' })
      }
    }

    // 3. Links — detected on body text + HTML; tracking redirects resolved
    //    only when no direct link was found.
    const linkText = `${bodyText} ${row.bodyHtml ?? ''}`
    const links = detectLinks(linkText)
    const hasDirect =
      links.notion.length + links.googleDrive.length + links.docSend.length > 0
    if (!hasDirect && links.tracking.length > 0) {
      for (const tUrl of links.tracking.slice(0, 5)) {
        const resolved = await resolveTrackingUrl(tUrl)
        if (!resolved) continue
        const extra = detectLinks(resolved)
        links.notion.push(...extra.notion)
        links.googleDrive.push(...extra.googleDrive)
        links.docSend.push(...extra.docSend)
      }
    }

    for (const url of [...new Set(links.notion)].slice(0, MAX_LINKS_PER_KIND)) {
      const text = await fetchNotionText(url)
      if (text) {
        addText(`NOTION ${url}`, text)
        outcomes.push({ kind: 'notion', label: url, state: 'extracted', chars: text.length })
      } else {
        outcomes.push({ kind: 'notion', label: url, state: 'failed', detail: 'notion_unreachable' })
      }
    }

    for (const { url, fileId } of links.googleDrive.slice(0, MAX_LINKS_PER_KIND)) {
      const dl = await downloadGDrive(url, fileId)
      if (!dl) {
        outcomes.push({ kind: 'gdrive', label: url, state: 'failed', detail: 'gdrive_unreachable' })
        continue
      }
      if (dl.buf.byteLength > MAX_FILE_BYTES) {
        outcomes.push({ kind: 'gdrive', label: url, state: 'failed', detail: 'file_too_large' })
        continue
      }
      if (dl.kind === 'pdf') {
        const text = await ocrPdf(dl.buf)
        if (text) {
          addText(`GOOGLE DRIVE ${url}`, text)
          outcomes.push({ kind: 'gdrive', label: url, state: 'extracted', chars: text.length })
        } else {
          outcomes.push({ kind: 'gdrive', label: url, state: 'failed', detail: 'ocr_failed' })
        }
      } else if (dl.kind === 'excel') {
        try {
          const text = excelToText(dl.buf, url)
          addText(`GOOGLE DRIVE ${url}`, text)
          outcomes.push({ kind: 'gdrive', label: url, state: 'extracted', chars: text.length })
        } catch {
          outcomes.push({ kind: 'gdrive', label: url, state: 'failed', detail: 'parse_failed' })
        }
      } else {
        outcomes.push({ kind: 'gdrive', label: url, state: 'stored' })
      }
    }

    for (const url of [...new Set(links.docSend)].slice(0, MAX_LINKS_PER_KIND)) {
      const buf = await downloadDocSend(url, row.realSenderEmail ?? row.fromEmail)
      if (!buf || buf.byteLength > MAX_FILE_BYTES) {
        outcomes.push({ kind: 'docsend', label: url, state: 'failed', detail: 'docsend_failed' })
        continue
      }
      const text = await ocrPdf(buf)
      if (text) {
        addText(`DOCSEND ${url}`, text)
        outcomes.push({ kind: 'docsend', label: url, state: 'extracted', chars: text.length })
      } else {
        outcomes.push({ kind: 'docsend', label: url, state: 'failed', detail: 'ocr_failed' })
      }
    }

    // 4. Persist. "No content at all" = nothing extracted AND no stored file
    //    → review queue; partial failures never block.
    const combined = texts.join('\n\n')
    const extractedText = combined
      ? combined.length > MAX_EXTRACTED_CHARS
        ? `${combined.slice(0, MAX_EXTRACTED_CHARS)}\n[...tronqué]`
        : combined
      : undefined
    const hasStoredFile = attachmentStorageIds.length > 0
    const noContent = !extractedText && !hasStoredFile

    await ctx.runMutation(internal.reportExtract.setExtraction, {
      inboundEmailId,
      sources: outcomes,
      extractedText,
      attachmentStorageIds,
      noContent,
    })

    const counts = {
      extracted: outcomes.filter((o) => o.state === 'extracted').length,
      stored: outcomes.filter((o) => o.state === 'stored').length,
      failed: outcomes.filter((o) => o.state === 'failed').length,
    }
    console.log(
      `[reportExtract] ${row.agentmailMessageId}: ${counts.extracted} extracted, ${counts.stored} stored, ${counts.failed} failed${noContent ? ' → no_content' : ''}`,
    )
    return null
  },
})
