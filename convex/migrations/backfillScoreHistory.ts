/**
 * One-shot backfill of the health-score history — `companyEvents` rows of
 * kind `score_updated` — from the AI synthesis threads, all orgs (ALB-252).
 *
 * Until v1.245.0 every synthesis OVERWROTE the previous one on
 * `companyIntelligence`, so the journal only records scores from that
 * release on. The scores themselves were never lost: each run of
 * `intelligence.runAnalysis` opens a thread in the agent component (user
 * `<orgId>:system`, title `Intelligence — <companyId>`) and the component
 * keeps the model's answer — the JSON carrying `health_score`. Nothing
 * deletes those threads (the chat's delete is scoped to user threads, no
 * cron vacuums the component). This module replays them into the journal:
 * one `score_updated` row per thread, dated at the thread's creation.
 *
 * Only syntheses from the current rubric are replayed. The scoring rubric
 * changed on 07/08/2026 (v1.188.0): before it, the whole portfolio sat
 * between 4 and 7, so replaying those would paint fake rises and drops at
 * that boundary. `RUBRIC_SINCE` is that release's deploy time.
 *
 * Per thread: the latest assistant message with a parsable JSON gives the
 * score and its label (a thread without one — failed run, `no_data` — is
 * skipped); `from` is the score of the previous `score_updated` row of the
 * company (backfilled or not); `reportLabel` is the newest report stored
 * before the synthesis, the same rule the live write uses.
 *
 * Idempotent: every row carries `backfillKey = score:<threadId>`, so a
 * re-run writes nothing new. It also stops where the live journal starts:
 * a thread created after the company's first native `score_updated` row
 * (minus a 15-minute margin, the synthesis takes a while between thread
 * creation and the write) is skipped — it IS that native row.
 *
 * Execution (prod, manual — read-only steps first):
 *   pnpm exec convex run --prod migrations/backfillScoreHistory:dryRun
 *   # STOP: read the counts and the lines (company, date, from → to,
 *   # report), then:
 *   pnpm exec convex run --prod migrations/backfillScoreHistory:apply
 *   # A second apply reports `already` = the number just written, `written` 0.
 */
import { listMessages } from '@convex-dev/agent'
import { v } from 'convex/values'
import { components, internal } from '../_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import { aiHealthScore } from '../deals'
import { extractJson } from '../intelligence'
import type { GenericActionCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type ActionCtx = GenericActionCtx<DataModel>

/** v1.188.0 — the current scoring rubric — deployed 07/08/2026 15:57 Paris. */
export const RUBRIC_SINCE = Date.UTC(2026, 7, 7, 13, 57)
const TITLE_PREFIX = 'Intelligence — '
/** A thread this close before the first native row is that row's own run. */
const NATIVE_MARGIN_MS = 15 * 60 * 1000

export const listOrgs = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('organizations').collect()).map((o) => ({
      _id: o._id,
      slug: o.slug,
    })),
})

type Outcome =
  | 'written'
  | 'already'
  | 'native'
  | 'unknown_company'
  | 'foreign_company'

export type Line = {
  org: string
  company: string
  at: string
  from: number | null
  to: number
  label?: string
  reportLabel?: string
}

/**
 * One thread → one journal row (or a reason not to). `at` is the thread's
 * creation time; the score comes from its last assistant message.
 */
export const recordThread = internalMutation({
  args: {
    orgId: v.id('organizations'),
    orgSlug: v.string(),
    threadId: v.string(),
    companyId: v.string(),
    at: v.number(),
    score: v.number(),
    label: v.optional(v.string()),
    dryRun: v.boolean(),
  },
  handler: async (
    ctx,
    { orgId, orgSlug, threadId, companyId, at, score, label, dryRun },
  ): Promise<{ outcome: Outcome; line?: Line }> => {
    const key = `score:${threadId}`
    const existing = await ctx.db
      .query('companyEvents')
      .withIndex('by_backfill_key', (q) => q.eq('backfillKey', key))
      .first()
    if (existing) return { outcome: 'already' }

    const id = ctx.db.normalizeId('companies', companyId)
    const company = id ? await ctx.db.get('companies', id) : null
    if (!company) return { outcome: 'unknown_company' }
    if (company.orgId !== orgId) return { outcome: 'foreign_company' }

    // Where the live journal starts for this company: its first
    // `score_updated` row written by the app itself (no backfill key).
    let firstNativeAt: number | null = null
    for await (const row of ctx.db
      .query('companyEvents')
      .withIndex('by_company_at', (q) => q.eq('companyId', company._id))) {
      if (row.event.kind === 'score_updated' && !row.backfillKey) {
        firstNativeAt = row.at
        break
      }
    }
    if (firstNativeAt !== null && at >= firstNativeAt - NATIVE_MARGIN_MS) {
      return { outcome: 'native' }
    }

    // The score before this one: the newest `score_updated` row dated
    // earlier, backfilled or not.
    let from: number | undefined
    for await (const row of ctx.db
      .query('companyEvents')
      .withIndex('by_company_at', (q) =>
        q.eq('companyId', company._id).lt('at', at),
      )
      .order('desc')) {
      if (row.event.kind === 'score_updated') {
        from = row.event.to
        break
      }
    }

    // The report the synthesis ran on: the newest one stored before it —
    // the rule `intelligence.upsertIntelligence` applies live. `<=`: the
    // synthesis is scheduled right after the store, same clock tick or later.
    let reportLabel: string | undefined
    for await (const report of ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', company._id))
      .order('desc')) {
      if (report._creationTime <= at) {
        reportLabel = report.reportPeriod ?? report.title
        break
      }
    }

    if (!dryRun) {
      await ctx.db.insert('companyEvents', {
        orgId,
        companyId: company._id,
        at,
        actor: { kind: 'system', source: 'intelligence' },
        event: { kind: 'score_updated', from, to: score, label, reportLabel },
        backfillKey: key,
      })
    }
    return {
      outcome: 'written',
      line: {
        org: orgSlug,
        company: company.name,
        at: new Date(at).toISOString(),
        from: from ?? null,
        to: score,
        label,
        reportLabel,
      },
    }
  },
})

type Summary = {
  threads: number
  beforeRubric: number
  noScore: number
  written: number
  already: number
  native: number
  unknownCompany: number
  foreignCompany: number
  lines: Array<Line>
}

/** The score and label the model wrote, from a thread's assistant messages
 * (newest first). Null when no message carries a scored JSON. */
async function scoreOfThread(
  ctx: ActionCtx,
  threadId: string,
): Promise<{ score: number; label?: string } | null> {
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 50, cursor: null },
    excludeToolMessages: true,
  })
  for (const msg of page) {
    if (msg.message?.role !== 'assistant' || !msg.text) continue
    let analysis: unknown
    try {
      analysis = extractJson(msg.text)
    } catch {
      continue
    }
    const score = aiHealthScore(analysis)
    if (score === null) continue
    const label = (analysis as { health_score?: { label?: unknown } })
      .health_score?.label
    return { score, label: typeof label === 'string' ? label : undefined }
  }
  return null
}

async function replay(ctx: ActionCtx, dryRun: boolean): Promise<Summary> {
  const summary: Summary = {
    threads: 0,
    beforeRubric: 0,
    noScore: 0,
    written: 0,
    already: 0,
    native: 0,
    unknownCompany: 0,
    foreignCompany: 0,
    lines: [],
  }
  const orgs: Array<{ _id: Id<'organizations'>; slug: string }> =
    await ctx.runQuery(internal.migrations.backfillScoreHistory.listOrgs, {})

  for (const org of orgs) {
    let cursor: string | null = null
    do {
      const batch: {
        page: Array<{ _id: string; _creationTime: number; title?: string }>
        isDone: boolean
        continueCursor: string
      } = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId: `${org._id}:system`,
        order: 'asc',
        paginationOpts: { numItems: 100, cursor },
      })
      const { page, isDone, continueCursor } = batch
      for (const thread of page) {
        if (!thread.title?.startsWith(TITLE_PREFIX)) continue
        summary.threads += 1
        if (thread._creationTime < RUBRIC_SINCE) {
          summary.beforeRubric += 1
          continue
        }
        const scored = await scoreOfThread(ctx, thread._id)
        if (!scored) {
          summary.noScore += 1
          continue
        }
        const result: { outcome: Outcome; line?: Line } = await ctx.runMutation(
          internal.migrations.backfillScoreHistory.recordThread,
          {
            orgId: org._id,
            orgSlug: org.slug,
            threadId: thread._id,
            companyId: thread.title.slice(TITLE_PREFIX.length),
            at: thread._creationTime,
            score: scored.score,
            label: scored.label,
            dryRun,
          },
        )
        if (result.outcome === 'written') {
          summary.written += 1
          if (result.line) summary.lines.push(result.line)
        } else if (result.outcome === 'already') summary.already += 1
        else if (result.outcome === 'native') summary.native += 1
        else if (result.outcome === 'unknown_company')
          summary.unknownCompany += 1
        else summary.foreignCompany += 1
      }
      cursor = isDone ? null : continueCursor
    } while (cursor !== null)
  }
  return summary
}

/** Read-only: what `apply` would write. `written` counts the rows it would add. */
export const dryRun = internalAction({
  args: {},
  handler: async (ctx): Promise<Summary> => await replay(ctx, true),
})

export const apply = internalAction({
  args: {},
  handler: async (ctx): Promise<Summary> => await replay(ctx, false),
})
