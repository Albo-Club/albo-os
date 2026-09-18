/// <reference types="vite/client" />
/**
 * Regression: the deal READ exposed to the agent and to the MCP connector.
 *
 * `getDealInternal` hands back the whole row — every instrument column — and
 * the ownership share resolved the way the company sheet does (SPEC D33): a
 * group subsidiary's own cap table wins over the stake recorded on the deal,
 * which wins over the share-count ratio. `listLiabilitiesInternal` is the
 * other side of the same fact: the cap table must carry its `ownershipBps`.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { dealTools } from './agentTools'
import { mcpTools } from './mcp/registry'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'dealread@test.dev')
  const org = await createOrg(t, 'org-dealread', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

describe('getDeal', () => {
  test('is registered on both facades, read-only over MCP', () => {
    expect(dealTools.getDeal).toBeDefined()
    const tool = mcpTools.find((row) => row.name === 'getDeal')
    expect(tool).toBeDefined()
    expect(tool?.annotations.readOnlyHint).toBe(true)
  })

  test('returns every instrument field, the names, and the stake recorded on the deal', async () => {
    const { t, user, org } = await orgSetup()
    const target = await createPortfolioCompany(t, org.orgId, 'Sezame')
    const dealId = await t.run(async (ctx) =>
      ctx.db.insert('deals', {
        orgId: org.orgId,
        name: 'Sezame seed',
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        committedAmount: 5_000_000,
        sharesAcquired: 1_250,
        pricePerShare: 4_000,
        roundType: 'seed',
        preMoneyValuation: 800_000_000,
        postMoneyValuation: 900_000_000,
        ownershipPct: 550,
        status: 'active',
        airtableId: 'rec123:share',
        manuallyEditedFields: ['ownershipPct'],
      }),
    )

    const deal = await t.query(internal.agentTools.getDealInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      dealId,
    })
    expect(deal.name).toBe('Sezame seed')
    expect(deal.investor).toBe('org-dealread-root')
    expect(deal.target).toBe('Sezame')
    expect(deal.viaSpv).toBeNull()
    expect(deal.sharesAcquired).toBe(1_250)
    expect(deal.pricePerShare).toBe(4_000)
    expect(deal.roundType).toBe('seed')
    expect(deal.preMoneyValuation).toBe(800_000_000)
    expect(deal.postMoneyValuation).toBe(900_000_000)
    expect(deal.ownership).toEqual({ bps: 550, source: 'deal' })
    // Technical columns stay out.
    expect(deal).not.toHaveProperty('airtableId')
    expect(deal).not.toHaveProperty('manuallyEditedFields')
    expect(deal).not.toHaveProperty('orgId')

    const listed = await t.query(internal.agentTools.listDealsInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
    })
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('Sezame seed')
    expect(listed[0].ownershipPct).toBe(550)
  })

  test('falls back to the share-count ratio when no stake is recorded', async () => {
    const { t, user, org } = await orgSetup()
    const target = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: org.orgId,
        name: 'Ratio Co',
        kind: 'portfolio',
        totalShares: 10_000,
      }),
    )
    const dealId = await t.run(async (ctx) =>
      ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        sharesAcquired: 1_250,
        status: 'active',
      }),
    )
    const deal = await t.query(internal.agentTools.getDealInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      dealId,
    })
    expect(deal.ownership).toEqual({ bps: 1250, source: 'share_ratio' })
  })

  test("on a group subsidiary, the subsidiary's cap table wins over the deal", async () => {
    const { t, user } = await orgSetup()
    const calte = await createOrg(t, 'org-calte-dealread', [
      { userId: user.userId, role: 'owner' },
    ])
    const sci = await createOrg(t, 'org-sci-dealread', [
      { userId: user.userId, role: 'owner' },
    ])
    await t.run(async (ctx) => {
      await ctx.db.patch('companies', sci.rootCompanyId, {
        siren: '123456789',
      })
    })
    const lineInCalte = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: calte.orgId,
        name: 'SCI Chapelle',
        kind: 'group_entity',
        siren: '123456789',
      }),
    )
    await user.as.mutation(api.liabilities.createEquityPosition, {
      orgId: sci.orgId,
      holderOrgId: calte.orgId,
      type: 'capital_social',
      amountCents: 6_000_00,
      ownershipBps: 6000,
      effectiveDate: utc(2019, 3, 12),
    })
    // A stale stake on the deal must NOT be the answer.
    const dealId = await t.run(async (ctx) =>
      ctx.db.insert('deals', {
        orgId: calte.orgId,
        investorCompanyId: calte.rootCompanyId,
        targetCompanyId: lineInCalte,
        instrumentKind: 'share',
        currency: 'EUR',
        ownershipPct: 5000,
        status: 'active',
      }),
    )

    const deal = await t.query(internal.agentTools.getDealInternal, {
      orgId: calte.orgId,
      actorUserId: user.userId,
      dealId,
    })
    expect(deal.ownership).toEqual({
      bps: 6000,
      source: 'cap_table',
      issuingOrgSlug: 'org-sci-dealread',
      effectiveDate: utc(2019, 3, 12),
    })

    // The issuer's side: the cap table carries the share and the holder org.
    const liabilities = await t.query(
      internal.agentToolsLiabilities.listLiabilitiesInternal,
      { orgId: sci.orgId, actorUserId: user.userId },
    )
    expect(liabilities.equityPositions).toHaveLength(1)
    expect(liabilities.equityPositions[0].ownershipBps).toBe(6000)
    expect(liabilities.equityPositions[0].holderOrgSlug).toBe(
      'org-calte-dealread',
    )
  })

  test('a deal of another org is not readable from here', async () => {
    const { t, user, org } = await orgSetup()
    const other = await createOrg(t, 'org-other-dealread', [
      { userId: user.userId, role: 'owner' },
    ])
    const target = await createPortfolioCompany(t, other.orgId, 'Elsewhere')
    const dealId = await t.run(async (ctx) =>
      ctx.db.insert('deals', {
        orgId: other.orgId,
        investorCompanyId: other.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'active',
      }),
    )
    await expectConvexError(
      t.query(internal.agentTools.getDealInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        dealId,
      }),
      'not_found',
    )
  })
})
