/**
 * Backfill of the deal activity journal (`dealEvents`) from what the other
 * tables already remember, so the « Activité » section of a company sheet is
 * not empty on day one.
 *
 * Four sources, four kinds of events — nothing else is reconstructible:
 *
 * - `deals`            → `created` at `_creationTime`, no author (`unknown`).
 * - `matchingDecisions` (matched) → `transaction_matched` by `decidedBy` at
 *                        `decidedAt`; direction read from the transaction
 *                        when it still exists.
 * - `valuations`       → `valuation_added` at the row's `_creationTime`, no
 *                        author.
 * - `documents` with a `dealId` → `document_attached` by `uploadedBy` (or
 *                        `unknown`) at `uploadedAt`.
 *
 * Field edits made before the journal existed are lost: nobody recorded them.
 *
 * Idempotent: every backfilled row carries `backfillKey = <source>:<rowId>`
 * and is skipped when already present, so a second run writes nothing. Rows
 * whose deal is gone are skipped (the journal follows the deal).
 *
 * Execution (prod, manual, one source at a time, re-run with the returned
 * `continueCursor` until `isDone`):
 *   pnpm exec convex run --prod migrations/backfillDealEvents:dryRun
 *   pnpm exec convex run --prod migrations/backfillDealEvents:apply '{"source":"deals"}'
 *   pnpm exec convex run --prod migrations/backfillDealEvents:apply '{"source":"matching"}'
 *   pnpm exec convex run --prod migrations/backfillDealEvents:apply '{"source":"valuations"}'
 *   pnpm exec convex run --prod migrations/backfillDealEvents:apply '{"source":"documents"}'
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'
import type { DealEvent, DealEventActor } from '../lib/dealEvents'

const sourceValidator = v.union(
  v.literal('deals'),
  v.literal('matching'),
  v.literal('valuations'),
  v.literal('documents'),
)
const BATCH = 500

type MutCtx = GenericMutationCtx<DataModel>

/** Inserts the event unless its key is already there. Returns 1 when written. */
async function upsert(
  ctx: MutCtx,
  key: string,
  deal: Doc<'deals'> | null,
  at: number,
  actor: DealEventActor,
  event: DealEvent,
): Promise<number> {
  if (!deal) return 0
  const existing = await ctx.db
    .query('dealEvents')
    .withIndex('by_backfill_key', (q) => q.eq('backfillKey', key))
    .first()
  if (existing) return 0
  await ctx.db.insert('dealEvents', {
    orgId: deal.orgId,
    dealId: deal._id,
    companyId: deal.targetCompanyId,
    at,
    actor,
    event,
    backfillKey: key,
  })
  return 1
}

const UNKNOWN: DealEventActor = { kind: 'unknown' }

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const deals = (await ctx.db.query('deals').collect()).length
    const matching = (await ctx.db.query('matchingDecisions').collect()).filter(
      (d) => d.decision === 'matched' && d.dealId,
    ).length
    const valuations = (await ctx.db.query('valuations').collect()).length
    const documents = (await ctx.db.query('documents').collect()).filter(
      (d) => d.dealId,
    ).length
    const already = (await ctx.db.query('dealEvents').collect()).filter(
      (e) => e.backfillKey,
    ).length
    return { candidates: { deals, matching, valuations, documents }, already }
  },
})

export const apply = internalMutation({
  args: { source: sourceValidator, cursor: v.optional(v.string()) },
  handler: async (ctx, { source, cursor }) => {
    let written = 0
    const opts = { cursor: cursor ?? null, numItems: BATCH }
    let continueCursor: string
    let isDone: boolean

    switch (source) {
      case 'deals': {
        const page = await ctx.db.query('deals').paginate(opts)
        for (const deal of page.page) {
          written += await upsert(
            ctx,
            `deal:${deal._id}`,
            deal,
            deal._creationTime,
            UNKNOWN,
            { kind: 'created' },
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
      case 'matching': {
        const page = await ctx.db.query('matchingDecisions').paginate(opts)
        for (const md of page.page) {
          if (md.decision !== 'matched' || !md.dealId) continue
          const deal = await ctx.db.get('deals', md.dealId)
          const tx = await ctx.db.get('transactions', md.transactionId)
          written += await upsert(
            ctx,
            `md:${md._id}`,
            deal,
            md.decidedAt,
            { kind: 'user', userId: md.decidedBy },
            {
              kind: 'transaction_matched',
              amountCents: md.txAmount,
              ...(tx ? { direction: tx.direction } : {}),
            },
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
      case 'valuations': {
        const page = await ctx.db.query('valuations').paginate(opts)
        for (const val of page.page) {
          const deal = await ctx.db.get('deals', val.dealId)
          written += await upsert(
            ctx,
            `val:${val._id}`,
            deal,
            val._creationTime,
            UNKNOWN,
            {
              kind: 'valuation_added',
              asOf: val.asOf,
              fairValueCents: val.fairValue,
            },
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
      case 'documents': {
        const page = await ctx.db.query('documents').paginate(opts)
        for (const doc of page.page) {
          if (!doc.dealId) continue
          const deal = await ctx.db.get('deals', doc.dealId)
          written += await upsert(
            ctx,
            `doc:${doc._id}`,
            deal,
            doc.uploadedAt,
            doc.uploadedBy ? { kind: 'user', userId: doc.uploadedBy } : UNKNOWN,
            { kind: 'document_attached', title: doc.title },
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
    }
    return { source, written, continueCursor, isDone }
  },
})
