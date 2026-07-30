/// <reference types="vite/client" />
/**
 * Regression: cross-org aggregated view (convex/aggregate.ts).
 *
 * Read-only union of the deals of ALL orgs the user is a member of — the
 * authorization boundary is the memberships: a new membership brings its
 * org's deals in, a non-member never sees them.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness, TestOrg, TestUser } from './regression.setup'
import type { Id } from './_generated/dataModel'

async function createDeal(
  user: TestUser,
  org: TestOrg,
  target: Id<'companies'>,
  committedAmount: number,
) {
  return await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'share',
    committedAmount,
  })
}

async function aggregateSetup(t: Harness) {
  // benjamin is member of both orgs, clement of org B only.
  const benjamin = await createUser(t, 'benjamin@test.dev')
  const clement = await createUser(t, 'clement@test.dev')
  const orgA = await createOrg(t, 'org-a', [
    { userId: benjamin.userId, role: 'owner' },
  ])
  const orgB = await createOrg(t, 'org-b', [
    { userId: benjamin.userId, role: 'owner' },
    { userId: clement.userId, role: 'member' },
  ])
  const targetA = await createPortfolioCompany(t, orgA.orgId, 'Target A')
  const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')
  const dealA = await createDeal(benjamin, orgA, targetA, 100_000)
  const dealB = await createDeal(benjamin, orgB, targetB, 200_000)
  return { benjamin, clement, orgA, orgB, dealA, dealB }
}

describe('aggregate.listDeals', () => {
  test('a member of two orgs sees the union, tagged by org', async () => {
    const t = setupHarness()
    const { benjamin, orgA, orgB, dealA, dealB } = await aggregateSetup(t)

    const deals = await benjamin.as.query(api.aggregate.listDeals, {})
    expect(deals).toHaveLength(2)
    expect(new Set(deals.map((d) => d._id))).toEqual(new Set([dealA, dealB]))

    const byId = new Map(deals.map((d) => [d._id, d]))
    expect(byId.get(dealA)?.org).toMatchObject({
      _id: orgA.orgId,
      slug: 'org-a',
    })
    expect(byId.get(dealB)?.org).toMatchObject({
      _id: orgB.orgId,
      slug: 'org-b',
    })
  })

  test('a member of one org only sees that org — memberships are the boundary', async () => {
    const t = setupHarness()
    const { clement, orgA, dealA, dealB } = await aggregateSetup(t)

    const deals = await clement.as.query(api.aggregate.listDeals, {})
    expect(deals).toHaveLength(1)
    expect(deals[0]._id).toBe(dealB)

    // A new membership brings the other org in automatically (no per-org
    // opt-in: the memberships ARE the authorization boundary).
    await t.run(async (ctx) => {
      await ctx.db.insert('organizationMembers', {
        orgId: orgA.orgId,
        userId: clement.userId,
        role: 'member',
        joinedAt: Date.now(),
      })
    })
    const withNewOrg = await clement.as.query(api.aggregate.listDeals, {})
    expect(new Set(withNewOrg.map((d) => d._id))).toEqual(
      new Set([dealA, dealB]),
    )
  })

  test('listParticipations aggregates one row per company, tagged by org', async () => {
    const t = setupHarness()
    const { benjamin } = await aggregateSetup(t)

    const rows = await benjamin.as.query(api.aggregate.listParticipations, {})
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.name))).toEqual(
      new Set(['Target A', 'Target B']),
    )
    expect(new Set(rows.map((r) => r.org?.slug))).toEqual(
      new Set(['org-a', 'org-b']),
    )
    // Commitments land on the right rows (cents, pre-aggregated server-side).
    const rowA = rows.find((r) => r.name === 'Target A')
    expect(rowA?.committed).toBe(100_000)
  })
})
