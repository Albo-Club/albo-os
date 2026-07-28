/**
 * Documents & reportings attached to a company (investor updates, BP,
 * legal). Files live in native Convex storage — upload via
 * `files:generateUploadUrl` (existing), then `documents:create` with the
 * storageId. Two ways in: manual upload here, and the report pipeline
 * (`source: 'email'`, rows created by `reportStore.ts`). A row hangs off a
 * company, or off one of its deals when `dealId` is set — the two lists are
 * disjoint (`listByCompany` excludes deal documents).
 *
 * Both carry the same reading state (`ocrState`) so the front can tell,
 * per document, whether its text was read — the extracted text itself is
 * fetched on demand via `getExtractedText`, never with the list.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { deleteStorageText } from './lib/documentTexts'

import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. files.ts)

// Company kinds + deal-specific ones (term sheet, pacte…). The surface picks
// which subset it offers; the schema accepts both.
const kindValidator = v.union(
  v.literal('reporting'),
  v.literal('bp'),
  v.literal('legal'),
  v.literal('other'),
  v.literal('term_sheet'),
  v.literal('pacte'),
  v.literal('subscription'),
  v.literal('attestation'),
)

async function validateUpload(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<{ contentType?: string; size: number }> {
  const meta = await ctx.db.system.get('_storage', storageId)
  if (!meta) throw new ConvexError('not_found')
  if (meta.size > MAX_BYTES) {
    await ctx.storage.delete(storageId)
    throw new ConvexError('too_large')
  }
  return { contentType: meta.contentType ?? undefined, size: meta.size }
}

/** A company's documents, most recent first, with download URL. */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const rows = await ctx.db
      .query('documents')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(200)

    // Hide inline email images (cid:) — they're analysis artefacts, not docs —
    // and deal documents, which live on their deal sheet only.
    const visible = rows.filter(
      (doc) => doc.inline !== true && doc.dealId === undefined,
    )

    return await Promise.all(
      visible.map(async (doc) => ({
        _id: doc._id,
        title: doc.title,
        kind: doc.kind,
        period: doc.period ?? null,
        contentType: doc.contentType ?? null,
        size: doc.size ?? null,
        source: doc.source,
        uploadedAt: doc.uploadedAt,
        // Links an email-ingested attachment to its report (companyReports),
        // so the Reports timeline can surface a report's source docs.
        reportId: doc.reportId ?? null,
        // Reading state — never the text itself (cf. `documentTexts`).
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

/** A deal's documents, most recent first, with download URL. */
export const listByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('documents')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .order('desc')
      .take(200)

    return await Promise.all(
      rows.map(async (doc) => ({
        _id: doc._id,
        title: doc.title,
        kind: doc.kind,
        period: doc.period ?? null,
        contentType: doc.contentType ?? null,
        size: doc.size ?? null,
        uploadedAt: doc.uploadedAt,
        // Same reading state as a company document — one pipeline, one story.
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

/** The extracted text of a document — loaded only when the user opens it. */
export const getExtractedText = query({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)

    const row = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    if (!row) return null
    return { text: row.text, truncated: row.truncated }
  },
})

export const create = mutation({
  args: {
    companyId: v.id('companies'),
    // Set to attach the document to a single deal instead of the company.
    dealId: v.optional(v.id('deals')),
    title: v.string(),
    kind: kindValidator,
    period: v.optional(v.number()),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get('companies', args.companyId)
    if (!company) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, company.orgId)

    // A deal document must belong to the same org AND target the company it
    // is filed under, otherwise the row would be reachable from the wrong
    // fiche.
    if (args.dealId) {
      const deal = await ctx.db.get('deals', args.dealId)
      if (
        !deal ||
        deal.orgId !== company.orgId ||
        deal.targetCompanyId !== args.companyId
      ) {
        throw new ConvexError('not_found')
      }
    }

    const title = args.title.trim()
    if (!title) throw new ConvexError('invalid_title')
    const { contentType, size } = await validateUpload(ctx, args.storageId)

    const documentId = await ctx.db.insert('documents', {
      orgId: company.orgId,
      companyId: args.companyId,
      dealId: args.dealId,
      title,
      kind: args.kind,
      period: args.period,
      storageId: args.storageId,
      contentType,
      size,
      source: 'upload',
      uploadedBy: user._id,
      uploadedAt: Date.now(),
      ocrState: 'pending',
    })
    await ctx.scheduler.runAfter(0, internal.documentsExtract.run, { documentId })
    return documentId
  },
})

/**
 * Re-run the reading of a document. Covers a transient OCR failure and the
 * documents stored before extraction existed (no state at all).
 */
export const reextract = mutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)

    // Drop the cached text first, otherwise the run would adopt it and skip.
    const existing = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    if (existing) await ctx.db.delete('documentTexts', existing._id)

    await ctx.db.patch('documents', documentId, {
      ocrState: 'pending',
      ocrDetail: undefined,
      ocrChars: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.documentsExtract.run, { documentId })
    return null
  },
})

export const remove = mutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)
    // The text is keyed by the blob, and the blob goes with the document.
    await deleteStorageText(ctx, doc.storageId)
    await ctx.storage.delete(doc.storageId)
    await ctx.db.delete('documents', documentId)
    return null
  },
})
