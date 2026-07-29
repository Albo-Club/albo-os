/**
 * Document & report vectorization (semantic search) via @convex-dev/rag.
 *
 * One RAG namespace per org (namespace = orgId string) → strict multi-tenant
 * isolation at the index level; every search surface must STILL check org
 * membership (the namespace isolates, auth authorizes).
 *
 * What gets indexed (always text, never file bytes — extraction is NOT done
 * here, it belongs to `documentsExtract.ts` which writes `documentTexts`):
 * - `documents` rows with `source: 'upload'` — their blob's `documentTexts`
 *   text, indexed when `documentsExtract.run` completes (it schedules
 *   `indexDocument`). Entry key `doc:<documentId>`.
 * - `companyReports` — the pipeline's combined `rawContent` (email body +
 *   attachments + links), indexed from `reportStore.storeForCompany`.
 *   Entry key `report:<reportId>`. Email-ingested `documents` rows are NOT
 *   indexed individually: their text is already inside the report entry.
 *
 * Keys make ingestion idempotent: re-adding the same key replaces the entry
 * (safe backfill re-runs, re-extraction re-indexes). Embeddings:
 * qwen/qwen3-embedding-8b via OpenRouter (same billing account as the agent
 * chat model, EU-hosted provider).
 */

import { RAG } from '@convex-dev/rag'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import {
  internalAction,
  internalQuery,
} from './_generated/server'
import { readMembership } from './lib/agentScope'

import type { ActionCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// Pinned model id (not a "latest" alias): retrieval quality must not change
// silently under our feet. Changing model or dimension = new namespaces +
// full backfill re-run (embeddings from different models are incompatible).
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const EMBEDDING_DIMENSION = 4096 // Qwen3 native; Convex vector index max

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

type Filters = {
  companyId: string
  kind: string
}

export const rag = new RAG<Filters>(components.rag, {
  textEmbeddingModel: openrouter.textEmbeddingModel(EMBEDDING_MODEL, {
    // Pin the EU-hosted provider (Nebius Token Factory, NL) instead of
    // OpenRouter's load balancing: document text must not transit through
    // other hosts. No fallback on purpose — indexing is scheduled (a retry
    // re-runs it) and a search outage is acceptable; widen only knowingly.
    provider: { order: ['nebius'], allow_fallbacks: false },
  }),
  embeddingDimension: EMBEDDING_DIMENSION,
  filterNames: ['companyId', 'kind'],
})

// ─── Internal data access ────────────────────────────────────────────────────

export const getDocumentForIndex = internalQuery({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    const company = await ctx.db.get('companies', doc.companyId)
    const textRow = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    return {
      doc,
      companyName: company?.name ?? '',
      text: textRow?.text ?? null,
    }
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

function indexableDocument(doc: Doc<'documents'>): boolean {
  // Email-ingested rows are covered by their report entry; inline images are
  // analysis artefacts.
  return doc.source === 'upload' && doc.inline !== true
}

async function indexDocumentImpl(
  ctx: ActionCtx,
  doc: Doc<'documents'>,
  companyName: string,
  text: string | null,
): Promise<'indexed' | 'skipped'> {
  if (!indexableDocument(doc) || !text) return 'skipped'

  // Header line so company / kind / title are searchable content too.
  const header = `Document "${doc.title}" (${doc.kind}) — ${companyName}`
  await rag.add(ctx, {
    namespace: doc.orgId,
    key: `doc:${doc._id}`,
    title: doc.title,
    text: `${header}\n\n${text}`,
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
    text: `${header}\n\n${report.rawContent}`,
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
    const state = await indexDocumentImpl(
      ctx,
      found.doc,
      found.companyName,
      found.text,
    )
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

    const entryById = new Map(entries.map((e) => [e.entryId, e]))
    return {
      results: results.map((r) => {
        const entry = entryById.get(r.entryId)
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

export const listDocumentIdsForBackfill = internalQuery({
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
    return rows.map((r) => r._id)
  },
})

export const listReportIdsForBackfill = internalQuery({
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
    return rows.map((r) => r._id)
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
  let indexed = 0
  let skipped = 0
  let queued = 0

  const docIds = await ctx.runQuery(
    internal.vectorize.listDocumentIdsForBackfill,
    { orgId },
  )
  for (const documentId of docIds) {
    const found = await ctx.runQuery(internal.vectorize.getDocumentForIndex, {
      documentId,
    })
    if (!found) continue
    if (indexableDocument(found.doc) && !found.text && !found.doc.ocrState) {
      // Uploaded before extraction existed: run the reading now — its end
      // schedules indexDocument, so the entry lands once the OCR is done.
      await ctx.scheduler.runAfter(0, internal.documentsExtract.run, {
        documentId,
      })
      queued++
      continue
    }
    const state = await indexDocumentImpl(
      ctx,
      found.doc,
      found.companyName,
      found.text,
    )
    if (state === 'indexed') indexed++
    else skipped++
  }

  const reportIds = await ctx.runQuery(
    internal.vectorize.listReportIdsForBackfill,
    { orgId },
  )
  for (const reportId of reportIds) {
    const found = await ctx.runQuery(internal.vectorize.getReportForIndex, {
      reportId,
    })
    if (!found) continue
    const state = await indexReportImpl(ctx, found.report, found.companyName)
    if (state === 'indexed') indexed++
    else skipped++
  }

  const summary = `[vectorize] backfill org ${orgId}: ${indexed} indexed, ${skipped} skipped, ${queued} queued for extraction`
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
