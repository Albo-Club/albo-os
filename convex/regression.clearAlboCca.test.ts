/**
 * `migrations/clearAlboCcaPaidAmount` — drops the frozen « versé » snapshot on
 * CALTE's current account with Albo Club, but ONLY when the pointing is ahead
 * of it. The guard is the point of the script: on a deal with no pointed
 * transaction the snapshot is the only figure that exists.
 */
import { describe, expect, test } from 'vitest'
import { anyApi } from 'convex/server'
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

const applyRef = anyApi[
  'migrations/clearAlboCcaPaidAmount'
].apply as unknown as Parameters<Harness['mutation']>[0]
const inspectRef = anyApi[
  'migrations/clearAlboCcaPaidAmount'
].inspect as unknown as Parameters<Harness['query']>[0]

/** `calte` with its Albo Club `cca` line, its snapshot and `pointed` movements. */
async function setup(opts: { paidAmount?: number; pointed: Array<number> }) {
  const t = setupHarness()
  const owner = await createUser(t, 'owner@test.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: owner.userId, role: 'owner' },
  ])
  const account = await createBankAccount(t, calte)
  const companyId = await createGroupEntity(t, calte.orgId, 'ALBO CLUB')

  const dealId: Id<'deals'> = await t.run(async (ctx) =>
    ctx.db.insert('deals', {
      orgId: calte.orgId,
      investorCompanyId: calte.rootCompanyId,
      targetCompanyId: companyId,
      instrumentKind: 'cca',
      currency: 'EUR',
      paidAmount: opts.paidAmount,
      status: 'active',
    }),
  )
  for (const amount of opts.pointed) {
    const txId = await createTransaction(t, calte.orgId, account, {
      direction: 'out',
      amount,
    })
    await t.run(async (ctx) =>
      ctx.db.patch('transactions', txId, { dealId, matchStatus: 'matched' }),
    )
  }
  return { t, dealId }
}

const dealOf = (t: Harness, dealId: Id<'deals'>) =>
  t.run(async (ctx) => ctx.db.get('deals', dealId))

describe('clearAlboCcaPaidAmount', () => {
  test('clears the snapshot when the pointing is ahead of it', async () => {
    const { t, dealId } = await setup({
      paidAmount: 400_000_00,
      pointed: [1_000_000_00, 880_000_00],
    })

    const report = await t.query(inspectRef, {})
    expect(report.done).toBe(false)
    expect(report.paidAmountToClear).toBe(400_000_00)
    expect(report.paidActual).toBe(1_880_000_00)

    const { cleared } = await t.mutation(applyRef, {})
    expect(cleared).toBe(400_000_00)
    expect((await dealOf(t, dealId))?.paidAmount).toBeUndefined()
  })

  test('keeps the snapshot when nothing is pointed — it is the only figure', async () => {
    const { t, dealId } = await setup({ paidAmount: 260_954_00, pointed: [] })

    const report = await t.query(inspectRef, {})
    expect(report.done).toBe(true)
    expect(report.paidAmountToClear).toBeNull()

    const { cleared } = await t.mutation(applyRef, {})
    expect(cleared).toBeNull()
    expect((await dealOf(t, dealId))?.paidAmount).toBe(260_954_00)
  })

  test('keeps the snapshot when it is merely ahead of the pointing', async () => {
    const { t, dealId } = await setup({
      paidAmount: 1_125_047_00,
      pointed: [66_570_00],
    })

    expect((await t.query(inspectRef, {})).done).toBe(true)
    await t.mutation(applyRef, {})
    expect((await dealOf(t, dealId))?.paidAmount).toBe(1_125_047_00)
  })

  test('is idempotent — a second run finds nothing to do', async () => {
    const { t } = await setup({
      paidAmount: 400_000_00,
      pointed: [1_880_000_00],
    })
    await t.mutation(applyRef, {})

    const second = await t.mutation(applyRef, {})
    expect(second.cleared).toBeNull()
    expect((await t.query(inspectRef, {})).done).toBe(true)
  })
})
