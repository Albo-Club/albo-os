/// <reference types="vite/client" />
/**
 * Regression: the health-score history replayed from the AI synthesis
 * threads (`migrations/backfillScoreHistory`, ALB-252).
 *
 * - One `score_updated` row per thread carrying a scored JSON, dated at the
 *   thread, chained (`from` = the previous row's `to`) and tied to the
 *   newest report stored before it.
 * - A thread without a scored answer (failed run) writes nothing; a thread
 *   titled for another org's company is refused.
 * - Idempotent: a second `apply` reports `already`, never a second row.
 * - The replay stops where the live journal starts: a thread created after
 *   the company's first native row (15-minute margin) is that row.
 */
import { saveMessages } from '@convex-dev/agent'
import agentTest from '@convex-dev/agent/test'
import { describe, expect, test } from 'vitest'
import { api, components, internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

const JSON_ANSWER = (score: number, label: string) =>
  `Voici la synthèse.\n\`\`\`json\n${JSON.stringify({
    executive_summary: 's',
    health_score: { score, label, good_points: [], bad_points: [] },
    top_insights: [],
    alerts: [],
  })}\n\`\`\``

/** A synthesis thread as `intelligence.runAnalysis` leaves it behind. */
async function synthesisThread(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  answer: string | null,
): Promise<string> {
  const thread = await t.mutation(components.agent.threads.createThread, {
    userId: `${orgId}:system`,
    title: `Intelligence — ${companyId}`,
  })
  await t.run(async (ctx) => {
    await saveMessages(ctx, components.agent, {
      threadId: thread._id,
      messages: [
        { role: 'user', content: 'Analyse cette portfolio company.' },
        ...(answer ? [{ role: 'assistant' as const, content: answer }] : []),
      ],
    })
  })
  return thread._id
}

async function setup() {
  const t = setupHarness()
  agentTest.register(t, 'agent')
  const user = await createUser(t, 'score-history@test.dev')
  const org = await createOrg(t, 'org-score-history', [
    { userId: user.userId, role: 'owner' },
  ])
  const company = await createPortfolioCompany(t, org.orgId, 'Startup')
  const report = (reportPeriod: string) =>
    t.run(async (ctx) =>
      ctx.db.insert('companyReports', {
        orgId: org.orgId,
        companyId: company,
        source: 'upload',
        status: 'completed',
        reportPeriod,
      }),
    )
  return { t, user, org, company, report }
}

describe('backfillScoreHistory', () => {
  test('replays the scored threads into the journal, once', async () => {
    const { t, user, org, company, report } = await setup()
    await report('Q3 2026')
    await synthesisThread(
      t,
      org.orgId,
      company,
      JSON_ANSWER(8, 'En bonne voie'),
    )
    await synthesisThread(t, org.orgId, company, null) // failed run
    await report('Q4 2026')
    await synthesisThread(t, org.orgId, company, JSON_ANSWER(6, 'À surveiller'))
    // A thread titled for a company of another org: refused, not written.
    const other = await createOrg(t, 'org-other', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreign = await createPortfolioCompany(t, other.orgId, 'Elsewhere')
    await synthesisThread(t, org.orgId, foreign, JSON_ANSWER(9, 'Excellent'))

    const dry = await t.action(
      internal.migrations.backfillScoreHistory.dryRun,
      {},
    )
    expect(dry).toMatchObject({
      threads: 4,
      beforeRubric: 0,
      noScore: 1,
      written: 2,
      already: 0,
      native: 0,
      foreignCompany: 1,
    })
    expect(dry.lines.map((l) => [l.from, l.to, l.reportLabel])).toEqual([
      [null, 8, 'Q3 2026'],
      [null, 6, 'Q4 2026'], // dry run writes nothing, so no chain yet
    ])
    // Nothing written by the dry run.
    expect(
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: company,
      }),
    ).toEqual([])

    const applied = await t.action(
      internal.migrations.backfillScoreHistory.apply,
      {},
    )
    expect(applied).toMatchObject({ written: 2, noScore: 1, foreignCompany: 1 })
    expect(applied.lines.map((l) => [l.from, l.to, l.reportLabel])).toEqual([
      [null, 8, 'Q3 2026'],
      [8, 6, 'Q4 2026'],
    ])
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: company,
    })
    expect(rows.map((r) => r.event)).toEqual([
      {
        kind: 'score_updated',
        from: 8,
        to: 6,
        label: 'À surveiller',
        reportLabel: 'Q4 2026',
      },
      {
        kind: 'score_updated',
        to: 8,
        label: 'En bonne voie',
        reportLabel: 'Q3 2026',
      },
    ])
    expect(rows[0].actor).toEqual({ kind: 'system', source: 'intelligence' })
    // The fiche reads the replayed history like a live one.
    const intel = await t.run(async (ctx) => {
      const { latestScoreEvolution } = await import('./lib/scoreEvolution')
      return await latestScoreEvolution(ctx, company)
    })
    expect(intel).toEqual({ previousScore: 8, previousReportLabel: 'Q3 2026' })

    const again = await t.action(
      internal.migrations.backfillScoreHistory.apply,
      {},
    )
    expect(again).toMatchObject({ written: 0, already: 2 })
  })

  test('stops where the live journal starts', async () => {
    const { t, org, company } = await setup()
    // A native row, as `intelligence.upsertIntelligence` writes it.
    await t.mutation(internal.intelligence.upsertIntelligence, {
      companyId: company,
      orgId: org.orgId,
      status: 'completed',
      analysis: { executive_summary: 's', health_score: { score: 7 } },
    })
    const nativeAt = (await t.run(async (ctx) =>
      ctx.db
        .query('companyEvents')
        .withIndex('by_company_at', (q) => q.eq('companyId', company))
        .first(),
    ))!.at
    const record = (threadId: string, at: number) =>
      t.mutation(internal.migrations.backfillScoreHistory.recordThread, {
        orgId: org.orgId,
        orgSlug: 'org-score-history',
        threadId,
        companyId: company,
        at,
        score: 5,
        dryRun: false,
      })
    // An hour before the first native row: history, written.
    expect(await record('t-old', nativeAt - 60 * 60 * 1000)).toMatchObject({
      outcome: 'written',
    })
    // Five minutes before: the run that produced the native row itself.
    expect(await record('t-same', nativeAt - 5 * 60 * 1000)).toEqual({
      outcome: 'native',
    })
    expect(await record('t-after', nativeAt + 1)).toEqual({ outcome: 'native' })
    // Unknown company id: refused.
    expect(
      await t.mutation(internal.migrations.backfillScoreHistory.recordThread, {
        orgId: org.orgId,
        orgSlug: 'org-score-history',
        threadId: 't-unknown',
        companyId: 'not-an-id',
        at: nativeAt - 60 * 60 * 1000,
        score: 5,
        dryRun: false,
      }),
    ).toEqual({ outcome: 'unknown_company' })
  })
})
