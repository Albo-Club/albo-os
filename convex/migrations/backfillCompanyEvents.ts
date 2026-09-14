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
 * - `matchingDecisions` → replayed per transaction, in order, as a state
 *                        machine (`replayMatchingDecisions`): a `matched`
 *                        decision sets the current deal and yields
 *                        `transaction_matched`; ANY later decision on that
 *                        transaction (unmatch, but also a reclassification as
 *                        charge / tax / product / ignored / internal transfer,
 *                        which detaches silently) yields
 *                        `transaction_unmatched` on the current deal. The log
 *                        never records the deal on the way out — the replay
 *                        is what recovers it. A decision that leaves a deal
 *                        the log never saw entered (matched before the log
 *                        existed) is unattributable: skipped and counted. A
 *                        transaction deleted since (deduplicated duplicates)
 *                        yields nothing, and its already-backfilled rows are
 *                        removed.
 * - `valuations`       → `valuation_added` at the row's `_creationTime`, no
 *                        author.
 * - `documents` with a `dealId` → `document_attached` by `uploadedBy` at
 *                        `uploadedAt`.
 * - `companyReports`   → `report_received` at the mail date, by the member
 *                        who forwarded / uploaded it (`inboundEmails.
 *                        senderUserId`), by Parallel for a portal
 *                        publication, no author otherwise. Detachments and
 *                        deletions are gone with their rows: not rebuilt.
 * - vault `documents`  (company anchor, no deal, not a report's file) →
 *                        `vault_document_added` by `uploadedBy`.
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
 * `continueCursor` until `isDone` — `matching` replays the whole log in one
 * call, the table is small):
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:dryRun
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"deals"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"matching"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"valuations"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"documents"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"reports"}'
 *   pnpm exec convex run --prod migrations/backfillCompanyEvents:apply '{"source":"vault"}'
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { CompanyEvent, CompanyEventActor } from '../lib/companyEvents'

const sourceValidator = v.union(
  v.literal('deals'),
  v.literal('matching'),
  v.literal('valuations'),
  v.literal('documents'),
  v.literal('reports'),
  v.literal('vault'),
)
const BATCH = 500

type MutCtx = GenericMutationCtx<DataModel>

/** One journal row the replay of the decision log wants written. */
type ReplayedEvent = {
  key: string
  dealId: Id<'deals'>
  at: number
  actor: CompanyEventActor
  event: CompanyEvent
}

/**
 * Replays the pointage decisions of ONE transaction, oldest first, and says
 * which journal rows they amount to. Pure, so the dry run and the tests share
 * it with `apply`. `unattributable` counts the decisions that leave a deal
 * the log never saw entered.
 */
export function replayMatchingDecisions(
  decisions: Array<Doc<'matchingDecisions'>>,
  direction: 'in' | 'out',
): { events: Array<ReplayedEvent>; unattributable: number } {
  const ordered = [...decisions].sort(
    (a, b) => a.decidedAt - b.decidedAt || a._creationTime - b._creationTime,
  )
  const events: Array<ReplayedEvent> = []
  let unattributable = 0
  let current: Id<'deals'> | null = null
  for (const md of ordered) {
    const actor: CompanyEventActor = {
      kind: 'user',
      userId: md.decidedBy,
      ...(md.source === 'agent_suggested' ? { viaAgent: true } : {}),
    }
    if (md.decision === 'matched' && md.dealId) {
      events.push({
        key: `md:${md._id}`,
        dealId: md.dealId,
        at: md.decidedAt,
        actor,
        event: {
          kind: 'transaction_matched',
          amountCents: md.txAmount,
          direction,
        },
      })
      current = md.dealId
      continue
    }
    if (current) {
      events.push({
        key: `md:${md._id}`,
        dealId: current,
        at: md.decidedAt,
        actor,
        event: {
          kind: 'transaction_unmatched',
          amountCents: md.txAmount,
          direction,
        },
      })
      current = null
    } else if (md.decision === 'unmatched') {
      unattributable += 1
    }
  }
  return { events, unattributable }
}

/** Decisions grouped by transaction — the unit the replay works on. */
function groupByTransaction(
  rows: Array<Doc<'matchingDecisions'>>,
): Map<Id<'transactions'>, Array<Doc<'matchingDecisions'>>> {
  const groups = new Map<Id<'transactions'>, Array<Doc<'matchingDecisions'>>>()
  for (const md of rows) {
    const list = groups.get(md.transactionId) ?? []
    list.push(md)
    groups.set(md.transactionId, list)
  }
  return groups
}

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
  return await upsertOn(
    ctx,
    key,
    { orgId: deal.orgId, companyId: deal.targetCompanyId, dealId: deal._id },
    at,
    actor,
    event,
  )
}

/** Same, anchored on a company (deal optional) — the company-level rows. */
async function upsertOn(
  ctx: MutCtx,
  key: string,
  target: {
    orgId: Id<'organizations'>
    companyId: Id<'companies'>
    dealId?: Id<'deals'>
  },
  at: number,
  actor: CompanyEventActor,
  event: CompanyEvent,
): Promise<number> {
  const existing = await ctx.db
    .query('companyEvents')
    .withIndex('by_backfill_key', (q) => q.eq('backfillKey', key))
    .first()
  if (existing) return 0
  await ctx.db.insert('companyEvents', {
    ...target,
    at,
    actor,
    event,
    backfillKey: key,
  })
  return 1
}

/** A stored report as a `report_received` row: credited to the member who
 * forwarded / uploaded it (the source mail says), to Parallel for a portal
 * publication, to nobody when the mail is gone. Rows the Albo app import
 * copied (`alboReportId`) predate the app and are skipped. */
async function reportEvent(
  ctx: MutCtx,
  report: Doc<'companyReports'>,
): Promise<{
  at: number
  actor: CompanyEventActor
  event: CompanyEvent
} | null> {
  if (report.alboReportId) return null
  const email = report.inboundEmailId
    ? await ctx.db.get('inboundEmails', report.inboundEmailId)
    : null
  const channel = report.source
  const actor: CompanyEventActor =
    channel === 'vasco'
      ? { kind: 'system', source: 'vasco' }
      : email?.senderUserId
        ? { kind: 'user', userId: email.senderUserId }
        : UNKNOWN
  const label = report.reportPeriod ?? report.title ?? report.subject ?? ''
  return {
    at: report.emailDate ?? report.processedAt ?? report._creationTime,
    actor,
    event: {
      kind: 'report_received',
      channel,
      label,
      ...(channel === 'email' && report.fromEmail
        ? { fromEmail: report.fromEmail }
        : {}),
    },
  }
}

/** A vault row: filed under the company, not a deal's, not a report's. */
function isVaultDocument(doc: Doc<'documents'>): boolean {
  return Boolean(
    doc.companyId && !doc.dealId && !doc.reportId && doc.uploadedBy,
  )
}

const UNKNOWN: CompanyEventActor = { kind: 'unknown' }

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const deals = (await ctx.db.query('deals').collect()).filter(
      (d) => !d.airtableId,
    ).length
    let matching = 0
    let unattributable = 0
    const groups = groupByTransaction(
      await ctx.db.query('matchingDecisions').collect(),
    )
    for (const [transactionId, decisions] of groups) {
      const tx = await ctx.db.get('transactions', transactionId)
      if (!tx) continue
      const replay = replayMatchingDecisions(decisions, tx.direction)
      matching += replay.events.length
      unattributable += replay.unattributable
    }
    const valuations = (await ctx.db.query('valuations').collect()).filter(
      (val) => !val.airtableId,
    ).length
    const allDocuments = await ctx.db.query('documents').collect()
    const documents = allDocuments.filter(
      (d) => d.dealId && d.uploadedBy,
    ).length
    const vault = allDocuments.filter(isVaultDocument).length
    const reports = (await ctx.db.query('companyReports').collect()).filter(
      (r) => !r.alboReportId,
    ).length
    const already = (await ctx.db.query('companyEvents').collect()).filter(
      (e) => e.backfillKey,
    ).length
    return {
      candidates: { deals, matching, valuations, documents, reports, vault },
      unattributable,
      already,
    }
  },
})

export const apply = internalMutation({
  args: { source: sourceValidator, cursor: v.optional(v.string()) },
  handler: async (ctx, { source, cursor }) => {
    let written = 0
    let removed = 0
    let unattributable = 0
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
        // Whole log in one pass: the replay needs every decision of a
        // transaction together, and the table is a few hundred rows.
        const groups = groupByTransaction(
          await ctx.db.query('matchingDecisions').collect(),
        )
        for (const [transactionId, decisions] of groups) {
          const tx = await ctx.db.get('transactions', transactionId)
          if (!tx) {
            // Deduplicated duplicate: its gestures are moot, and a row an
            // earlier run backfilled for them must go.
            for (const md of decisions) {
              const stale = await ctx.db
                .query('companyEvents')
                .withIndex('by_backfill_key', (q) =>
                  q.eq('backfillKey', `md:${md._id}`),
                )
                .first()
              if (stale) {
                await ctx.db.delete('companyEvents', stale._id)
                removed += 1
              }
            }
            continue
          }
          const { events, unattributable: skipped } = replayMatchingDecisions(
            decisions,
            tx.direction,
          )
          unattributable += skipped
          for (const ev of events) {
            const deal = await ctx.db.get('deals', ev.dealId)
            written += await upsert(
              ctx,
              ev.key,
              deal,
              ev.at,
              ev.actor,
              ev.event,
            )
          }
        }
        continueCursor = ''
        isDone = true
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
      case 'reports': {
        const page = await ctx.db.query('companyReports').paginate(opts)
        for (const report of page.page) {
          const ev = await reportEvent(ctx, report)
          if (!ev) continue
          written += await upsertOn(
            ctx,
            `rep:${report._id}`,
            { orgId: report.orgId, companyId: report.companyId },
            ev.at,
            ev.actor,
            ev.event,
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
      case 'vault': {
        const page = await ctx.db.query('documents').paginate(opts)
        for (const doc of page.page) {
          if (!isVaultDocument(doc) || !doc.companyId || !doc.uploadedBy)
            continue
          written += await upsertOn(
            ctx,
            `doc:${doc._id}`,
            { orgId: doc.orgId, companyId: doc.companyId },
            doc.uploadedAt,
            { kind: 'user', userId: doc.uploadedBy },
            { kind: 'vault_document_added', title: doc.title },
          )
        }
        ;({ continueCursor, isDone } = page)
        break
      }
    }
    return { source, written, removed, unattributable, continueCursor, isDone }
  },
})
