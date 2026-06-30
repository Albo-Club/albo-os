/**
 * Documents & reportings attached to a company (investor updates, BP,
 * legal). Files live in native Convex storage — upload via
 * `files:generateUploadUrl` (existing), then `documents:create` with the
 * storageId. V1 = manual upload; email ingestion (`source: 'email'`)
 * will come in V2.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. files.ts)

const kindValidator = v.union(
  v.literal('reporting'),
  v.literal('bp'),
  v.literal('legal'),
  v.literal('other'),
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

    // Hide inline email images (cid:) — they're analysis artefacts, not docs.
    const visible = rows.filter((doc) => doc.inline !== true)

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
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    )
  },
})

export const create = mutation({
  args: {
    companyId: v.id('companies'),
    title: v.string(),
    kind: kindValidator,
    period: v.optional(v.number()),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get('companies', args.companyId)
    if (!company) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, company.orgId)

    const title = args.title.trim()
    if (!title) throw new ConvexError('invalid_title')
    const { contentType, size } = await validateUpload(ctx, args.storageId)

    return await ctx.db.insert('documents', {
      orgId: company.orgId,
      companyId: args.companyId,
      title,
      kind: args.kind,
      period: args.period,
      storageId: args.storageId,
      contentType,
      size,
      source: 'upload',
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) throw new ConvexError('not_found')
    await requireOrgMember(ctx, doc.orgId)
    await ctx.storage.delete(doc.storageId)
    await ctx.db.delete('documents', documentId)
    return null
  },
})
