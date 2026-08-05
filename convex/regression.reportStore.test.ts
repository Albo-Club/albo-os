/// <reference types="vite/client" />
/**
 * Regression: how a report is deduplicated when it carries NO period
 * (convex/reportStore.ts:storeForCompany).
 *
 * A periodic report is keyed on (company, period) so a re-send updates in
 * place. A one-off document — liquidation notice, legal notification — has no
 * period to key on, and keying every one of them on the same empty slot would
 * make each new one silently overwrite the previous. They are identified by
 * their source message instead, so two distinct courriers coexist while a
 * replay of the same one still updates in place.
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
): Promise<Id<'companyReports'>> {
  return await t.mutation(internal.reportStore.storeForCompany, {
    companyId,
    orgId,
    inboundEmailId,
    title: 'Titre',
    headline: 'Résumé',
    keyHighlights: ['point'],
    reportPeriod,
    reportType: reportPeriod ? ('monthly' as const) : undefined,
    metrics: {},
    rawMetrics: [],
    canonical: [],
  })
}

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
})
