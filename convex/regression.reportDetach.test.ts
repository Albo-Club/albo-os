/// <reference types="vite/client" />
/**
 * Regression: detaching a report from ONE entity
 * (convex/reportInbox.ts:detachCompany).
 *
 * A report emailed once lands on every entity representing the participation
 * (multi-org fan-out), and a manual assignment can put it on an entity it does
 * not concern. Detaching has to undo everything the storage wrote for THAT
 * entity — report row, document rows, sourced KPI snapshots, synthesis
 * pointer — while leaving the other entities' copies and the shared storage
 * blob untouched, and correcting the queue row so a replay does not put it
 * back.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness, TestUser } from './regression.setup'
import type { Id } from './_generated/dataModel'

const PERIOD_START = 1_700_000_000_000
const PERIOD_END = 1_702_000_000_000

async function createInboundEmail(
  t: Harness,
  storageId: Id<'_storage'>,
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: 'msg-avril',
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject: 'Update avril',
      receivedAt: 1_000,
      attachments: [
        {
          attachmentId: 'att-1',
          filename: 'update.pdf',
          contentType: 'application/pdf',
          size: 1_024,
          storageId,
        },
      ],
      status: 'received',
    })
  })
}

async function store(
  t: Harness,
  companyId: Id<'companies'>,
  orgId: Id<'organizations'>,
  inboundEmailId: Id<'inboundEmails'>,
  reportPeriod: string,
): Promise<Id<'companyReports'>> {
  return await t.mutation(internal.reportStore.storeForCompany, {
    companyId,
    orgId,
    inboundEmailId,
    title: 'Titre',
    headline: 'Résumé',
    keyHighlights: ['point'],
    reportPeriod,
    reportType: 'monthly' as const,
    metrics: { arr: 1_000 },
    rawMetrics: [],
    canonical: [
      {
        metricType: 'arr',
        value: 1_000,
        unit: 'eur_cents',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      },
    ],
  })
}

/** Two orgs holding the same participation — the usual fan-out shape. */
async function setupFanOut(t: Harness, user: TestUser) {
  const albo = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
  const calte = await createOrg(t, 'calte', [{ userId: user.userId, role: 'owner' }])
  const right = await createPortfolioCompany(t, albo.orgId, 'Wheelee')
  const wrong = await createPortfolioCompany(t, calte.orgId, 'Sezame Immo 6')
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' })),
  )
  const emailId = await createInboundEmail(t, storageId)
  await t.run(async (ctx) => {
    await ctx.db.patch('inboundEmails', emailId, {
      matchedCompanies: [
        { companyId: right, orgId: albo.orgId },
        { companyId: wrong, orgId: calte.orgId },
      ],
      matchMethod: 'manual',
    })
  })

  const rightReport = await store(t, right, albo.orgId, emailId, 'April 2026')
  const wrongReport = await store(t, wrong, calte.orgId, emailId, 'April 2026')
  await t.mutation(internal.reportStore.markProcessed, {
    inboundEmailId: emailId,
    reportIds: [rightReport, wrongReport],
  })
  return { albo, calte, right, wrong, storageId, emailId, rightReport, wrongReport }
}

describe('detachCompany', () => {
  test('removes the report footprint on that entity only', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const s = await setupFanOut(t, user)

    await user.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport })

    const state = await t.run(async (ctx) => ({
      reports: await ctx.db.query('companyReports').collect(),
      documents: await ctx.db.query('documents').collect(),
      snapshots: await ctx.db.query('kpiSnapshots').collect(),
    }))
    // The wrong entity keeps nothing; the right one keeps everything.
    expect(state.reports.map((r) => r._id)).toEqual([s.rightReport])
    expect(state.documents.map((d) => d.companyId)).toEqual([s.right])
    expect(state.snapshots.map((k) => k.companyId)).toEqual([s.right])
  })

  test('leaves the shared storage blob alone', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const s = await setupFanOut(t, user)

    await user.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport })

    // One blob backs both entities' document rows AND the email attachment:
    // detaching one participation must not blank the others.
    const stillThere = await t.run(
      async (ctx) => (await ctx.storage.get(s.storageId)) !== null,
    )
    expect(stillThere).toBe(true)
  })

  test('corrects the queue row so a replay does not put it back', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const s = await setupFanOut(t, user)

    await user.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport })

    const row = await t.run(async (ctx) => ctx.db.get('inboundEmails', s.emailId))
    expect(row?.matchedCompanies?.map((m) => m.companyId)).toEqual([s.right])
    expect(row?.reportIds).toEqual([s.rightReport])
  })

  test('clears the synthesis pointer when it was the last report', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const s = await setupFanOut(t, user)

    await user.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport })

    const intelligence = await t.run(async (ctx) =>
      ctx.db
        .query('companyIntelligence')
        .withIndex('by_company', (q) => q.eq('companyId', s.wrong))
        .unique(),
    )
    expect(intelligence?.latestReportId).toBeUndefined()
  })

  test('falls back on the report left when several were stored', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const s = await setupFanOut(t, user)
    const older = await createInboundEmail(t, s.storageId)
    const olderReport = await store(t, s.wrong, s.calte.orgId, older, 'March 2026')

    await user.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport })

    const intelligence = await t.run(async (ctx) =>
      ctx.db
        .query('companyIntelligence')
        .withIndex('by_company', (q) => q.eq('companyId', s.wrong))
        .unique(),
    )
    expect(intelligence?.latestReportId).toBe(olderReport)
  })

  test('refuses a report of an org the caller does not belong to', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const outsider = await createUser(t, 'outsider@test.dev')
    const s = await setupFanOut(t, user)

    await expectConvexError(
      outsider.as.mutation(api.reportInbox.detachCompany, { reportId: s.wrongReport }),
      'not_a_member',
    )
  })
})
