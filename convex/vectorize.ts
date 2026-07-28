/**
 * Document & report vectorization (semantic search) via @convex-dev/rag.
 *
 * One RAG namespace per org (namespace = orgId string) → strict multi-tenant
 * isolation at the index level; every search surface must STILL check org
 * membership (the namespace isolates, auth authorizes).
 *
 * What gets indexed (all text, never file bytes):
 * - `documents` rows with `source: 'upload'` (manual uploads) — text produced
 *   here by the shared extraction helpers (Mistral OCR for PDF/images,
 *   excel/csv parsing, plain text passthrough), persisted on
 *   `documents.extractedText`, then embedded. Entry key `doc:<documentId>`.
 * - `companyReports` — the pipeline's combined `rawContent` (email body +
 *   attachments + links), already extracted upstream. Entry key
 *   `report:<reportId>`. Email-ingested `documents` rows are NOT indexed
 *   individually: their text is already inside the report entry.
 *
 * Keys make ingestion idempotent: re-adding the same key replaces the entry
 * (safe backfill re-runs). Embeddings: qwen/qwen3-embedding-8b via OpenRouter
 * (same billing account as the agent chat model, EU-hosted provider).
 */

import { RAG } from '@convex-dev/rag'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { readMembership } from './lib/agentScope'
import { csvToText, excelToText } from './lib/excel'
import { ocrImage, ocrPdf } from './lib/ocr'

import type { ActionCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// Pinned model id (not a "latest" alias): retrieval quality must not change
// silently under our feet. Changing model or dimension = new namespaces +
// full backfill re-run (embeddings from different models are incompatible).
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const EMBEDDING_DIMENSION = 4096 // Qwen3 native; Convex vector index max

// Same combined-text budget as the report pipeline (1MB doc cap headroom).
const MAX_INDEX_CHARS = 150_000

const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

type Filters = {
  companyId: string
  kind: string
}

export const rag = new RAG<Filters>(components.rag, {
  textEmbeddingModel: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
  embeddingDimension: EMBEDDING_DIMENSION,
  filterNames: ['companyId', 'kind'],
})

// ─── Text extraction (shared with upload + backfill paths) ───────────────────

function ext(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * Produce text for a stored file: Mistral OCR for PDF/images, parser for
 * Excel/CSV, passthrough for plain text. Returns '' when the format has no
 * extractable text (the caller records the skip) — extraction never throws.
 */
async function extractFileText(
  buf: ArrayBuffer,
  title: string,
  contentType: string | undefined,
): Promise<string> {
  const e = ext(title)
  if (contentType === 'application/pdf' || e === 'pdf') {
    return await ocrPdf(buf)
  }
  if (contentType?.startsWith('image/') || IMAGE_EXTS.has(e)) {
    return await ocrImage(buf, contentType ?? 'image/png')
  }
  if (EXCEL_EXTS.has(e)) {
    try {
      return excelToText(buf, title)
    } catch {
      return ''
    }
  }
  if (e === 'csv' || contentType === 'text/csv') {
    try {
      return csvToText(buf, title)
    } catch {
      return ''
    }
  }
  if (contentType?.startsWith('text/') || e === 'txt' || e === 'md') {
    return new TextDecoder().decode(buf)
  }
  return ''
}

function cap(text: string): string {
  return text.length > MAX_INDEX_CHARS
    ? `${text.slice(0, MAX_INDEX_CHARS)}\n[...tronqué]`
    : text
}

// ─── Internal data access ────────────────────────────────────────────────────

export const getDocumentForIndex = internalQuery({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    const company = await ctx.db.get('companies', doc.companyId)
    return { doc, companyName: company?.name ?? '' }
  },
})

export const getReportForIndex = internalQuery({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) return null
    const company = await ctx.db.get('companies', report.companyId)
    return { report, companyName: company?.name ?? '' }
  },
})

export const setExtractedText = internalMutation({
  args: {
    documentId: v.id('documents'),
    extractedText: v.string(),
  },
  handler: async (ctx, { documentId, extractedText }) => {
    // The row may have been deleted while OCR was running.
    const doc = await ctx.db.get('documents', documentId)
    if (doc) await ctx.db.patch('documents', documentId, { extractedText })
    return null
  },
})

export const getCompanyName = internalQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    return company?.name ?? ''
  },
})

export const assertMemberInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    userId: v.id('users'),
  },
  handler: async (ctx, { orgId, userId }) => {
    await readMembership(ctx, orgId, userId)
    return null
  },
})

// ─── Indexing implementations (shared by live ingestion + backfill) ──────────

async function indexDocumentImpl(
  ctx: ActionCtx,
  doc: Doc<'documents'>,
  companyName: string,
): Promise<'indexed' | 'skipped'> {
  // Email-ingested rows are covered by their report entry; inline images are
  // analysis artefacts.
  if (doc.source !== 'upload' || doc.inline === true) return 'skipped'

  let text = doc.extractedText
  if (!text) {
    const blob = await ctx.storage.get(doc.storageId)
    if (!blob) return 'skipped'
    text = await extractFileText(
      await blob.arrayBuffer(),
      doc.title,
      doc.contentType,
    )
    if (!text) return 'skipped'
    text = cap(text)
    await ctx.runMutation(internal.vectorize.setExtractedText, {
      documentId: doc._id,
      extractedText: text,
    })
  }

  // Header line so company / kind / title are searchable content too.
  const header = `Document "${doc.title}" (${doc.kind}) — ${companyName}`
  await rag.add(ctx, {
    namespace: doc.orgId,
    key: `doc:${doc._id}`,
    title: doc.title,
    text: cap(`${header}\n\n${text}`),
    filterValues: [
      { name: 'companyId', value: doc.companyId },
      { name: 'kind', value: doc.kind },
    ],
  })
  return 'indexed'
}

async function indexReportImpl(
  ctx: ActionCtx,
  report: Doc<'companyReports'>,
  companyName: string,
): Promise<'indexed' | 'skipped'> {
  if (!report.rawContent) return 'skipped'
  const title = report.title ?? report.subject ?? 'Report'
  const header = `Report ${companyName} — ${report.reportPeriod ?? ''} — ${title}`
  await rag.add(ctx, {
    namespace: report.orgId,
    key: `report:${report._id}`,
    title,
    text: cap(`${header}\n\n${report.rawContent}`),
    filterValues: [
      { name: 'companyId', value: report.companyId },
      { name: 'kind', value: 'report' },
    ],
  })
  return 'indexed'
}

// ─── Live ingestion entry points ─────────────────────────────────────────────

export const indexDocument = internalAction({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const found = await ctx.runQuery(internal.vectorize.getDocumentForIndex, {
      documentId,
    })
    if (!found) return null
    const state = await indexDocumentImpl(ctx, found.doc, found.companyName)
    console.log(`[vectorize] document ${documentId}: ${state}`)
    return null
  },
})

export const indexReport = internalAction({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const found = await ctx.runQuery(internal.vectorize.getReportForIndex, {
      reportId,
    })
    if (!found) return null
    const state = await indexReportImpl(ctx, found.report, found.companyName)
    console.log(`[vectorize] report ${reportId}: ${state}`)
    return null
  },
})

/** Remove an entry after its source row is deleted (scheduled from mutations). */
export const removeEntry = internalAction({
  args: {
    orgId: v.id('organizations'),
    key: v.string(),
  },
  handler: async (ctx, { orgId, key }) => {
    const ns = await rag.getNamespace(ctx, { namespace: orgId })
    if (!ns) return null
    await rag.deleteByKey(ctx, { namespaceId: ns.namespaceId, key })
    return null
  },
})

// ─── Semantic search (agent tool backend) ────────────────────────────────────

export const searchInternal = internalAction({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    query: v.string(),
    companyId: v.optional(v.id('companies')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // The namespace isolates, auth authorizes: re-check org membership.
    await ctx.runQuery(internal.vectorize.assertMemberInternal, {
      orgId: args.orgId,
      userId: args.actorUserId,
    })

    const { results, entries } = await rag.search(ctx, {
      namespace: args.orgId,
      query: args.query,
      filters: args.companyId
        ? [{ name: 'companyId', value: args.companyId }]
        : [],
      limit: Math.min(args.limit ?? 15, 30),
      // A neighbor chunk on each side keeps excerpts coherent.
      chunkContext: { before: 1, after: 1 },
    })

    const titleByEntry = new Map(entries.map((e) => [e.entryId, e]))
    return {
      results: results.map((r) => {
        const entry = titleByEntry.get(r.entryId)
        return {
          source: entry?.title ?? 'unknown',
          sourceKey: entry?.key ?? null,
          score: r.score,
          excerpt: r.content.map((c) => c.text).join('\n'),
        }
      }),
    }
  },
})

// ─── Backfill (one-shot, idempotent — cf. MIGRATIONS.md) ─────────────────────

const BACKFILL_BATCH = 2000

export const listDocumentsForBackfill = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('documents')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(BACKFILL_BATCH)
    if (rows.length === BACKFILL_BATCH) {
      console.warn(
        `[vectorize] backfill hit the ${BACKFILL_BATCH} documents cap for org ${orgId} — rows beyond the cap were NOT indexed`,
      )
    }
    return rows
  },
})

export const listReportsForBackfill = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('companyReports')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(BACKFILL_BATCH)
    if (rows.length === BACKFILL_BATCH) {
      console.warn(
        `[vectorize] backfill hit the ${BACKFILL_BATCH} reports cap for org ${orgId} — rows beyond the cap were NOT indexed`,
      )
    }
    return rows
  },
})

export const listOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query('organizations').take(100)
    return orgs.map((o) => o._id)
  },
})

async function backfillOrgImpl(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
): Promise<string> {
  const companyNames = new Map<Id<'companies'>, string>()
  const nameOf = async (companyId: Id<'companies'>): Promise<string> => {
    const cached = companyNames.get(companyId)
    if (cached !== undefined) return cached
    const found: string = await ctx.runQuery(
      internal.vectorize.getCompanyName,
      { companyId },
    )
    companyNames.set(companyId, found)
    return found
  }

  let indexed = 0
  let skipped = 0
  const docs = await ctx.runQuery(internal.vectorize.listDocumentsForBackfill, {
    orgId,
  })
  for (const doc of docs) {
    const state = await indexDocumentImpl(ctx, doc, await nameOf(doc.companyId))
    if (state === 'indexed') indexed++
    else skipped++
  }

  const reports = await ctx.runQuery(internal.vectorize.listReportsForBackfill, {
    orgId,
  })
  for (const report of reports) {
    const state = await indexReportImpl(
      ctx,
      report,
      await nameOf(report.companyId),
    )
    if (state === 'indexed') indexed++
    else skipped++
  }

  const summary = `[vectorize] backfill org ${orgId}: ${indexed} indexed, ${skipped} skipped`
  console.log(summary)
  return summary
}

export const backfillOrg = internalAction({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<string> => {
    return await backfillOrgImpl(ctx, orgId)
  },
})

export const backfillAll = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<string>> => {
    const orgIds = await ctx.runQuery(internal.vectorize.listOrgIds, {})
    const summaries: Array<string> = []
    for (const orgId of orgIds) {
      summaries.push(await backfillOrgImpl(ctx, orgId))
    }
    return summaries
  },
})
