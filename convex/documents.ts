/**
 * Documents & reportings attached to a company (investor updates, BP,
 * legal). Files live in native Convex storage — upload via
 * `files:generateUploadUrl` (existing), then `documents:create` with the
 * storageId. Two ways in: manual upload here, and the report pipeline
 * (`source: 'email'`, rows created by `reportStore.ts`). A row hangs off a
 * company, and additionally off one of its deals when `dealId` is set — the
 * company list is the superset (`listByCompany` returns deal documents too,
 * carrying their deal, so a pacte is reachable from the entity that signed it).
 *
 * Since the Dette & Garanties module a row may hang off a BANK LOAN instead
 * (`loanId`), with no company at all: a loan deed has no portfolio target.
 * `orgId` carries the tenancy in every case — see `create`.
 *
 * Both carry the same reading state (`ocrState`) so the front can tell,
 * per document, whether its text was read — the extracted text itself is
 * fetched on demand via `getExtractedText`, never with the list.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { requireGuaranteeParty } from './guarantees'
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
  v.literal('acte_pret'),
  v.literal('acte_garantie'),
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

/**
 * A company's documents, most recent first, with download URL. Deal documents
 * are included: they belong to the legal entity as much as to the deal (a
 * pacte binds the company), and each carries its `deal` so the timeline can
 * label it and link back to the deal sheet.
 */
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

    // Hide inline email images (cid:) — they're analysis artefacts, not docs.
    const visible = rows.filter((doc) => doc.inline !== true)

    // One read per DISTINCT deal, not per row: a deal usually carries several
    // documents, and the label is the same for all of them.
    const dealIds = [
      ...new Set(visible.flatMap((doc) => (doc.dealId ? [doc.dealId] : []))),
    ]
    const dealsById = new Map(
      (await Promise.all(dealIds.map((id) => ctx.db.get('deals', id))))
        .filter((deal) => deal !== null)
        .map((deal) => [deal._id, deal]),
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
        // The deal this document is filed under, when there is one — the
        // timeline badges it and links to the deal sheet. `name` is the deal's
        // custom name; the front falls back to the instrument label.
        deal: (() => {
          const deal = doc.dealId ? dealsById.get(doc.dealId) : undefined
          return deal
            ? {
                _id: deal._id,
                name: deal.name ?? null,
                instrumentKind: deal.instrumentKind,
              }
            : null
        })(),
        // Links an email-ingested attachment to its report (companyReports),
        // so the Reports timeline can surface a report's source docs.
        reportId: doc.reportId ?? null,
        // Reading state — never the text itself (cf. `documentTexts`).
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        // Semantic-index state (vectorize.ts) — same trace, one layer down.
        vectorState: doc.vectorState ?? null,
        vectorDetail: doc.vectorDetail ?? null,
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
        vectorState: doc.vectorState ?? null,
        vectorDetail: doc.vectorDetail ?? null,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

/**
 * A loan's documents (offer letter, amortization table, deed), most recent
 * first. Never goes through `by_company`: these rows usually have no company.
 */
export const listByLoan = query({
  args: { loanId: v.id('loans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('loans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)

    const rows = await ctx.db
      .query('documents')
      .withIndex('by_loan', (q) => q.eq('loanId', loanId))
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
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        vectorState: doc.vectorState ?? null,
        vectorDetail: doc.vectorDetail ?? null,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

/**
 * A property's documents (deed of sale, compromis, works quote), most recent
 * first. Like a loan's: these rows have no portfolio company.
 */
export const listByProperty = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get('properties', propertyId)
    if (!property) throw new ConvexError('not_found')
    await requireOrgMember(ctx, property.orgId)

    const rows = await ctx.db
      .query('documents')
      .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
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
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        vectorState: doc.vectorState ?? null,
        vectorDetail: doc.vectorDetail ?? null,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

/**
 * A guarantee's deeds, most recent first. Like a loan's: no company.
 *
 * Same projection as `listByLoan` / `listByProperty`, deliberately: the three
 * feed the SAME front component, and a narrower shape here would only mean
 * that component asking less of all three.
 */
export const listByGuarantee = query({
  args: { guaranteeId: v.id('guarantees') },
  handler: async (ctx, { guaranteeId }) => {
    const guarantee = await ctx.db.get('guarantees', guaranteeId)
    if (!guarantee) throw new ConvexError('not_found')
    await requireGuaranteeParty(ctx, guarantee)

    const rows = await ctx.db
      .query('documents')
      .withIndex('by_guarantee', (q) => q.eq('guaranteeId', guaranteeId))
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
        ocrState: doc.ocrState ?? null,
        ocrDetail: doc.ocrDetail ?? null,
        ocrChars: doc.ocrChars ?? null,
        vectorState: doc.vectorState ?? null,
        vectorDetail: doc.vectorDetail ?? null,
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

/**
 * Creates a document from an already-uploaded blob.
 *
 * The org is NEVER taken from an argument — it is resolved from the anchor
 * the document hangs off (`companyId`, else `loanId`, else `propertyId`,
 * else `dealId`), and membership is checked on that resolved org. At least
 * one anchor is required (`missing_anchor`): without one the row would be
 * org-scoped but reachable from nowhere.
 *
 * `companyId` is optional since the Dette & Garanties module — a loan deed
 * has no portfolio company. Every anchor supplied must live in the SAME org,
 * otherwise the row would show on a fiche of another tenant. A guarantee is
 * the one anchor with no org of its own: its deed is filed in the borrower's
 * org (falling back to the guarantor's), which is where the debt is read.
 */
export const create = mutation({
  args: {
    companyId: v.optional(v.id('companies')),
    // Set to attach the document to a single deal instead of the company.
    dealId: v.optional(v.id('deals')),
    // Set to attach the document to a bank loan (offer letter, deed).
    loanId: v.optional(v.id('loans')),
    // Set to attach the document to a guarantee (deed of pledge, mortgage).
    guaranteeId: v.optional(v.id('guarantees')),
    // Set to attach the document to a property (deed of sale, works quote).
    propertyId: v.optional(v.id('properties')),
    title: v.string(),
    kind: kindValidator,
    period: v.optional(v.number()),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const company = args.companyId
      ? await ctx.db.get('companies', args.companyId)
      : null
    if (args.companyId && !company) throw new ConvexError('not_found')
    const loan = args.loanId ? await ctx.db.get('loans', args.loanId) : null
    if (args.loanId && !loan) throw new ConvexError('not_found')
    const property = args.propertyId
      ? await ctx.db.get('properties', args.propertyId)
      : null
    if (args.propertyId && !property) throw new ConvexError('not_found')
    const deal = args.dealId ? await ctx.db.get('deals', args.dealId) : null
    if (args.dealId && !deal) throw new ConvexError('not_found')
    const guarantee = args.guaranteeId
      ? await ctx.db.get('guarantees', args.guaranteeId)
      : null
    if (args.guaranteeId && !guarantee) throw new ConvexError('not_found')

    // A guarantee has no org of its own — it spans up to three. Its deed is
    // filed in the borrower's org, falling back to the guarantor's, so the
    // row lands where the debt is read from.
    const guaranteeOrgId =
      guarantee?.borrowerOrgId ??
      guarantee?.pledgorOrgId ??
      guarantee?.subjectOrgId
    const orgId =
      company?.orgId ??
      loan?.orgId ??
      property?.orgId ??
      deal?.orgId ??
      guaranteeOrgId
    if (!orgId) throw new ConvexError('missing_anchor')
    const { user } = await requireOrgMember(ctx, orgId)

    // A deal document must belong to the same org AND target the company it
    // is filed under, otherwise the row would be reachable from the wrong
    // fiche. With no company anchor, the org check alone applies.
    if (deal) {
      if (
        deal.orgId !== orgId ||
        (args.companyId && deal.targetCompanyId !== args.companyId)
      ) {
        throw new ConvexError('not_found')
      }
    }
    if (loan && loan.orgId !== orgId) throw new ConvexError('not_found')
    if (property && property.orgId !== orgId) {
      throw new ConvexError('not_found')
    }
    // A guarantee spans several orgs: the resolved one must be one of them.
    if (guarantee && guaranteeOrgId !== orgId) {
      throw new ConvexError('not_found')
    }

    const title = args.title.trim()
    if (!title) throw new ConvexError('invalid_title')
    const { contentType, size } = await validateUpload(ctx, args.storageId)

    const documentId = await ctx.db.insert('documents', {
      orgId,
      companyId: args.companyId,
      dealId: args.dealId,
      loanId: args.loanId,
      guaranteeId: args.guaranteeId,
      propertyId: args.propertyId,
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
    await ctx.scheduler.runAfter(0, internal.documentsExtract.run, {
      documentId,
    })
    return documentId
  },
})

/**
 * Edit a document's metadata (title, kind, covered period / document date).
 * The file itself is immutable — replacing it means deleting and re-adding,
 * since the reading and the semantic index are keyed by the blob.
 *
 * An emptied period clears the field (`patch` with `undefined` removes it).
 * Title and kind both feed the semantic index (header line + filter value),
 * so a change to either re-indexes the document — otherwise the assistant
 * would keep finding it under its former name.
 */
export const update = mutation({
  args: {
    documentId: v.id('documents'),
    title: v.string(),
    kind: kindValidator,
    period: v.optional(v.number()),
  },
  handler: async (ctx, { documentId, title, kind, period }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)

    const trimmed = title.trim()
    if (!trimmed) throw new ConvexError('invalid_title')

    await ctx.db.patch('documents', documentId, {
      title: trimmed,
      kind,
      period,
    })

    if (trimmed !== doc.title || kind !== doc.kind) {
      await ctx.scheduler.runAfter(0, internal.vectorize.indexDocument, {
        documentId,
      })
    }
    return null
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
      // The run re-schedules the semantic indexing once the text is back.
      vectorState: 'pending',
      vectorDetail: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.documentsExtract.run, {
      documentId,
    })
    return null
  },
})

/**
 * Re-run the semantic indexing of a document — the vectorization twin of
 * `reextract`. Covers a 'failed' indexing (provider saturated at the time)
 * and the documents stored before indexing existed (no state at all). Keeps
 * the extracted text as-is: only the index entry is rebuilt.
 */
export const reindex = mutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)

    await ctx.db.patch('documents', documentId, {
      vectorState: 'pending',
      vectorDetail: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.vectorize.indexDocument, {
      documentId,
    })
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
    // Drop the semantic-index entry (no-op if the doc was never indexed).
    await ctx.scheduler.runAfter(0, internal.vectorize.removeEntry, {
      orgId: doc.orgId,
      key: `doc:${documentId}`,
    })
    return null
  },
})
