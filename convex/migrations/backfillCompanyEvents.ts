/**
 * Backfill of the company activity journal (`companyEvents`) from what the other
 * tables already remember, so the « Activité » section of a company sheet is
 * not empty on day one.
 *
 * Four sources, four kinds of events — nothing else is reconstructible:
 *
 * - `deals`            → `created` at `_creationTime`; by « Attio » when the
 *                        row carries an `attioDealId` (the sync or the Attio
 *                        import made it), no author otherwise.
 * - `matchingDecisions` (matched) → `transaction_matched` by `decidedBy` at
 *                        `decidedAt`; direction read from the transaction
 *                        when it still exists.
 * - `valuations`       → `valuation_added` at the row's `_creationTime`, no
 *                        author.
 * - `documents` with a `dealId` → `document_attached` by `uploadedBy` at
 *                        `uploadedAt`.
 *
 * Only what happened IN Albo OS is reconstructed. The Airtable import is a
 * bulk copy of a history that predates the app, so a row it created (deal or
 * valuation carrying an `airtableId`) gets no `created` / `valuation_added`
 * line — hundreds of them would share the import day, and the journal would
 * say « created » about deals that were years old. Same for a document row
 * without `uploadedBy`: only a one-shot import writes one.
 *
 * Field edits made before the journal existed are lost: nobody recorded them.
 *
 * Idempotent: every backfilled row carries `backfillKey = <source>:<rowId>`
 * and is skipped when already present, so a second run writes nothing. Rows
 * whose deal is gone are skipped (the journal follows the deal).
 *
 * Execution (prod, manual, one source at a time, re-run with the returned
 * `continueCursor` until `isDone`):
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:dryRun
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"deals"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"matching"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"valuations"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"documents"}'
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'
import type { CompanyEvent, CompanyEventActor } from '../lib/companyEvents'

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
  actor: CompanyEventActor,
  event: CompanyEvent,
): Promise<number> {
  if (!deal) return 0
  const existing = await ctx.db
    .query('companyEvents')
    .withIndex('by_backfill_key', (q) => q.eq('backfillKey', key))
    .first()
  if (existing) return 0
  await ctx.db.insert('companyEvents', {
    orgId: deal.orgId,
    companyId: deal.targetCompanyId,
    dealId: deal._id,
    at,
    actor,
    event,
    backfillKey: key,
  })
  return 1
}

const UNKNOWN: CompanyEventActor = { kind: 'unknown' }

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const deals = (await ctx.db.query('deals').collect()).filter(
      (d) => !d.airtableId,
    ).length
    const matching = (await ctx.db.query('matchingDecisions').collect()).filter(
      (d) => d.decision === 'matched' && d.dealId,
    ).length
    const valuations = (await ctx.db.query('valuations').collect()).filter(
      (val) => !val.airtableId,
    ).length
    const documents = (await ctx.db.query('documents').collect()).filter(
      (d) => d.dealId && d.uploadedBy,
    ).length
    const already = (await ctx.db.query('companyEvents').collect()).filter(
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
          if (deal.airtableId) continue
          written += await upsert(
            ctx,
            `deal:${deal._id}`,
            deal,
            deal._creationTime,
            deal.attioDealId ? { kind: 'system', source: 'attio' } : UNKNOWN,
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
          if (val.airtableId) continue
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
          if (!doc.dealId || !doc.uploadedBy) continue
          const deal = await ctx.db.get('deals', doc.dealId)
          written += await upsert(
            ctx,
            `doc:${doc._id}`,
            deal,
            doc.uploadedAt,
            { kind: 'user', userId: doc.uploadedBy },
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
