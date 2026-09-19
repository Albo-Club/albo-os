/**
 * Capital events (`capitalEvents`): the operations on a portfolio company's
 * share capital after our entry — the history behind « Capital et
 * valorisation » on the company sheet. The entry itself is read from the
 * deal, never stored here (cf. convex/lib/capitalPosition.ts).
 *
 * Lot 1 (ALB-248): hand-entered from the sheet. Lot 2 adds the proposals
 * extracted from the legal documents, validated in one click. No agent or
 * MCP tool yet — a decision, not an omission: both facades land together in
 * lot 2 (CLAUDE.md « Livrer un outil sur une seule des deux façades »).
 */
import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { capitalEventKindValidator } from './lib/capitalPosition'
import { logCompanyEvent, userActor } from './lib/companyEvents'
import { roundTypeValidator } from './lib/instruments'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const isCount = (n: number) => Number.isInteger(n) && n >= 0

/** A document may back an operation only when it is filed under the same
 * company — directly, or through a deal whose target is the company. */
async function assertDocumentOfCompany(
  ctx: QueryCtx | MutationCtx,
  documentId: Id<'documents'>,
  company: Doc<'companies'>,
) {
  const doc = await ctx.db.get('documents', documentId)
  if (!doc || doc.orgId !== company.orgId) {
    throw new ConvexError('document_not_found')
  }
  if (doc.companyId === company._id) return
  const deal = doc.dealId ? await ctx.db.get('deals', doc.dealId) : null
  if (deal?.targetCompanyId === company._id) return
  throw new ConvexError('document_not_found')
}

/** The company's operations, oldest first, each with its source document. */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    const rows = await ctx.db
      .query('capitalEvents')
      .withIndex('by_company_asof', (q) => q.eq('companyId', companyId))
      .collect()
    return await Promise.all(
      rows.map(async (row) => {
        const doc = row.documentId
          ? await ctx.db.get('documents', row.documentId)
          : null
        return {
          _id: row._id,
          asOf: row.asOf,
          kind: row.kind,
          pricePerShare: row.pricePerShare,
          sharesIssued: row.sharesIssued ?? null,
          totalSharesAfter: row.totalSharesAfter,
          roundSize: row.roundSize ?? null,
          roundType: row.roundType ?? null,
          notes: row.notes ?? null,
          document: doc ? { _id: doc._id, title: doc.title } : null,
        }
      }),
    )
  },
})

export const create = mutation({
  args: {
    companyId: v.id('companies'),
    asOf: v.number(),
    kind: capitalEventKindValidator,
    pricePerShare: v.number(), // cents
    sharesIssued: v.optional(v.number()),
    totalSharesAfter: v.number(),
    roundSize: v.optional(v.number()), // cents
    roundType: v.optional(roundTypeValidator),
    documentId: v.optional(v.id('documents')),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const company = await ctx.db.get('companies', args.companyId)
    if (!company) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, company.orgId)
    if (!Number.isInteger(args.pricePerShare) || args.pricePerShare <= 0) {
      throw new ConvexError('invalid_price')
    }
    if (!isCount(args.totalSharesAfter) || args.totalSharesAfter === 0) {
      throw new ConvexError('invalid_shares')
    }
    if (args.sharesIssued !== undefined && !isCount(args.sharesIssued)) {
      throw new ConvexError('invalid_shares')
    }
    if (args.roundSize !== undefined && !isCount(args.roundSize)) {
      throw new ConvexError('invalid_amount')
    }
    if (args.documentId) {
      await assertDocumentOfCompany(ctx, args.documentId, company)
    }
    const notes = args.notes?.trim()
    const id = await ctx.db.insert('capitalEvents', {
      orgId: company.orgId,
      companyId: company._id,
      asOf: args.asOf,
      kind: args.kind,
      pricePerShare: args.pricePerShare,
      sharesIssued: args.sharesIssued,
      totalSharesAfter: args.totalSharesAfter,
      roundSize: args.roundSize,
      roundType: args.roundType,
      documentId: args.documentId,
      notes: notes ? notes : undefined,
      createdBy: user._id,
    })
    await logCompanyEvent(ctx, company, userActor(user._id), {
      kind: 'capital_event_added',
      capitalKind: args.kind,
      asOf: args.asOf,
      pricePerShareCents: args.pricePerShare,
      totalSharesAfter: args.totalSharesAfter,
    })
    return id
  },
})

export const remove = mutation({
  args: { eventId: v.id('capitalEvents') },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db.get('capitalEvents', eventId)
    if (!row) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, row.orgId)
    await ctx.db.delete('capitalEvents', eventId)
    await logCompanyEvent(
      ctx,
      { orgId: row.orgId, companyId: row.companyId },
      userActor(user._id),
      { kind: 'capital_event_removed', capitalKind: row.kind, asOf: row.asOf },
    )
    return null
  },
})
