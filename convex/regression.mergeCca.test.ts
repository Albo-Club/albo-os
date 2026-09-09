/// <reference types="vite/client" />
/**
 * Regression: `migrations/mergeGroupCcaDeals`.
 *
 * The script runs ONCE against prod and DELETES a deal, so its invariants are
 * worth pinning: the surviving line ends up with every transaction and no
 * stale `paidAmount`, a pair holding anything else than transactions is
 * REFUSED rather than orphaned, the append-only `matchingDecisions` is left
 * alone, and a second run finds nothing to do.
 */
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import {
  createBankAccount,
  createGroupEntity,
  createOrg,
  createTransaction,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

/**
 * Addressed by path, not through `internal.*`: `_generated/api.d.ts` only
 * learns about a new module when a Convex deployment regenerates it, and that
 * file is never edited by hand (CLAUDE.md § Anti-patterns).
 */
type ApplyResult = {
  merged: Array<{
    label: string
    transactionsMoved: number
    paidAmountCleared: number | null
    signedDateSetTo: number | null
  }>
  refused: Array<string>
}

type InspectResult = {
  merges: Array<{
    label: string
    done: boolean
    transactionsToMove: number
    blockers: Record<string, number>
    matchingDecisionsKept: number
    signedDateChangesTo: number | null
    paidAmountToClear: number | null
  }>
  blocked: Array<string>
}

const applyRef = makeFunctionReference<
  'mutation',
  Record<string, never>,
  ApplyResult
>('migrations/mergeGroupCcaDeals:apply')

const inspectRef = makeFunctionReference<
  'query',
  Record<string, never>,
  InspectResult
>('migrations/mergeGroupCcaDeals:inspect')

const DAY = 24 * 60 * 60 * 1000
const OLD = Date.parse('2021-05-03T00:00:00.000Z')
const RECENT = OLD + 400 * DAY

/**
 * `calte` with its four targets. Each gets two `cca` lines: a "big" one with
 * two transactions and a "small" one with a single, older transaction —
 * the shape prod ended up in after the requalification.
 */
async function calteSetup() {
  const t = setupHarness()
  const owner = await createUser(t, 'owner@test.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: owner.userId, role: 'owner' },
  ])
  const account = await createBankAccount(t, calte)

  const targets = new Map<string, { big: Id<'deals'>; small: Id<'deals'> }>()
  for (const name of ['Caltimo', 'SCI Chapelle', 'SCI Upload', 'RDB']) {
    const companyId = await createGroupEntity(t, calte.orgId, name)
    const deal = async (paidAmount: number, signedDate: number) =>
      await t.run(async (ctx) =>
        ctx.db.insert('deals', {
          orgId: calte.orgId,
          investorCompanyId: calte.rootCompanyId,
          targetCompanyId: companyId,
          instrumentKind: 'cca',
          currency: 'EUR',
          paidAmount,
          signedDate,
          status: 'active',
        }),
      )
    // The survivor is the one with the most transactions — here `big`, even
    // though `small` carries the older date.
    const big = await deal(50_000_00, RECENT)
    const small = await deal(10_000_00, OLD)
    for (const target of [big, big, small]) {
      const txId = await createTransaction(t, calte.orgId, account, {
        direction: 'out',
        amount: 1_000_00,
      })
      await t.run(async (ctx) =>
        ctx.db.patch('transactions', txId, {
          dealId: target,
          matchStatus: 'matched',
        }),
      )
    }
    targets.set(name, { big, small })
  }
  return { t, calte, targets, account, owner }
}

const dealsOf = (t: Harness, orgId: Id<'organizations'>) =>
  t.run(async (ctx) =>
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
  )

describe('mergeGroupCcaDeals: apply', () => {
  test('leaves one line per target, holding every transaction', async () => {
    const { t, calte, targets } = await calteSetup()

    const { merged, refused } = await t.mutation(applyRef, {})
    expect(refused).toEqual([])
    expect(merged.map((m) => m.label).sort()).toEqual([
      'Caltimo',
      'RDB',
      'SCI Chapelle',
      'SCI Upload',
    ])
    expect(merged.every((m) => m.transactionsMoved === 1)).toBe(true)

    const deals = await dealsOf(t, calte.orgId)
    expect(deals).toHaveLength(4)

    const { big, small } = targets.get('Caltimo')!
    const survivor = deals.find((d) => d._id === big)!
    expect(deals.some((d) => d._id === small)).toBe(false)
    // The stale Airtable snapshot is gone, not recomputed.
    expect(survivor.paidAmount).toBeUndefined()
    // …and the line now covers the whole history of the advance.
    expect(survivor.signedDate).toBe(OLD)

    await t.run(async (ctx) => {
      const moved = await ctx.db
        .query('transactions')
        .withIndex('by_deal', (q) => q.eq('dealId', big))
        .collect()
      expect(moved).toHaveLength(3)
      const orphans = await ctx.db
        .query('transactions')
        .withIndex('by_deal', (q) => q.eq('dealId', small))
        .collect()
      expect(orphans).toHaveLength(0)
    })
  })

  test('refuses a pair whose absorbed line is referenced elsewhere', async () => {
    const { t, calte, targets } = await calteSetup()
    const { small } = targets.get('SCI Chapelle')!
    await t.run(async (ctx) => {
      await ctx.db.insert('valuations', {
        orgId: calte.orgId,
        dealId: small,
        asOf: RECENT,
        fairValue: 1,
      })
    })

    const report = await t.query(inspectRef, {})
    expect(report.blocked).toEqual(['SCI Chapelle'])

    const { merged, refused } = await t.mutation(applyRef, {})
    expect(refused).toHaveLength(1)
    expect(refused[0]).toContain('SCI Chapelle')
    // The other three are unaffected by the refusal.
    expect(merged.map((m) => m.label).sort()).toEqual([
      'Caltimo',
      'RDB',
      'SCI Upload',
    ])

    const deals = await dealsOf(t, calte.orgId)
    expect(deals.some((d) => d._id === small)).toBe(true)
  })

  test('never rewrites the append-only matching decisions', async () => {
    const { t, calte, targets, owner, account } = await calteSetup()
    const { small } = targets.get('SCI Upload')!
    const decisionId = await t.run(async (ctx) => {
      const txId = await ctx.db
        .query('transactions')
        .withIndex('by_deal', (q) => q.eq('dealId', small))
        .first()
      return await ctx.db.insert('matchingDecisions', {
        orgId: calte.orgId,
        transactionId: txId!._id,
        decision: 'matched',
        dealId: small,
        source: 'manual',
        decidedBy: owner.userId,
        decidedAt: RECENT,
        txLabel: 'SCI UPLOAD',
        txAmount: 1_000_00,
        txDate: RECENT,
        txBankAccountId: account,
      })
    })

    const report = await t.query(inspectRef, {})
    expect(
      report.merges.find((m) => m.label === 'SCI Upload')
        ?.matchingDecisionsKept,
    ).toBe(1)

    await t.mutation(applyRef, {})

    // The decision survives the merge, still pointing at what was decided.
    await t.run(async (ctx) => {
      const decision = await ctx.db.get('matchingDecisions', decisionId)
      expect(decision?.dealId).toBe(small)
    })
  })

  test('is idempotent — a second run finds nothing to do', async () => {
    const { t, calte } = await calteSetup()
    await t.mutation(applyRef, {})

    const second = await t.mutation(applyRef, {})
    expect(second.merged).toEqual([])
    expect(second.refused).toEqual([])

    const report = await t.query(inspectRef, {})
    expect(report.merges.every((m) => m.done)).toBe(true)
    expect(await dealsOf(t, calte.orgId)).toHaveLength(4)
  })
})
