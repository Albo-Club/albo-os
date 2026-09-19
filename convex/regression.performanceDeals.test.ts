/// <reference types="vite/client" />
/**
 * Regression: compensation deals (`lead_spv`) stay OUT of the performance
 * figures.
 *
 * Such a deal tracks what the org earns running an SPV for other investors
 * (fees + carried), not capital it put at risk. Counting it as an investment
 * inflated deployed and distributed with money that was never invested nor
 * returned, gave it a MOIC/IRR of its own, and — because participation rows
 * group by TARGET company — merged the management fees into the investment's
 * row, polluting its TVPI.
 *
 * The scenario below is the production Hectarea case in miniature: one SPV
 * investment and one lead-SPV compensation deal on the SAME target.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness, TestOrg } from './regression.setup'
import type { Id } from './_generated/dataModel'

const INVESTED = 15_000_000 // 150 000 € wired into the SPV
const FEES_OUT = 1_068_000 // 10 680 € of management costs advanced
const FEES_IN = 1_525_000 // 15 250 € of management revenue collected

/** A transaction already matched to `dealId` (the human pointage, done). */
async function matchedTransaction(
  t: Harness,
  org: TestOrg,
  bankAccountId: Id<'bankAccounts'>,
  dealId: Id<'deals'>,
  direction: 'in' | 'out',
  amount: number,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('transactions', {
      orgId: org.orgId,
      bankAccountId,
      dealId,
      direction,
      amount,
      transactionDate: Date.UTC(2026, 4, 1),
      rawLabel: 'test transaction',
      source: 'manual',
      matchStatus: 'matched',
      reconciled: true,
    })
  })
}

async function compensationSetup(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const target = await createPortfolioCompany(t, org.orgId, 'Hectarea')
  const account = await createBankAccount(t, org)

  const invest = await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'spv_share',
    committedAmount: INVESTED,
  })
  const compensation = await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'lead_spv',
  })

  await matchedTransaction(t, org, account, invest, 'out', INVESTED)
  await matchedTransaction(t, org, account, compensation, 'out', FEES_OUT)
  await matchedTransaction(t, org, account, compensation, 'in', FEES_IN)

  return { user, org, target, invest, compensation }
}

describe('lead_spv is not an investment', () => {
  test('participation rows carry the investment alone', async () => {
    const t = setupHarness()
    const { user, org } = await compensationSetup(t)

    const { rows } = await user.as.query(api.deals.listParticipations, {
      orgId: org.orgId,
    })

    // One row for the target, built from the SPV investment only: the fees
    // neither add to what was invested nor count as a distribution.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Hectarea')
    expect(rows[0]?.dealCount).toBe(1)
    expect(rows[0]?.invested).toBe(INVESTED)
    expect(rows[0]?.received).toBe(0)
    expect(rows[0]?.instrumentKinds).toEqual(['spv_share'])
  })

  test('the cross-org view leaves it out too', async () => {
    const t = setupHarness()
    const { user } = await compensationSetup(t)

    const rows = await user.as.query(api.aggregate.listParticipations, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]?.invested).toBe(INVESTED)
    expect(rows[0]?.received).toBe(0)
  })

  test('the org summary excludes it from deployed, distributed and NAV', async () => {
    const t = setupHarness()
    const { user, org } = await compensationSetup(t)

    const summary = await t.query(
      internal.agentTools.getDashboardSummaryInternal,
      { orgId: org.orgId, actorUserId: user.userId },
    )

    expect(summary.deployedCents).toBe(INVESTED)
    expect(summary.distributedCents).toBe(0)
    // NAV falls back to cost for an active deal without a valuation — the
    // compensation deal must not add its advanced fees on top.
    expect(summary.navCents).toBe(INVESTED)
    expect(summary.participationsCount).toBe(1)
    // The deal COUNTS stay factual: both deals exist.
    expect(summary.totalDealsCount).toBe(2)
  })

  test('it keeps its flows but carries no MOIC and no IRR', async () => {
    const t = setupHarness()
    const { user, org, compensation, invest } = await compensationSetup(t)

    const deals = await user.as.query(api.deals.list, { orgId: org.orgId })
    const byId = new Map(deals.map((d) => [d._id, d]))

    // Still listed (the company sheet and the export read this query), with
    // its real movements — only the ratios are withheld.
    const row = byId.get(compensation)
    expect(row?.paidActual).toBe(FEES_OUT)
    expect(row?.received).toBe(FEES_IN)
    expect(row?.moic).toBeNull()
    expect(row?.irr).toBeNull()

    // The investment keeps its own metrics untouched.
    expect(byId.get(invest)?.paidActual).toBe(INVESTED)
    expect(byId.get(invest)?.moic).toBe(0)
  })
})
