/// <reference types="vite/client" />
/**
 * Regression: who hears about a report, and what they are shown (ALB-115).
 *
 * Three rules are load-bearing here and each one is easy to undo by accident:
 *
 * 1. A report that lands for the FIRST time is news for the organization, so
 *    the other members are told. A duplicate is not news — a second forward of
 *    something already filed answers only the person who forwarded it, and
 *    announces nothing to anybody else. Without that distinction, re-sending
 *    one investor update mails the whole team a second time about a report
 *    they already read.
 *
 * 2. The mail carries committed amounts and fiche links, so its entity list is
 *    scoped to the reader's OWN organizations. A member of Albo alone must
 *    never receive the Calte line of a company that exists on both sides — the
 *    app itself refuses to show it to them.
 *
 * 3. The report-issue recipient list can never be emptied. The notice a
 *    forwarder gets on failure says the team has been told; with nobody
 *    subscribed that sentence is a lie AND the failure reaches no one.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { routeRecap } from './lib/reportRouting'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

describe('routeRecap — audience follows the event', () => {
  test('a first-time report is announced to the org, a duplicate to nobody', () => {
    const success = routeRecap({
      kind: 'success',
      senderIsMember: true,
      senderHandlesIssues: false,
    })
    expect(success.reply).toBe('confirmation')
    expect(success.broadcast).toBe(true)

    const duplicate = routeRecap({
      kind: 'duplicate',
      senderIsMember: true,
      senderHandlesIssues: false,
    })
    expect(duplicate.reply).toBe('duplicate')
    // The whole point: nothing new happened, so nobody else is disturbed.
    expect(duplicate.broadcast).toBe(false)
    expect(duplicate.alertOthers).toBe(false)
  })

  test('a failure never reaches the org, and never carries a cause to a forwarder', () => {
    const forwarder = routeRecap({
      kind: 'failure',
      senderIsMember: true,
      senderHandlesIssues: false,
    })
    expect(forwarder.reply).toBe('soft')
    expect(forwarder.withQuality).toBe(false)
    expect(forwarder.broadcast).toBe(false)
    // The people who hold the queue still hear about it.
    expect(forwarder.alertOthers).toBe(true)

    const handler = routeRecap({
      kind: 'failure',
      senderIsMember: true,
      senderHandlesIssues: true,
    })
    expect(handler.reply).toBe('alert')
  })

  test('the quality block follows the role, not the outcome', () => {
    expect(
      routeRecap({ kind: 'success', senderIsMember: true, senderHandlesIssues: true })
        .withQuality,
    ).toBe(true)
    expect(
      routeRecap({ kind: 'success', senderIsMember: true, senderHandlesIssues: false })
        .withQuality,
    ).toBe(false)
  })

  test('an unknown sender is never replied to, whatever happened', () => {
    for (const kind of ['success', 'duplicate', 'failure', 'quarantine'] as const) {
      const route = routeRecap({ kind, senderIsMember: false, senderHandlesIssues: false })
      // Anti-enumeration: replying would confirm the address exists.
      expect(route.reply).toBeNull()
      expect(route.broadcast).toBe(false)
    }
  })
})

describe('entityCards — a reader only sees their own organizations', () => {
  test('the Calte line of a cross-org company is dropped for an Albo-only member', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const clement = await createUser(t, 'clement@test.dev')
    // Ben is in both vehicles, Clément only in Albo.
    const albo = await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: clement.userId, role: 'member' },
    ])
    const calte = await createOrg(t, 'calte', [{ userId: ben.userId, role: 'owner' }])

    const alboCo = await createPortfolioCompany(t, albo.orgId, 'Oprtrs & Co')
    const calteCo = await createPortfolioCompany(t, calte.orgId, 'OPRTRS CLUB')
    const refs = [
      { companyId: alboCo, orgId: albo.orgId },
      { companyId: calteCo, orgId: calte.orgId },
    ]

    const forBen = await t.query(internal.reportNotify.entityCards, {
      refs,
      userId: ben.userId,
    })
    expect(forBen.map((c) => c.orgName).sort()).toEqual(['albo', 'calte'])

    const forClement = await t.query(internal.reportNotify.entityCards, {
      refs,
      userId: clement.userId,
    })
    expect(forClement).toHaveLength(1)
    expect(forClement[0].orgName).toBe('albo')
  })

  test('the fiche line totals every deal and dates the first one', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Eben Home')

    const early = Date.UTC(2025, 9, 13)
    const late = Date.UTC(2026, 3, 1)
    await t.run(async (ctx) => {
      for (const [amount, when] of [
        [100_000, early],
        [1_060_000, late],
      ] as const) {
        await ctx.db.insert('deals', {
          orgId: org.orgId,
          investorCompanyId: org.rootCompanyId,
          targetCompanyId: companyId,
          instrumentKind: 'spv_share',
          committedAmount: amount,
          signedDate: when,
          status: 'active',
          currency: 'EUR',
        })
      }
    })

    const [card] = await t.query(internal.reportNotify.entityCards, {
      refs: [{ companyId, orgId: org.orgId }],
      userId: ben.userId,
    })
    expect(card.committedCents).toBe(1_160_000)
    expect(card.firstInvestmentAt).toBe(early)
  })
})

describe('broadcastTargets — everyone but the forwarder', () => {
  async function setup(): Promise<{
    t: Harness
    orgId: Id<'organizations'>
    ben: Id<'users'>
    clement: Id<'users'>
  }> {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const clement = await createUser(t, 'clement@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: clement.userId, role: 'member' },
    ])
    return { t, orgId: org.orgId, ben: ben.userId, clement: clement.userId }
  }

  test('the forwarder is excluded — they already got their thread reply', async () => {
    const { t, orgId, ben, clement } = await setup()
    const targets = await t.query(internal.reportNotify.broadcastTargets, {
      orgIds: [orgId],
      excludeUserId: ben,
    })
    expect(targets.map((x) => x.userId)).toEqual([clement])
  })

  test('someone who turned new-report mails off is not in the list', async () => {
    const { t, orgId, ben, clement } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert('userPrefs', { userId: clement, notifyReportAdded: false })
    })
    const targets = await t.query(internal.reportNotify.broadcastTargets, {
      orgIds: [orgId],
      excludeUserId: ben,
    })
    expect(targets).toEqual([])
  })
})

describe('report-issue recipients — the list can never be emptied', () => {
  test('the last subscriber cannot be unticked, the one before them can', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const clement = await createUser(t, 'clement@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: clement.userId, role: 'member' },
    ])

    const asBen = ben.as

    // Two subscribers: dropping one is fine.
    await asBen.mutation(api.organizations.setMemberAlertPref, {
      orgId: org.orgId,
      userId: clement.userId,
      kind: 'reportIssues',
      enabled: false,
    })

    // Ben is now alone on duty: he cannot take himself off.
    await expectConvexError(
      asBen.mutation(api.organizations.setMemberAlertPref, {
        orgId: org.orgId,
        userId: ben.userId,
        kind: 'reportIssues',
        enabled: false,
      }),
      'last_report_recipient',
    )

    const recipients = await asBen.query(api.organizations.listReportIssueRecipients, {
      orgId: org.orgId,
    })
    expect(recipients.map((r) => r.userId)).toEqual([ben.userId])
  })

  test('the guard does not fire on the other alert kinds', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const asBen = ben.as

    // Sole member turning off the org announcement: nothing depends on it
    // being non-empty, so it goes through.
    await asBen.mutation(api.organizations.setMemberAlertPref, {
      orgId: org.orgId,
      userId: ben.userId,
      kind: 'reportAdded',
      enabled: false,
    })
    const prefs = await asBen.query(api.organizations.listAlertPrefs, { orgId: org.orgId })
    expect(prefs[0].prefs.reportAdded).toBe(false)
    expect(prefs[0].prefs.reportIssues).toBe(true)
  })
})
