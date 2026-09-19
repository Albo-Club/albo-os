/**
 * Capital events (`capitalEvents`): the operations on a portfolio company's
 * share capital after our entry — the history behind « Capital et
 * valorisation » on the company sheet. The entry itself is read from the
 * deal, never stored here (cf. convex/lib/capitalPosition.ts).
 *
 * Three ways in (ALB-248):
 *   - hand-entered from the sheet (`create`, lot 1);
 *   - PROPOSED by the reading of a legal document
 *     (convex/capitalEventsExtract.ts, lot 2): the row carries
 *     `status: 'proposed'` and its `evidence`, and waits for `confirm` or
 *     `reject`. Only a confirmed row (no status) feeds the position;
 *   - through the AI facades (`*Internal`, agent + MCP together).
 *
 * A proposal and a refusal are automatic bookkeeping and stay out of the
 * journal; the confirmation is the human gesture and is journaled under the
 * confirming user (cf. tests/journalGuards.test.ts EXEMPT).
 */
import { ConvexError, v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { readMembership } from './lib/agentScope'
import { requireOrgMember } from './lib/auth'
import { capitalEventKindValidator } from './lib/capitalPosition'
import { logCompanyEvent, userActor } from './lib/companyEvents'
import { roundTypeValidator } from './lib/instruments'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const isCount = (n: number) => Number.isInteger(n) && n >= 0

const eventArgs = {
  asOf: v.number(),
  kind: capitalEventKindValidator,
  pricePerShare: v.number(), // cents
  sharesIssued: v.optional(v.number()),
  totalSharesAfter: v.number(),
  roundSize: v.optional(v.number()), // cents
  roundType: v.optional(roundTypeValidator),
  documentId: v.optional(v.id('documents')),
  notes: v.optional(v.string()),
}

type EventArgs = {
  asOf: number
  kind: Doc<'capitalEvents'>['kind']
  pricePerShare: number
  sharesIssued?: number
  totalSharesAfter: number
  roundSize?: number
  roundType?: Doc<'capitalEvents'>['roundType']
  documentId?: Id<'documents'>
  notes?: string
}

function assertValidEvent(args: EventArgs) {
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
}

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

async function insertConfirmed(
  ctx: MutationCtx,
  company: Doc<'companies'>,
  userId: Id<'users'>,
  args: EventArgs,
  viaAgent: boolean,
) {
  assertValidEvent(args)
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
    createdBy: userId,
  })
  await logCompanyEvent(ctx, company, userActor(userId, viaAgent), {
    kind: 'capital_event_added',
    capitalKind: args.kind,
    asOf: args.asOf,
    pricePerShareCents: args.pricePerShare,
    totalSharesAfter: args.totalSharesAfter,
  })
  return id
}

/** Confirmed and proposed rows of a company, oldest first, with their source
 * document. Rejected rows are a memory for the extractor, never shown. */
async function listForCompany(ctx: QueryCtx, companyId: Id<'companies'>) {
  const rows = await ctx.db
    .query('capitalEvents')
    .withIndex('by_company_asof', (q) => q.eq('companyId', companyId))
    .collect()
  return await Promise.all(
    rows
      .filter((row) => row.status !== 'rejected')
      .map(async (row) => {
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
          status: row.status ?? null,
          evidence: row.evidence ?? null,
          document: doc ? { _id: doc._id, title: doc.title } : null,
        }
      }),
  )
}

export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    return await listForCompany(ctx, companyId)
  },
})

export const create = mutation({
  args: { companyId: v.id('companies'), ...eventArgs },
  handler: async (ctx, { companyId, ...args }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, company.orgId)
    return await insertConfirmed(ctx, company, user._id, args, false)
  },
})

/** A proposal becomes a confirmed operation, under the confirming user. */
export const confirm = mutation({
  args: { eventId: v.id('capitalEvents') },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db.get('capitalEvents', eventId)
    if (!row) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, row.orgId)
    await confirmRow(ctx, row, user._id, false)
    return null
  },
})

async function confirmRow(
  ctx: MutationCtx,
  row: Doc<'capitalEvents'>,
  userId: Id<'users'>,
  viaAgent: boolean,
) {
  if (row.status !== 'proposed') throw new ConvexError('not_proposed')
  await ctx.db.patch('capitalEvents', row._id, {
    status: undefined,
    createdBy: userId,
  })
  await logCompanyEvent(
    ctx,
    { orgId: row.orgId, companyId: row.companyId },
    userActor(userId, viaAgent),
    {
      kind: 'capital_event_added',
      capitalKind: row.kind,
      asOf: row.asOf,
      pricePerShareCents: row.pricePerShare,
      totalSharesAfter: row.totalSharesAfter,
    },
  )
}

/** A refused proposal stays as a hidden row: the extractor reads it as
 * "already known" and never proposes the same operation again. */
export const reject = mutation({
  args: { eventId: v.id('capitalEvents') },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db.get('capitalEvents', eventId)
    if (!row) throw new ConvexError('not_found')
    await requireOrgMember(ctx, row.orgId)
    if (row.status !== 'proposed') throw new ConvexError('not_proposed')
    await ctx.db.patch('capitalEvents', eventId, { status: 'rejected' })
    return null
  },
})

export const remove = mutation({
  args: { eventId: v.id('capitalEvents') },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db.get('capitalEvents', eventId)
    if (!row) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, row.orgId)
    await ctx.db.delete('capitalEvents', eventId)
    // A proposal never entered the journal; only a confirmed row leaves it.
    if (row.status === undefined) {
      await logCompanyEvent(
        ctx,
        { orgId: row.orgId, companyId: row.companyId },
        userActor(user._id),
        {
          kind: 'capital_event_removed',
          capitalKind: row.kind,
          asOf: row.asOf,
        },
      )
    }
    return null
  },
})

// ─── AI facades (agent + MCP) — membership re-checked via actorUserId ──────

async function getOrgCompany(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
): Promise<Doc<'companies'>> {
  const company = await ctx.db.get('companies', companyId)
  if (!company || company.orgId !== orgId) throw new ConvexError('not_found')
  return company
}

export const listInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    companyId: v.id('companies'),
  },
  handler: async (ctx, { orgId, actorUserId, companyId }) => {
    await readMembership(ctx, orgId, actorUserId)
    await getOrgCompany(ctx, orgId, companyId)
    return await listForCompany(ctx, companyId)
  },
})

export const createInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    companyId: v.id('companies'),
    ...eventArgs,
  },
  handler: async (ctx, { orgId, actorUserId, companyId, ...args }) => {
    await readMembership(ctx, orgId, actorUserId)
    const company = await getOrgCompany(ctx, orgId, companyId)
    const id = await insertConfirmed(ctx, company, actorUserId, args, true)
    return { _id: id }
  },
})

export const confirmInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    eventId: v.id('capitalEvents'),
  },
  handler: async (ctx, { orgId, actorUserId, eventId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const row = await ctx.db.get('capitalEvents', eventId)
    if (!row || row.orgId !== orgId) throw new ConvexError('not_found')
    await confirmRow(ctx, row, actorUserId, true)
    return { _id: eventId }
  },
})
