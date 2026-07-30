/// <reference types="vite/client" />
/**
 * Regression: strict multi-tenant isolation + role checks.
 *
 * Invariant under test: no query/mutation reads or writes org data without
 * `requireOrgMember` (CLAUDE.md § Conventions de données). A member of org A
 * must get `not_a_member` on org B's data, and an unauthenticated call must
 * be rejected before touching anything.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function twoOrgsSetup() {
  const t = setupHarness()
  const alice = await createUser(t, 'alice@test.dev')
  const bob = await createUser(t, 'bob@test.dev')
  const orgA = await createOrg(t, 'org-a', [
    { userId: alice.userId, role: 'owner' },
  ])
  const orgB = await createOrg(t, 'org-b', [
    { userId: bob.userId, role: 'owner' },
  ])
  return { t, alice, bob, orgA, orgB }
}

describe('multi-tenant: reads', () => {
  test('a member of org A cannot read org B deals/transactions/forecasts/liabilities', async () => {
    const { alice, orgB } = await twoOrgsSetup()

    await expectConvexError(
      alice.as.query(api.deals.list, { orgId: orgB.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      alice.as.query(api.transactions.listUnmatched, { orgId: orgB.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      alice.as.query(api.forecasts.listRules, { orgId: orgB.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      alice.as.query(api.forecasts.getForecastGrid, {
        orgId: orgB.orgId,
        historyMonths: 1,
        horizonMonths: 6,
      }),
      'not_a_member',
    )
    await expectConvexError(
      alice.as.query(api.liabilities.getLiabilities, { orgId: orgB.orgId }),
      'not_a_member',
    )
  })

  test('document-scoped reads resolve the org from the doc and still reject outsiders', async () => {
    const { t, alice, bob, orgB } = await twoOrgsSetup()
    const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')
    const dealB = await bob.as.mutation(api.deals.create, {
      orgId: orgB.orgId,
      investorCompanyId: orgB.rootCompanyId,
      targetCompanyId: targetB,
      instrumentKind: 'share',
    })

    await expectConvexError(
      alice.as.query(api.deals.getById, { id: dealB }),
      'not_a_member',
    )
  })
})

describe('multi-tenant: writes', () => {
  test('a member of org A cannot create a deal in org B', async () => {
    const { t, alice, orgB } = await twoOrgsSetup()
    const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')

    await expectConvexError(
      alice.as.mutation(api.deals.create, {
        orgId: orgB.orgId,
        investorCompanyId: orgB.rootCompanyId,
        targetCompanyId: targetB,
        instrumentKind: 'share',
      }),
      'not_a_member',
    )
  })

  test('a member of org A cannot update or delete an org B deal', async () => {
    const { t, alice, bob, orgB } = await twoOrgsSetup()
    const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')
    const dealB = await bob.as.mutation(api.deals.create, {
      orgId: orgB.orgId,
      investorCompanyId: orgB.rootCompanyId,
      targetCompanyId: targetB,
      instrumentKind: 'share',
    })

    await expectConvexError(
      alice.as.mutation(api.deals.update, {
        id: dealB,
        patch: { notes: 'intrusion' },
      }),
      'not_a_member',
    )
    await expectConvexError(
      alice.as.mutation(api.deals.remove, { id: dealB }),
      'not_a_member',
    )
  })

  test('a member of org A cannot match an org B transaction', async () => {
    const { t, alice, bob, orgB } = await twoOrgsSetup()
    const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')
    const dealB = await bob.as.mutation(api.deals.create, {
      orgId: orgB.orgId,
      investorCompanyId: orgB.rootCompanyId,
      targetCompanyId: targetB,
      instrumentKind: 'share',
    })
    const accountB = await createBankAccount(t, orgB)
    const txB = await createTransaction(t, orgB.orgId, accountB, {
      direction: 'out',
      amount: 100_000,
    })

    await expectConvexError(
      alice.as.mutation(api.transactions.matchTransaction, {
        transactionId: txB,
        dealId: dealB,
      }),
      'not_a_member',
    )
  })

  test('a member of org A cannot create a forecast rule in org B', async () => {
    const { alice, orgB } = await twoOrgsSetup()

    await expectConvexError(
      alice.as.mutation(api.forecasts.createRule, {
        orgId: orgB.orgId,
        label: 'intrusion',
        amountCents: 100_000,
        direction: 'out',
        frequency: 'monthly',
        anchorDay: 1,
        startDate: Date.now(),
      }),
      'not_a_member',
    )
  })

  test('a member of org A cannot create an equity position in org B', async () => {
    const { alice, orgB } = await twoOrgsSetup()

    await expectConvexError(
      alice.as.mutation(api.liabilities.createEquityPosition, {
        orgId: orgB.orgId,
        type: 'capital_social',
        amountCents: 100_000,
        effectiveDate: Date.now(),
      }),
      'not_a_member',
    )
  })
})

describe('unauthenticated access', () => {
  test('anonymous calls are rejected before touching data', async () => {
    const { t, orgA } = await twoOrgsSetup()

    await expectConvexError(
      t.query(api.deals.list, { orgId: orgA.orgId }),
      'unprovisioned_or_unauthenticated',
    )
    await expectConvexError(
      t.mutation(api.forecasts.createRule, {
        orgId: orgA.orgId,
        label: 'anon',
        amountCents: 100_000,
        direction: 'out',
        frequency: 'monthly',
        anchorDay: 1,
        startDate: Date.now(),
      }),
      'unprovisioned_or_unauthenticated',
    )
    await expectConvexError(
      t.query(api.aggregate.listDeals, {}),
      'unprovisioned_or_unauthenticated',
    )
  })
})

describe('roles', () => {
  test('an admin-gated mutation fails for a plain member and passes for an admin', async () => {
    const t = setupHarness()
    const owner = await createUser(t, 'owner@test.dev')
    const admin = await createUser(t, 'admin@test.dev')
    const member = await createUser(t, 'member@test.dev')
    const org = await createOrg(t, 'org-roles', [
      { userId: owner.userId, role: 'owner' },
      { userId: admin.userId, role: 'admin' },
      { userId: member.userId, role: 'member' },
    ])

    await expectConvexError(
      member.as.mutation(api.organizations.updateGeneral, {
        orgId: org.orgId,
        name: 'Renamed by member',
      }),
      'insufficient_role',
    )

    await admin.as.mutation(api.organizations.updateGeneral, {
      orgId: org.orgId,
      name: 'Renamed by admin',
    })
    const renamed = await t.run(async (ctx) =>
      ctx.db.get('organizations', org.orgId),
    )
    expect(renamed?.name).toBe('Renamed by admin')
  })

  test('promoting to owner is refused to an admin (owner_only)', async () => {
    const t = setupHarness()
    const owner = await createUser(t, 'owner@test.dev')
    const admin = await createUser(t, 'admin@test.dev')
    const member = await createUser(t, 'member@test.dev')
    const org = await createOrg(t, 'org-roles', [
      { userId: owner.userId, role: 'owner' },
      { userId: admin.userId, role: 'admin' },
      { userId: member.userId, role: 'member' },
    ])
    const memberRow = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', org.orgId).eq('userId', member.userId),
        )
        .unique()
      if (!rows) throw new Error('member row missing')
      return rows
    })

    await expectConvexError(
      admin.as.mutation(api.organizations.updateMemberRole, {
        orgId: org.orgId,
        memberId: memberRow._id,
        role: 'owner',
      }),
      'owner_only',
    )
  })
})
