/// <reference types="vite/client" />
/**
 * Regression: « silent company » detection (convex/lib/reportFreshness.ts).
 *
 * One rule, three surfaces (the participations badge, the To do tab and the
 * agent tool), so the invariants are pinned here once:
 * - silence is measured on the RECEPTION date of the last report, never on
 *   the period it covers;
 * - a company that never reported is measured from its first disbursement —
 *   funds wired last week owe nothing yet;
 * - the threshold follows the org's `reportSilenceMonths`;
 * - an exited or archived position never nags.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

const MONTH = 30 * 24 * 60 * 60 * 1000

async function orgSetup(slug = 'org-silence') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  return { t, user, org }
}

async function createDeal(
  t: Harness,
  orgId: Id<'organizations'>,
  investorCompanyId: Id<'companies'>,
  targetCompanyId: Id<'companies'>,
  status: 'active' | 'fully_exited',
  signedDate: number,
): Promise<Id<'deals'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('deals', {
      orgId,
      investorCompanyId,
      targetCompanyId,
      instrumentKind: 'share',
      status,
      currency: 'EUR',
      signedDate,
    }),
  )
}

async function createReport(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  opts: { emailDate: number; periodSortDate?: number },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('companyReports', {
      orgId,
      companyId,
      source: 'email',
      status: 'completed',
      emailDate: opts.emailDate,
      periodSortDate: opts.periodSortDate,
    })
  })
}

/** The silent companies of an org, read through the To do tab query. */
async function silentNames(
  user: Awaited<ReturnType<typeof createUser>>,
  orgId: Id<'organizations'>,
): Promise<Array<string>> {
  const todo = await user.as.query(api.todo.getTodo, { orgId })
  return todo.missingReports.map((row) => row.companyName)
}

describe('report freshness: silent companies', () => {
  test('flags a company past the threshold, not one that just reported', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const silent = await createPortfolioCompany(t, org.orgId, 'Silent')
    const fresh = await createPortfolioCompany(t, org.orgId, 'Fresh')
    for (const companyId of [silent, fresh]) {
      await createDeal(
        t,
        org.orgId,
        org.rootCompanyId,
        companyId,
        'active',
        now - 12 * MONTH,
      )
    }
    await createReport(t, org.orgId, silent, { emailDate: now - 5 * MONTH })
    await createReport(t, org.orgId, fresh, { emailDate: now - 1 * MONTH })

    expect(await silentNames(user, org.orgId)).toEqual(['Silent'])
  })

  test('measures reception, not the period covered', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const company = await createPortfolioCompany(t, org.orgId, 'Quarterly')
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      company,
      'active',
      now - 12 * MONTH,
    )
    // Received last month, but only covering a period six months back.
    await createReport(t, org.orgId, company, {
      emailDate: now - 1 * MONTH,
      periodSortDate: now - 6 * MONTH,
    })

    expect(await silentNames(user, org.orgId)).toEqual([])
  })

  test('counts a never-reporting company from its first disbursement', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const old = await createPortfolioCompany(t, org.orgId, 'Wired long ago')
    const recent = await createPortfolioCompany(t, org.orgId, 'Just wired')
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      old,
      'active',
      now - 9 * MONTH,
    )
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      recent,
      'active',
      now - 1 * MONTH,
    )

    expect(await silentNames(user, org.orgId)).toEqual(['Wired long ago'])
  })

  test('the reconciled disbursement wins over the signature date', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const company = await createPortfolioCompany(t, org.orgId, 'Signed early')
    const dealId = await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      company,
      'active',
      now - 12 * MONTH,
    )
    // Signed a year ago, but the money only left the account last month.
    const bankAccountId = await createBankAccount(t, org)
    await t.run(async (ctx) => {
      await ctx.db.insert('transactions', {
        orgId: org.orgId,
        bankAccountId,
        dealId,
        direction: 'out',
        amount: 100_000,
        transactionDate: now - 1 * MONTH,
        rawLabel: 'wire',
        source: 'manual',
        matchStatus: 'matched',
        reconciled: true,
      })
    })

    expect(await silentNames(user, org.orgId)).toEqual([])
  })

  test('follows the org threshold', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const company = await createPortfolioCompany(t, org.orgId, 'Half-yearly')
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      company,
      'active',
      now - 12 * MONTH,
    )
    await createReport(t, org.orgId, company, { emailDate: now - 5 * MONTH })

    expect(await silentNames(user, org.orgId)).toEqual(['Half-yearly'])

    await user.as.mutation(api.organizations.updateGeneral, {
      orgId: org.orgId,
      name: 'org-silence',
      reportSilenceMonths: 6,
    })
    expect(await silentNames(user, org.orgId)).toEqual([])
  })

  test('ignores exited and archived positions', async () => {
    const { t, user, org } = await orgSetup()
    const now = Date.now()
    const exited = await createPortfolioCompany(t, org.orgId, 'Exited')
    const archived = await createPortfolioCompany(t, org.orgId, 'Archived')
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      exited,
      'fully_exited',
      now - 12 * MONTH,
    )
    await createDeal(
      t,
      org.orgId,
      org.rootCompanyId,
      archived,
      'active',
      now - 12 * MONTH,
    )
    await t.run(async (ctx) => {
      await ctx.db.patch('companies', archived, { archivedAt: now - MONTH })
    })

    expect(await silentNames(user, org.orgId)).toEqual([])
  })
})
