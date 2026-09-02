/// <reference types="vite/client" />
/**
 * Regression: what a report mail is allowed to show, and who it reaches
 * (ALB-115). The routing decision itself is pure and pinned in
 * `tests/reportRouting.test.ts`; this file covers what needs the database.
 *
 * Two rules are load-bearing here and each one is easy to undo by accident:
 *
 * 1. The mail carries committed amounts and fiche links, so its entity list is
 *    scoped to the reader's OWN organizations. A member of Albo alone must
 *    never receive the Calte line of a company that exists on both sides — the
 *    app itself refuses to show it to them.
 *
 * 2. The report-issue recipient list can never be emptied. The notice a
 *    forwarder gets on failure says the team has been told; with nobody
 *    subscribed that sentence is a lie AND the failure reaches no one.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

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

  test('the fiche line sums what actually went out, not what was committed', async () => {
    // 275 of CALTE's 280 deals carry no `committedAmount` — keying this line
    // on the commitment left it blank on nearly every report. It reads the
    // reconciled bank movements instead, the app's own "Versé".
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Batch Venture')
    const account = await createBankAccount(t, org)

    const early = Date.UTC(2025, 9, 13)
    const late = Date.UTC(2026, 3, 1)
    const dealIds = await t.run(async (ctx) => {
      const ids = []
      for (const when of [early, late]) {
        ids.push(
          await ctx.db.insert('deals', {
            orgId: org.orgId,
            investorCompanyId: org.rootCompanyId,
            targetCompanyId: companyId,
            instrumentKind: 'fund_lp',
            // Deliberately absent — this is the CALTE shape.
            signedDate: when,
            status: 'active',
            currency: 'EUR',
          }),
        )
      }
      return ids
    })

    // Two outflows and one inflow: "Versé" counts the outflows only, and a
    // distribution coming back must never be netted off it.
    const txs = [
      { deal: 0, direction: 'out' as const, amount: 34_824_040 },
      { deal: 1, direction: 'out' as const, amount: 1_000_000 },
      { deal: 0, direction: 'in' as const, amount: 752_884 },
    ]
    for (const tx of txs) {
      const id = await createTransaction(t, org.orgId, account, {
        direction: tx.direction,
        amount: tx.amount,
      })
      await t.run(async (ctx) => {
        await ctx.db.patch('transactions', id, { dealId: dealIds[tx.deal] })
      })
    }

    const [card] = await t.query(internal.reportNotify.entityCards, {
      refs: [{ companyId, orgId: org.orgId }],
      userId: ben.userId,
    })
    expect(card.openPaidCents).toBe(35_824_040)
    expect(card.firstInvestmentAt).toBe(early)
  })

  test('the tranches already repaid are stated apart, never as money at work', async () => {
    // ALB-237, seen on Rewatt: eight CCA tranches repaid years ago plus one
    // open share position. Summed, the mail announced 3,47 M€ "Versé" on a
    // company where 49 950 € is actually at work — and it contradicted the
    // participations list, which splits the same company into open / settled
    // tables. A cancelled deal belongs to neither: wired then refunded, it
    // never was a position.
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Rewatt')
    const account = await createBankAccount(t, org)

    const exitedAt = Date.UTC(2023, 3, 24)
    const openedAt = Date.UTC(2024, 4, 1)
    const [exited, open, cancelled] = await t.run(async (ctx) => {
      const ids = []
      for (const deal of [
        { status: 'fully_exited' as const, kind: 'cca' as const, when: exitedAt },
        { status: 'active' as const, kind: 'share' as const, when: openedAt },
        { status: 'cancelled' as const, kind: 'cca' as const, when: openedAt },
      ]) {
        ids.push(
          await ctx.db.insert('deals', {
            orgId: org.orgId,
            investorCompanyId: org.rootCompanyId,
            targetCompanyId: companyId,
            instrumentKind: deal.kind,
            signedDate: deal.when,
            status: deal.status,
            currency: 'EUR',
          }),
        )
      }
      return ids
    })

    const flows = [
      { deal: exited, direction: 'out' as const, amount: 60_000_000 },
      { deal: exited, direction: 'in' as const, amount: 62_240_000 },
      { deal: open, direction: 'out' as const, amount: 4_995_000 },
      // The refunded round trip of the cancelled deal: both movements exist
      // and stay matchable, and neither shows up in the mail.
      { deal: cancelled, direction: 'out' as const, amount: 10_000_000 },
      { deal: cancelled, direction: 'in' as const, amount: 10_000_000 },
    ]
    for (const flow of flows) {
      const id = await createTransaction(t, org.orgId, account, {
        direction: flow.direction,
        amount: flow.amount,
      })
      await t.run(async (ctx) => {
        await ctx.db.patch('transactions', id, { dealId: flow.deal })
      })
    }

    const [card] = await t.query(internal.reportNotify.entityCards, {
      refs: [{ companyId, orgId: org.orgId }],
      userId: ben.userId,
    })
    expect(card.openPaidCents).toBe(4_995_000)
    // Dated on the open deal, not on the tranche repaid a year earlier.
    expect(card.firstInvestmentAt).toBe(openedAt)
    expect(card.settled).toEqual({
      dealCount: 1,
      paidCents: 60_000_000,
      receivedCents: 62_240_000,
    })
  })

  test('a deal with a commitment but no payment shows no figure at all', async () => {
    // Announcing "Versé : 0 €" on a signed-but-unfunded deal would be worse
    // than saying nothing: the line disappears instead.
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'You.switch')
    await t.run(async (ctx) => {
      await ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: companyId,
        instrumentKind: 'os',
        committedAmount: 30_000_000,
        status: 'pending',
        currency: 'EUR',
      })
    })

    const [card] = await t.query(internal.reportNotify.entityCards, {
      refs: [{ companyId, orgId: org.orgId }],
      userId: ben.userId,
    })
    expect(card.openPaidCents).toBeUndefined()
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
