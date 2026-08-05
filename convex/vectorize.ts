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
 *
 * ── Trace & failure handling (same mechanic as `ocrState`, one layer down) ──
 * Every submission ends by recording `vectorState` + `vectorDetail` on its
 * row ('indexed' | 'skipped' | 'failed', 'pending' while queued/retrying) —
 * an indexing is never silently lost. Transient failures retry
 * MAX_INDEX_ATTEMPTS times with spaced delays; after the last one the org
 * members subscribed to that alert get an email (`vectorizeFailureEmail`) and
 * the UI offers a manual relaunch (`documents.reindex`), like the OCR's
 * `reextract`.
 *
 * `vectorDetail` names the failing pipeline layer (`classifyIndexError`):
 *   - our data:    'no_text' / 'no_content' / 'covered_by_report' /
 *                  'inline_image' / 'spreadsheet' (skips, not errors)
 *   - request out: 'provider_unreachable' (never reached the provider)
 *   - provider:    'provider_http_<status>' (HTTP error, e.g. _429 = the
 *                  provider's shared token quota is saturated)
 *   - response:    'provider_bad_response' (answered, unusable payload)
 *   - our code:    'index_write_failed' (embeddings OK, Convex write failed)
 *
 * Sequencing: one document per action run (batch of 1); within a run the RAG
 * component hands the embedder 100 chunks at a time, which we split further
 * into MAX_EMBEDDINGS_PER_CALL-sized HTTP calls (see below), so no single
 * provider call ever carries a whole large corpus.
 */

import { RAG } from '@convex-dev/rag'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { wrapEmbeddingModel } from 'ai'
import { v } from 'convex/values'

import { components, internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { readMembership } from './lib/agentScope'
import { isSpreadsheet } from './lib/fileText'
import { wantsAlert } from './lib/notificationPrefs'
import { classifyIndexError } from './lib/vectorizeErrors'
import { RESEND_FROM, resend } from './email'
import { vectorizeFailureEmail } from './emailTemplates'

import type { ActionCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// Pinned model id (not a "latest" alias): retrieval quality must not change
// silently under our feet. Changing model or dimension = new namespaces +
// full backfill re-run (embeddings from different models are incompatible).
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'
const EMBEDDING_DIMENSION = 4096 // Qwen3 native; Convex vector index max

/**
 * Chunks per embedding HTTP call. The RAG client batches chunks 100 at a time
 * and the OpenRouter provider leaves `maxEmbeddingsPerCall` unset, so all 100
 * (~100k chars) used to travel in a SINGLE request: ~27k tokens of prose, and
 * well past 32k on dense tabular text. The pinned Nebius endpoint advertises a
 * 32k-token window — above it OpenRouter has no endpoint left to route to
 * (`allow_fallbacks: false`) and answers **404**, not a 400 context error.
 * Sixteen keeps every request an order of magnitude under that ceiling.
 */
const MAX_EMBEDDINGS_PER_CALL = 16

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

type Filters = {
  companyId: string
  kind: string
}

export const rag = new RAG<Filters>(components.rag, {
  // The wrapper only bounds the request size — it passes `modelId` and
  // `provider` through untouched, so the namespace identity (namespace,
  // modelId, dimension, filterNames) is unchanged and no backfill is needed.
  textEmbeddingModel: wrapEmbeddingModel({
    model: openrouter.textEmbeddingModel(EMBEDDING_MODEL, {
      // Pin the EU-hosted provider (Nebius Token Factory, NL) instead of
      // OpenRouter's load balancing: document text must not transit through
      // other hosts. No fallback on purpose — a saturated provider surfaces as
      // a retried-then-notified failure (cf. header) rather than a silent
      // reroute; widen only knowingly.
      provider: { order: ['nebius'], allow_fallbacks: false },
    }),
    middleware: {
      specificationVersion: 'v3',
      overrideMaxEmbeddingsPerCall: () => MAX_EMBEDDINGS_PER_CALL,
    },
  }),
  embeddingDimension: EMBEDDING_DIMENSION,
  filterNames: ['companyId', 'kind'],
})

// ─── Failure handling ────────────────────────────────────────────────────────
// Which layer broke → `classifyIndexError` (convex/lib/vectorizeErrors.ts).

/** Retry cadence: attempt 1 → +1 min → attempt 2 → +5 min → attempt 3. */
const MAX_INDEX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [60_000, 300_000]

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

// ─── State trace (mirrors documentsExtract.setState) ─────────────────────────

const vectorStateValidator = v.union(
  v.literal('pending'),
  v.literal('indexed'),
  v.literal('skipped'),
  v.literal('failed'),
)

export const setDocumentState = internalMutation({
  args: {
    documentId: v.id('documents'),
    vectorState: vectorStateValidator,
    vectorDetail: v.optional(v.string()),
  },
  handler: async (ctx, { documentId, vectorState, vectorDetail }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    await ctx.db.patch('documents', documentId, { vectorState, vectorDetail })
    return null
  },
})

export const setReportState = internalMutation({
  args: {
    reportId: v.id('companyReports'),
    vectorState: vectorStateValidator,
    vectorDetail: v.optional(v.string()),
  },
  handler: async (ctx, { reportId, vectorState, vectorDetail }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) return null
    await ctx.db.patch('companyReports', reportId, {
      vectorState,
      vectorDetail,
    })
    return null
  },
})

/**
 * Email the org members after the LAST failed attempt — an indexing failure
 * must never be silent. Mutation (not action) so the resend enqueue commits
 * atomically; recipients are the org members who did not mute this alert
 * (convex/lib/notificationPrefs.ts).
 */
export const notifyIndexFailure = internalMutation({
  args: {
    orgId: v.id('organizations'),
    companyId: v.id('companies'),
    dealId: v.optional(v.id('deals')),
    itemLabel: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { orgId, companyId, dealId, itemLabel, detail }) => {
    const org = await ctx.db.get('organizations', orgId)
    if (!org) return null
    const siteUrl = process.env.SITE_URL ?? ''
    const targetUrl = dealId
      ? `${siteUrl}/app/${org.slug}/deals/${dealId}`
      : `${siteUrl}/app/${org.slug}/participations/${companyId}`

    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const member of members) {
      const user = await ctx.db.get('users', member.userId)
      if (!user?.email) continue
      if (!(await wantsAlert(ctx, member.userId, 'indexFailure'))) continue
      const { subject, html, text } = vectorizeFailureEmail({
        locale: user.preferredLanguage === 'fr' ? 'fr' : 'en',
        orgName: org.name,
        itemLabel,
        detail,
        targetUrl,
      })
      await resend.sendEmail(ctx, {
        from: RESEND_FROM,
        to: user.email,
        subject,
        html,
        text,
      })
    }
    return null
  },
})

// ─── Indexing implementations (shared by live ingestion + backfill) ──────────

/**
 * Skip verdict for a document — a machine code when there is nothing to
 * index (NOT an error), null when the document should be indexed.
 */
function documentSkipReason(
  doc: Doc<'documents'>,
  text: string | null,
): string | null {
  // Email-ingested rows are covered by their report entry; inline images are
  // analysis artefacts.
  if (doc.source !== 'upload') return 'covered_by_report'
  if (doc.inline === true) return 'inline_image'
  // Spreadsheets are deliberately out of the index: chunking a table tears
  // rows away from their header, and columns of figures have no semantic
  // neighbourhood, so retrieval on them does not work — the entry costs an
  // embedding without ever being a useful hit. Their text is still extracted,
  // stored and readable on the sheet. A spreadsheet arriving as a report
  // attachment stays indexed inside its report entry (mostly prose).
  if (isSpreadsheet(doc.title, doc.contentType)) return 'spreadsheet'
  if (!text) return 'no_text'
  return null
}

async function indexDocumentImpl(
  ctx: ActionCtx,
  doc: Doc<'documents'>,
  companyName: string,
  text: string,
): Promise<void> {
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
}

async function indexReportImpl(
  ctx: ActionCtx,
  report: Doc<'companyReports'>,
  companyName: string,
): Promise<void> {
  const title = report.title ?? report.subject ?? 'Report'
  const header = `Report ${companyName} — ${report.reportPeriod ?? ''} — ${title}`
  await rag.add(ctx, {
    namespace: report.orgId,
    key: `report:${report._id}`,
    title,
    text: `${header}\n\n${report.rawContent ?? ''}`,
    filterValues: [
      { name: 'companyId', value: report.companyId },
      { name: 'kind', value: 'report' },
    ],
  })
}

// ─── Live ingestion entry points ─────────────────────────────────────────────

export const indexDocument = internalAction({
  args: {
    documentId: v.id('documents'),
    // Retry counter — absent on the first submission (schedulers don't pass
    // it), carried by the self-rescheduled retries.
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { documentId, attempt }) => {
    const found = await ctx.runQuery(internal.vectorize.getDocumentForIndex, {
      documentId,
    })
    if (!found) return null
    const n = attempt ?? 1

    const skip = documentSkipReason(found.doc, found.text)
    if (skip) {
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'skipped',
        vectorDetail: skip,
      })
      console.log(`[vectorize] document ${documentId}: skipped (${skip})`)
      return null
    }

    try {
      await indexDocumentImpl(ctx, found.doc, found.companyName, found.text!)
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'indexed',
      })
      console.log(`[vectorize] document ${documentId}: indexed`)
    } catch (err) {
      const failure = classifyIndexError(err)
      if (failure.transient && n < MAX_INDEX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[n - 1]
        console.warn(
          `[vectorize] document ${documentId} attempt ${n}/${MAX_INDEX_ATTEMPTS} failed (${failure.detail}) — retrying in ${delay / 1000}s`,
        )
        await ctx.runMutation(internal.vectorize.setDocumentState, {
          documentId,
          vectorState: 'pending',
          vectorDetail: failure.detail,
        })
        await ctx.scheduler.runAfter(delay, internal.vectorize.indexDocument, {
          documentId,
          attempt: n + 1,
        })
        return null
      }
      console.error(
        `[vectorize] document ${documentId} FAILED after ${n} attempt(s) (${failure.detail})`,
      )
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'failed',
        vectorDetail: failure.detail,
      })
      await ctx.runMutation(internal.vectorize.notifyIndexFailure, {
        orgId: found.doc.orgId,
        companyId: found.doc.companyId,
        dealId: found.doc.dealId,
        itemLabel: found.doc.title,
        detail: failure.detail,
      })
    }
    return null
  },
})

export const indexReport = internalAction({
  args: {
    reportId: v.id('companyReports'),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { reportId, attempt }) => {
    const found = await ctx.runQuery(internal.vectorize.getReportForIndex, {
      reportId,
    })
    if (!found) return null
    const n = attempt ?? 1

    if (!found.report.rawContent) {
      await ctx.runMutation(internal.vectorize.setReportState, {
        reportId,
        vectorState: 'skipped',
        vectorDetail: 'no_content',
      })
      console.log(`[vectorize] report ${reportId}: skipped (no_content)`)
      return null
    }

    try {
      await indexReportImpl(ctx, found.report, found.companyName)
      await ctx.runMutation(internal.vectorize.setReportState, {
        reportId,
        vectorState: 'indexed',
      })
      console.log(`[vectorize] report ${reportId}: indexed`)
    } catch (err) {
      const failure = classifyIndexError(err)
      if (failure.transient && n < MAX_INDEX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[n - 1]
        console.warn(
          `[vectorize] report ${reportId} attempt ${n}/${MAX_INDEX_ATTEMPTS} failed (${failure.detail}) — retrying in ${delay / 1000}s`,
        )
        await ctx.runMutation(internal.vectorize.setReportState, {
          reportId,
          vectorState: 'pending',
          vectorDetail: failure.detail,
        })
        await ctx.scheduler.runAfter(delay, internal.vectorize.indexReport, {
          reportId,
          attempt: n + 1,
        })
        return null
      }
      console.error(
        `[vectorize] report ${reportId} FAILED after ${n} attempt(s) (${failure.detail})`,
      )
      await ctx.runMutation(internal.vectorize.setReportState, {
        reportId,
        vectorState: 'failed',
        vectorDetail: failure.detail,
      })
      await ctx.runMutation(internal.vectorize.notifyIndexFailure, {
        orgId: found.report.orgId,
        companyId: found.report.companyId,
        itemLabel:
          found.report.title ?? found.report.subject ?? 'Report',
        detail: failure.detail,
      })
    }
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

// ─── Backfill (manual one-shot, resumable — cf. MIGRATIONS.md) ───────────────
//
// Strictly sequential (one row at a time, never a burst) and RESUMABLE: rows
// already 'indexed' or 'skipped' are passed over, so a re-run only works on
// what is left ('failed', 'pending', never-submitted). A transient provider
// failure (saturated quota, network) marks the current row 'failed' and stops
// the whole run — re-run later to resume where it stopped. A permanent
// failure marks the row and moves on. No failure emails here: this is a
// manual operation, the returned summary IS the feedback.

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

interface BackfillTally {
  indexed: number
  skipped: number
  failed: number
  queued: number
  /** Set when a transient provider failure stopped the run early. */
  stoppedOn: string | null
}

async function backfillOrgImpl(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
): Promise<string> {
  const tally: BackfillTally = {
    indexed: 0,
    skipped: 0,
    failed: 0,
    queued: 0,
    stoppedOn: null,
  }

  const docIds = await ctx.runQuery(
    internal.vectorize.listDocumentIdsForBackfill,
    { orgId },
  )
  for (const documentId of docIds) {
    const found = await ctx.runQuery(internal.vectorize.getDocumentForIndex, {
      documentId,
    })
    if (!found) continue
    // Resumability: done rows cost nothing on a re-run.
    const state = found.doc.vectorState
    if (state === 'indexed' || state === 'skipped') continue

    if (
      found.doc.source === 'upload' &&
      found.doc.inline !== true &&
      !found.text &&
      !found.doc.ocrState
    ) {
      // Uploaded before extraction existed: run the reading now — its end
      // schedules indexDocument, so the entry lands once the OCR is done.
      await ctx.scheduler.runAfter(0, internal.documentsExtract.run, {
        documentId,
      })
      tally.queued++
      continue
    }

    const skip = documentSkipReason(found.doc, found.text)
    if (skip) {
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'skipped',
        vectorDetail: skip,
      })
      tally.skipped++
      continue
    }

    try {
      await indexDocumentImpl(ctx, found.doc, found.companyName, found.text!)
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'indexed',
      })
      tally.indexed++
    } catch (err) {
      const failure = classifyIndexError(err)
      await ctx.runMutation(internal.vectorize.setDocumentState, {
        documentId,
        vectorState: 'failed',
        vectorDetail: failure.detail,
      })
      tally.failed++
      console.error(
        `[vectorize] backfill document ${documentId} failed (${failure.detail})`,
      )
      if (failure.transient) {
        tally.stoppedOn = failure.detail
        break
      }
    }
  }

  if (!tally.stoppedOn) {
    const reportIds = await ctx.runQuery(
      internal.vectorize.listReportIdsForBackfill,
      { orgId },
    )
    for (const reportId of reportIds) {
      const found = await ctx.runQuery(internal.vectorize.getReportForIndex, {
        reportId,
      })
      if (!found) continue
      const state = found.report.vectorState
      if (state === 'indexed' || state === 'skipped') continue

      if (!found.report.rawContent) {
        await ctx.runMutation(internal.vectorize.setReportState, {
          reportId,
          vectorState: 'skipped',
          vectorDetail: 'no_content',
        })
        tally.skipped++
        continue
      }

      try {
        await indexReportImpl(ctx, found.report, found.companyName)
        await ctx.runMutation(internal.vectorize.setReportState, {
          reportId,
          vectorState: 'indexed',
        })
        tally.indexed++
      } catch (err) {
        const failure = classifyIndexError(err)
        await ctx.runMutation(internal.vectorize.setReportState, {
          reportId,
          vectorState: 'failed',
          vectorDetail: failure.detail,
        })
        tally.failed++
        console.error(
          `[vectorize] backfill report ${reportId} failed (${failure.detail})`,
        )
        if (failure.transient) {
          tally.stoppedOn = failure.detail
          break
        }
      }
    }
  }

  const summary =
    `[vectorize] backfill org ${orgId}: ${tally.indexed} indexed, ` +
    `${tally.skipped} skipped, ${tally.failed} failed, ` +
    `${tally.queued} queued for extraction` +
    (tally.stoppedOn
      ? ` — STOPPED on transient failure (${tally.stoppedOn}), run again later to resume`
      : '')
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
      const summary = await backfillOrgImpl(ctx, orgId)
      summaries.push(summary)
      // The quota is shared across orgs — if one org hit it, the next would
      // too. Stop the whole run; a later re-run resumes everywhere.
      if (summary.includes('STOPPED')) break
    }
    return summaries
  },
})
