/// <reference types="vite/client" />
/**
 * Regression: how a report is deduplicated when it carries NO period
 * (convex/reportStore.ts:storeForCompany).
 *
 * A periodic report is keyed on (company, period) so a re-send updates in
 * place. A one-off document — liquidation notice, legal notification — has no
 * period to key on, and keying every one of them on the same empty slot would
 * make each new one silently overwrite the previous. They are identified by
 * the document itself — subject without its forwarding prefixes, title, and a
 * resend window — so two distinct courriers coexist while the SAME document,
 * re-forwarded by somebody else minutes later, updates in place.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { createOrg, createPortfolioCompany, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

async function createInboundEmail(
  t: Harness,
  subject: string,
  receivedAt: number,
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: `msg-${subject}`,
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject,
      receivedAt,
      attachments: [],
      status: 'received',
    })
  })
}

async function store(
  t: Harness,
  companyId: Id<'companies'>,
  orgId: Id<'organizations'>,
  inboundEmailId: Id<'inboundEmails'>,
  reportPeriod?: string,
  title = 'Titre',
): Promise<Id<'companyReports'>> {
  const stored = await t.mutation(internal.reportStore.storeForCompany, {
    companyId,
    orgId,
    inboundEmailId,
    title,
    headline: 'Résumé',
    keyHighlights: ['point'],
    reportPeriod,
    reportType: reportPeriod ? ('monthly' as const) : undefined,
    metrics: {},
    rawMetrics: [],
    canonical: [],
  })
  return stored.reportId
}

const DAY_MS = 24 * 60 * 60 * 1000

describe('storeForCompany — period-less reports', () => {
  test('two distinct period-less courriers coexist', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    const first = await createInboundEmail(t, 'Redressement judiciaire', 1_000)
    const second = await createInboundEmail(t, 'Liquidation et reprise', 2_000)

    const a = await store(t, companyId, org.orgId, first)
    const b = await store(t, companyId, org.orgId, second)

    expect(a).not.toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(2)
  })

  test('replaying the same period-less courrier updates in place', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    const email = await createInboundEmail(t, 'Liquidation et reprise', 1_000)

    const a = await store(t, companyId, org.orgId, email)
    const b = await store(t, companyId, org.orgId, email)

    expect(a).toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(1)
  })

  test('a period-less courrier never overwrites a periodic report', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    const periodic = await createInboundEmail(t, 'Update avril', 1_000)
    const courrier = await createInboundEmail(t, 'Liquidation et reprise', 2_000)

    const a = await store(t, companyId, org.orgId, periodic, 'April 2026')
    const b = await store(t, companyId, org.orgId, courrier)

    expect(a).not.toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r._id === a)?.reportPeriod).toBe('April 2026')
    expect(rows.find((r) => r._id === b)?.reportPeriod).toBeUndefined()
  })

  test('a periodic report still updates in place on re-send', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    const first = await createInboundEmail(t, 'Update avril', 1_000)
    const resent = await createInboundEmail(t, 'Fwd: Update avril', 2_000)

    const a = await store(t, companyId, org.orgId, first, 'April 2026')
    const b = await store(t, companyId, org.orgId, resent, 'April 2026')

    expect(a).toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(1)
  })

  test('the same courrier forwarded twice by two people files once', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Qomon')

    // Two forwards of the same investor update, ten minutes apart: the
    // prefixes differ, the reception dates differ, the document does not.
    const clement = await createInboundEmail(t, 'Fwd: Summer 2026 Investor Update', 1_000)
    const benjamin = await createInboundEmail(t, 'Tr : Summer 2026 Investor Update', 601_000)

    const a = await store(t, companyId, org.orgId, clement, undefined, 'Summer 2026 Update')
    const b = await store(t, companyId, org.orgId, benjamin, undefined, 'Summer 2026 Update')

    expect(a).toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(1)
  })

  test('the same subject a year later is a new courrier', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    const y1 = await createInboundEmail(t, 'Convocation AG', 1_000)
    const y2 = await createInboundEmail(t, 'Convocation AG', 1_000 + 365 * DAY_MS)

    const a = await store(t, companyId, org.orgId, y1, undefined, 'Convocation AG')
    const b = await store(t, companyId, org.orgId, y2, undefined, 'Convocation AG')

    expect(a).not.toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(2)
  })

  test('two courriers of the same week with different titles coexist', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Wheelee')

    // Same thread, two distinct documents: the title is what separates them.
    const first = await createInboundEmail(t, 'Procédure collective', 1_000)
    const second = await createInboundEmail(t, 'Re: Procédure collective', 2_000)

    const a = await store(t, companyId, org.orgId, first, undefined, 'Redressement judiciaire')
    const b = await store(t, companyId, org.orgId, second, undefined, 'Plan de cession')

    expect(a).not.toBe(b)
    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(2)
  })
})
