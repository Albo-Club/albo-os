/// <reference types="vite/client" />
/**
 * Regression: when the AI synthesis is re-run for a report (ALB-238, suite).
 *
 * The note used to be re-run on one signal only — "a report row was created".
 * Two gestures escaped it, both leaving the note describing something the
 * fiche no longer shows:
 *
 * - a CORRECTED report re-sent for the same (company, period) overwrites the
 *   row in place, so nothing was "created" and the pipeline filed it as a
 *   duplicate: new content on the fiche, stale note beside it;
 * - DETACHING a report removes it from the note's context, and detaching the
 *   last one has to put the entity back to "aucune donnée" — a note is not
 *   news that can only be added to.
 *
 * The counterpart is pinned too: a byte-identical re-forward stays a
 * duplicate. It must not burn an LLM call, and it must stay silent.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

type Content = {
  title?: string
  headline?: string
  keyHighlights?: Array<string>
  metrics?: Record<string, number>
  extractedText?: string
}

const BASE: Required<Content> = {
  title: 'Reporting Q2',
  headline: 'Le trimestre est conforme au plan.',
  keyHighlights: ['ARR 1,2 M€', 'Runway 18 mois'],
  metrics: { arr: 1_200_000, runway_months: 18 },
  extractedText: 'Contenu du reporting du trimestre.',
}

async function orgSetup(slug: string) {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Jeen')
  return { t, user, org, companyId }
}

/** A fresh forward: each re-send is its own `inboundEmails` row, as in prod. */
async function inbound(
  t: Harness,
  key: string,
  extractedText: string,
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: `msg-${key}`,
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject: 'Reporting Q2',
      receivedAt: 1_000,
      attachments: [],
      status: 'received',
      extractedText,
    }),
  )
}

async function store(
  t: Harness,
  companyId: Id<'companies'>,
  orgId: Id<'organizations'>,
  key: string,
  content: Content = {},
): Promise<{ created: boolean; changed: boolean }> {
  const merged = { ...BASE, ...content }
  const inboundEmailId = await inbound(t, key, merged.extractedText)
  const stored = await t.mutation(internal.reportStore.storeForCompany, {
    companyId,
    orgId,
    inboundEmailId,
    title: merged.title,
    headline: merged.headline,
    keyHighlights: merged.keyHighlights,
    reportPeriod: 'Q2 2026',
    reportType: 'quarterly' as const,
    metrics: merged.metrics,
    rawMetrics: [],
    canonical: [],
  })
  return { created: stored.created, changed: stored.changed }
}

/** Entities queued for an AI synthesis since the previous call. */
function watchAnalyses(t: Harness): () => Promise<Array<Id<'companies'>>> {
  let seen = 0
  return async () => {
    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    )
    const fresh = jobs.slice(seen)
    seen = jobs.length
    return fresh
      .filter((job) => job.name.endsWith('runAnalysis'))
      .map((job) => (job.args[0] as { companyId: Id<'companies'> }).companyId)
  }
}

describe('a re-sent report only counts as news when it changed', () => {
  test('an identical re-forward is a duplicate', async () => {
    const { t, org, companyId } = await orgSetup('org-dup')
    const first = await store(t, companyId, org.orgId, 'a')
    expect(first).toEqual({ created: true, changed: false })

    const second = await store(t, companyId, org.orgId, 'b')
    expect(second).toEqual({ created: false, changed: false })
  })

  test.each([
    ['un titre corrigé', { title: 'Reporting Q2 (corrigé)' }],
    ['un résumé réécrit', { headline: 'Le trimestre décroche.' }],
    ['un point clé ajouté', { keyHighlights: ['ARR 1,2 M€', 'Runway 9 mois'] }],
    ['une métrique révisée', { metrics: { arr: 900_000, runway_months: 9 } }],
    ['un contenu corrigé', { extractedText: 'Version corrigée du reporting.' }],
  ])('%s compte comme du neuf', async (_label, patch) => {
    const { t, org, companyId } = await orgSetup(
      `org-chg-${Math.random().toString(36).slice(2, 8)}`,
    )
    await store(t, companyId, org.orgId, 'a')

    const second = await store(t, companyId, org.orgId, 'b', patch)
    expect(second).toEqual({ created: false, changed: true })
  })

  test('the same metrics in a different key order is not a change', async () => {
    const { t, org, companyId } = await orgSetup('org-keyorder')
    await store(t, companyId, org.orgId, 'a', {
      metrics: { arr: 1_200_000, runway_months: 18 },
    })
    // The extraction rebuilds the object on each run; key order is noise.
    const second = await store(t, companyId, org.orgId, 'b', {
      metrics: { runway_months: 18, arr: 1_200_000 },
    })
    expect(second.changed).toBe(false)
  })
})

describe('detaching a report re-runs the synthesis', () => {
  test('the note is recomputed on what is left', async () => {
    const { t, user, org, companyId } = await orgSetup('org-detach')
    await store(t, companyId, org.orgId, 'a')
    const analyzed = watchAnalyses(t)
    const reportId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .first()
      return row!._id
    })

    await user.as.mutation(api.reportInbox.detachCompany, { reportId })

    expect(await analyzed()).toEqual([companyId])
  })
})
