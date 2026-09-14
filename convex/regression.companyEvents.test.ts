/// <reference types="vite/client" />
/**
 * Regression: the company activity journal (`companyEvents`), deal families.
 *
 * - One event per mutation call, folded by priority (conversion > status >
 *   fields); a patch that changes nothing writes nothing.
 * - The status/exit gesture carries its proceeds; the clear fields show
 *   before → after, the rest is only counted.
 * - Pointing a transaction logs the match, and the pending → active
 *   promotion it triggers, under the same hand.
 * - A write confirmed through the agent is the user's, flagged `viaAgent`.
 * - The journal is read by org members only, and leaves with its deal.
 * - The backfill is idempotent.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { diffDealPatch } from './lib/companyEvents'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Doc } from './_generated/dataModel'

async function orgSetup(slug = 'org-events') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  const target = await createPortfolioCompany(t, org.orgId, 'Target')
  const dealId = await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'share',
    committedAmount: 100_000,
  })
  return { t, user, org, target, dealId }
}

const baseDeal = {
  _id: 'd' as Doc<'deals'>['_id'],
  _creationTime: 0,
  orgId: 'o' as Doc<'deals'>['orgId'],
  investorCompanyId: 'i' as Doc<'deals'>['investorCompanyId'],
  targetCompanyId: 'c' as Doc<'deals'>['targetCompanyId'],
  instrumentKind: 'share',
  currency: 'EUR',
  status: 'active',
  committedAmount: 100_000,
} as Doc<'deals'>

describe('diffDealPatch: one event per call', () => {
  test('a patch equal to the row is no event', () => {
    expect(diffDealPatch(baseDeal, { committedAmount: 100_000 })).toBeNull()
    expect(diffDealPatch(baseDeal, { exitProceeds: null })).toBeNull()
  })

  test('the exit gesture is one status event carrying the proceeds', () => {
    expect(
      diffDealPatch(baseDeal, {
        status: 'fully_exited',
        exitedDate: 1,
        exitProceeds: 180_000,
      }),
    ).toEqual({
      kind: 'status_changed',
      from: 'active',
      to: 'fully_exited',
      proceedsCents: 180_000,
    })
  })

  test('a conversion wins over the fields patched with it', () => {
    expect(
      diffDealPatch(baseDeal, {
        instrumentKind: 'safe',
        valuationCap: 1,
        committedAmount: 200_000,
      }),
    ).toEqual({ kind: 'converted', from: 'share', to: 'safe' })
  })

  test('clear fields are spelled out, the others counted', () => {
    expect(
      diffDealPatch(baseDeal, {
        committedAmount: 150_000,
        notes: 'x',
        signedDate: 5,
        manuallyEditedFields: ['notes'],
      }),
    ).toEqual({
      kind: 'fields_changed',
      changes: [{ field: 'committedAmount', from: 100_000, to: 150_000 }],
      otherCount: 2,
    })
  })
})

describe('companyEvents: journal written by the deal mutations', () => {
  test('create, then edit, then no-op edit', async () => {
    const { t, user, target, dealId } = await orgSetup()

    await user.as.mutation(api.deals.update, {
      id: dealId,
      patch: { committedAmount: 150_000, notes: 'hello' },
    })
    await user.as.mutation(api.deals.update, {
      id: dealId,
      patch: { committedAmount: 150_000 },
    })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event.kind)).toEqual(['fields_changed', 'created'])
    expect(rows[0].actor).toEqual({
      kind: 'user',
      name: 'org-events@test.dev',
      viaAgent: false,
    })
    expect(rows[0].event).toEqual({
      kind: 'fields_changed',
      changes: [{ field: 'committedAmount', from: 100_000, to: 150_000 }],
      otherCount: 1,
    })
    expect(rows[0].deal?._id).toBe(dealId)
    void t
  })

  test('pointing logs the match and the pending → active promotion', async () => {
    const { t, user, org, target } = await orgSetup('org-pointing')
    const dealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: target,
      instrumentKind: 'share',
      status: 'pending',
    })
    const account = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 50_000_00,
    })
    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    await user.as.mutation(api.transactions.unmatchTransaction, {
      transactionId: txId,
    })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    const ofDeal = rows.filter((r) => r.deal?._id === dealId)
    expect(ofDeal.map((r) => r.event.kind)).toEqual([
      'transaction_unmatched',
      'status_changed',
      'transaction_matched',
      'created',
    ])
    expect(ofDeal[2].event).toEqual({
      kind: 'transaction_matched',
      amountCents: 50_000_00,
      direction: 'out',
    })
    expect(ofDeal[1].event).toMatchObject({ from: 'pending', to: 'active' })
  })

  test("an agent write is the user's, flagged viaAgent", async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-agent')
    await t.mutation(internal.agentTools.updateDealInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      dealId,
      status: 'written_off',
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows[0].actor).toMatchObject({ kind: 'user', viaAgent: true })
    expect(rows[0].event).toEqual({
      kind: 'status_changed',
      from: 'active',
      to: 'written_off',
    })
  })

  test('a deal document logs its attach AND its removal', async () => {
    const { t, user, target, dealId } = await orgSetup('org-docs')
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      dealId,
      title: 'Pacte signé',
      kind: 'pacte',
      storageId,
    })
    await user.as.mutation(api.documents.remove, { documentId })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.slice(0, 2).map((r) => r.event)).toEqual([
      { kind: 'document_removed', title: 'Pacte signé' },
      { kind: 'document_attached', title: 'Pacte signé' },
    ])
  })

  test('the journal is org-scoped and leaves with its deal', async () => {
    const { t, user, target, dealId } = await orgSetup('org-scope')
    const stranger = await createUser(t, 'stranger@test.dev')
    await expectConvexError(
      stranger.as.query(api.companyEvents.listByCompany, { companyId: target }),
      'not_a_member',
    )

    await user.as.mutation(api.deals.remove, { id: dealId })
    const left = await t.run(async (ctx) =>
      ctx.db
        .query('companyEvents')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect(),
    )
    expect(left).toHaveLength(0)
  })

  test('the backfill skips what the Airtable import copied in bulk', async () => {
    const { t, user, org, target } = await orgSetup('org-backfill-import')
    await t.run(async (ctx) => {
      await ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'active',
        airtableId: 'recIMPORTED',
      })
      await ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'pending',
        attioDealId: 'attio-1',
      })
      // Drop the live events so only the backfill speaks.
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })
    await t.mutation(internal.migrations.backfillCompanyEvents.apply, {
      source: 'deals',
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    // The manual deal (unknown author) and the Attio one; never the import.
    expect(rows.map((r) => r.actor)).toEqual(
      expect.arrayContaining([
        { kind: 'unknown' },
        { kind: 'system', source: 'attio' },
      ]),
    )
    expect(rows).toHaveLength(2)
  })

  test('the backfill reconstructs a creation once, never twice', async () => {
    const { t, user, target, dealId } = await orgSetup('org-backfill')
    // Simulate a deal that predates the journal: drop its live event.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('companyEvents')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })

    const first = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      {
        source: 'deals',
      },
    )
    const second = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'deals' },
    )
    expect(first.written).toBe(1)
    expect(second.written).toBe(0)

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor: { kind: 'unknown' },
      event: { kind: 'created' },
    })
  })
})
