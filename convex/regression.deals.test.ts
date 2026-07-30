/// <reference types="vite/client" />
/**
 * Regression: deal creation invariants.
 *
 * - SIREN uniqueness is enforced in the companies mutations (per-org index
 *   `by_org_siren` — Convex has no schema-level unique constraint).
 * - Attio bridge uniqueness (`attioDealId` / `attioCompanyId`) is enforced by
 *   the sync upsert (keyed lookups on `by_attio_deal_id` /
 *   `by_attio_company_id`): re-running the same event never duplicates. The
 *   company anchor is also settable by hand from the identity panel, where
 *   `companies.update` guards it GLOBALLY — the sync reads that index with
 *   `.unique()`, so a duplicate anchor would break it at the next run.
 * - A deal's investor is always a `group_*` entity of the org, never a
 *   portfolio company (`assertInvestorIsGroupEntity`).
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { TERM_SHEET_STATUS_ID } from './lib/attioSync'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function orgSetup(slug = 'org-deals') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  return { t, user, org }
}

describe('deals: creation + investor guard', () => {
  test('creates a deal with EUR/active defaults', async () => {
    const { t, user, org } = await orgSetup()
    const target = await createPortfolioCompany(t, org.orgId, 'Target')

    const dealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: target,
      instrumentKind: 'share',
      committedAmount: 100_000, // 1 000 € in cents
    })

    const deal = await t.run(async (ctx) => ctx.db.get('deals', dealId))
    expect(deal).toMatchObject({
      orgId: org.orgId,
      currency: 'EUR',
      status: 'active',
      committedAmount: 100_000,
    })
  })

  test('the investor must be a group_* entity, never a portfolio company', async () => {
    const { t, user, org } = await orgSetup()
    const target = await createPortfolioCompany(t, org.orgId, 'Target')
    const portfolioInvestor = await createPortfolioCompany(
      t,
      org.orgId,
      'Not an investor',
    )

    await expectConvexError(
      user.as.mutation(api.deals.create, {
        orgId: org.orgId,
        investorCompanyId: portfolioInvestor,
        targetCompanyId: target,
        instrumentKind: 'share',
      }),
      'investor_must_be_group_entity',
    )

    // Same guard on update: re-pointing the investor to a portfolio company
    // is refused too.
    const dealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: target,
      instrumentKind: 'share',
    })
    await expectConvexError(
      user.as.mutation(api.deals.update, {
        id: dealId,
        patch: { investorCompanyId: portfolioInvestor },
      }),
      'investor_must_be_group_entity',
    )
  })

  test('investor and target must belong to the deal org', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'multi@test.dev')
    const orgA = await createOrg(t, 'org-a', [
      { userId: user.userId, role: 'owner' },
    ])
    const orgB = await createOrg(t, 'org-b', [
      { userId: user.userId, role: 'owner' },
    ])
    const targetA = await createPortfolioCompany(t, orgA.orgId, 'Target A')
    const targetB = await createPortfolioCompany(t, orgB.orgId, 'Target B')

    // Investor from another org (even a valid group entity there).
    await expectConvexError(
      user.as.mutation(api.deals.create, {
        orgId: orgA.orgId,
        investorCompanyId: orgB.rootCompanyId,
        targetCompanyId: targetA,
        instrumentKind: 'share',
      }),
      'investor_wrong_org',
    )
    // Target from another org.
    await expectConvexError(
      user.as.mutation(api.deals.create, {
        orgId: orgA.orgId,
        investorCompanyId: orgA.rootCompanyId,
        targetCompanyId: targetB,
        instrumentKind: 'share',
      }),
      'target_wrong_org',
    )
  })
})

describe('companies: SIREN uniqueness (mutation-enforced)', () => {
  test('two companies of the same org cannot share a SIREN', async () => {
    const { user, org } = await orgSetup()

    await user.as.mutation(api.companies.create, {
      orgId: org.orgId,
      name: 'First',
      kind: 'portfolio',
      siren: '123456789',
    })
    await expectConvexError(
      user.as.mutation(api.companies.create, {
        orgId: org.orgId,
        name: 'Second',
        kind: 'portfolio',
        siren: '123456789',
      }),
      'siren_already_used',
    )
  })

  test('update cannot steal a SIREN already used in the org', async () => {
    const { user, org } = await orgSetup()

    await user.as.mutation(api.companies.create, {
      orgId: org.orgId,
      name: 'First',
      kind: 'portfolio',
      siren: '123456789',
    })
    const secondId = await user.as.mutation(api.companies.create, {
      orgId: org.orgId,
      name: 'Second',
      kind: 'portfolio',
    })

    await expectConvexError(
      user.as.mutation(api.companies.update, {
        id: secondId,
        patch: { siren: '123456789' },
      }),
      'siren_already_used',
    )
  })

  test('the uniqueness scope is the org: another org can reuse the SIREN', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'multi@test.dev')
    const orgA = await createOrg(t, 'org-a', [
      { userId: user.userId, role: 'owner' },
    ])
    const orgB = await createOrg(t, 'org-b', [
      { userId: user.userId, role: 'owner' },
    ])

    await user.as.mutation(api.companies.create, {
      orgId: orgA.orgId,
      name: 'In A',
      kind: 'portfolio',
      siren: '123456789',
    })
    // Same SIREN in org B: allowed (per-org index).
    await user.as.mutation(api.companies.create, {
      orgId: orgB.orgId,
      name: 'In B',
      kind: 'portfolio',
      siren: '123456789',
    })
  })
})

describe('Attio bridge: attioDealId / attioCompanyId idempotence', () => {
  const termSheetEvent = {
    attioDealId: 'attio-deal-1',
    stage: TERM_SHEET_STATUS_ID,
    valueCents: 5_000_000,
    // Attio '🌍 Albo' option id (lib/attioSync.ts ORG_OPTION_TO_SLUG → 'albo').
    orgOptionId: '77b86c7e-ced4-4c34-b2e2-3278591ad00f',
    targetCompanyAttioId: 'attio-company-1',
    instrumentRaw: 'Share',
    investmentDate: null,
    name: 'Deal Attio',
  }

  test('replaying the same Attio deal event never duplicates the deal or its company', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'albo@test.dev')
    // The sync resolves the org by slug from the Attio option: must be 'albo'.
    await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])

    const first = await t.mutation(
      internal.attioSync.upsertFromDeal,
      termSheetEvent,
    )
    expect(first).toMatchObject({ action: 'termsheet_created' })

    const second = await t.mutation(
      internal.attioSync.upsertFromDeal,
      termSheetEvent,
    )
    expect(second).toMatchObject({
      action: 'termsheet_updated',
      dealId: (first as { dealId: unknown }).dealId,
    })

    const { deals, companies } = await t.run(async (ctx) => ({
      deals: await ctx.db.query('deals').collect(),
      companies: await ctx.db.query('companies').collect(),
    }))
    expect(deals.filter((d) => d.attioDealId === 'attio-deal-1')).toHaveLength(
      1,
    )
    expect(
      companies.filter((c) => c.attioCompanyId === 'attio-company-1'),
    ).toHaveLength(1)
  })

  test('claiming an Attio company already anchored elsewhere is refused', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'albo@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    // The sync anchors 'attio-company-1' to the deal's target company.
    await t.mutation(internal.attioSync.upsertFromDeal, termSheetEvent)

    const other = await createPortfolioCompany(t, org.orgId, 'Homonyme')
    await expectConvexError(
      user.as.mutation(api.companies.update, {
        id: other,
        patch: { attioCompanyId: 'attio-company-1' },
      }),
      'attio_company_already_used',
    )
  })

  test('the anchor uniqueness is global: another org cannot claim it either', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'albo@test.dev')
    await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const orgB = await createOrg(t, 'org-b', [
      { userId: user.userId, role: 'owner' },
    ])
    await t.mutation(internal.attioSync.upsertFromDeal, termSheetEvent)

    // Unlike the SIREN (per-org index), the Attio anchor is one workspace-wide
    // record: a second org claiming it would make the sync's .unique() throw.
    const inB = await createPortfolioCompany(t, orgB.orgId, 'Même boîte')
    await expectConvexError(
      user.as.mutation(api.companies.update, {
        id: inB,
        patch: { attioCompanyId: 'attio-company-1' },
      }),
      'attio_company_already_used',
    )
  })

  test('unlinking frees the anchor for another company', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'albo@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    await t.mutation(internal.attioSync.upsertFromDeal, termSheetEvent)
    const anchoredId = await t.run(async (ctx) => {
      const rows = await ctx.db.query('companies').collect()
      const anchored = rows.find((c) => c.attioCompanyId === 'attio-company-1')
      if (!anchored) throw new Error('the sync did not anchor the company')
      return anchored._id
    })

    // '' unlinks (the mutation drops the column), so the id is claimable again.
    await user.as.mutation(api.companies.update, {
      id: anchoredId,
      patch: { attioCompanyId: '' },
    })
    const other = await createPortfolioCompany(t, org.orgId, 'La vraie')
    await user.as.mutation(api.companies.update, {
      id: other,
      patch: { attioCompanyId: 'attio-company-1' },
    })

    const anchored = await t.run(async (ctx) =>
      (await ctx.db.query('companies').collect()).filter(
        (c) => c.attioCompanyId === 'attio-company-1',
      ),
    )
    expect(anchored).toHaveLength(1)
    expect(anchored[0]._id).toBe(other)
  })

  test('a second deal on the same Attio company reuses the anchored company', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'albo@test.dev')
    await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])

    await t.mutation(internal.attioSync.upsertFromDeal, termSheetEvent)
    await t.mutation(internal.attioSync.upsertFromDeal, {
      ...termSheetEvent,
      attioDealId: 'attio-deal-2',
      name: 'Deal Attio 2',
    })

    const { deals, anchored } = await t.run(async (ctx) => ({
      deals: await ctx.db.query('deals').collect(),
      anchored: (await ctx.db.query('companies').collect()).filter(
        (c) => c.attioCompanyId === 'attio-company-1',
      ),
    }))
    expect(deals).toHaveLength(2)
    expect(anchored).toHaveLength(1)
    expect(new Set(deals.map((d) => d.targetCompanyId)).size).toBe(1)
  })
})
