/// <reference types="vite/client" />
/**
 * Regression: cash flow forecast (convex/forecasts.ts).
 *
 * - `expandRules` is idempotent (upsert keyed on `derivedKey`): a second run
 *   creates nothing and leaves the same entries.
 * - `getForecastGrid` returns a coherent month axis (history … current …
 *   horizon) and the starting balance of the org's available EUR accounts.
 * - `markEntryRealized` attaches a same-org transaction (`close` mode) or
 *   splits the entry (`keepRemainder`), and refuses a cross-org transaction.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function forecastSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'forecast@test.dev')
  const org = await createOrg(t, 'org-forecast', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

describe('expandRules', () => {
  test('is idempotent: the second run creates nothing and changes nothing', async () => {
    const { t, user, org } = await forecastSetup()
    await user.as.mutation(api.forecasts.createRule, {
      orgId: org.orgId,
      label: 'Loyer SCI',
      amountCents: 250_000,
      direction: 'in',
      frequency: 'monthly',
      anchorDay: 5,
      startDate: Date.now(),
    })

    const first = await user.as.mutation(api.forecasts.expandRules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(first.created).toBeGreaterThan(0)

    const entriesAfterFirst = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )

    const second = await user.as.mutation(api.forecasts.expandRules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(second.created).toBe(0)
    // Unprotected entries are resynced in place, never duplicated.
    expect(second.updated).toBe(first.created)

    const entriesAfterSecond = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(entriesAfterSecond).toHaveLength(entriesAfterFirst.length)
    expect(new Set(entriesAfterSecond.map((e) => e.derivedKey)).size).toBe(
      entriesAfterSecond.length,
    )
  })

  test('never rewrites a realized entry (protected)', async () => {
    const { t, user, org } = await forecastSetup()
    await user.as.mutation(api.forecasts.createRule, {
      orgId: org.orgId,
      label: 'Loyer SCI',
      amountCents: 250_000,
      direction: 'in',
      frequency: 'monthly',
      anchorDay: 5,
      startDate: Date.now(),
    })
    await user.as.mutation(api.forecasts.expandRules, {
      orgId: org.orgId,
      horizonMonths: 3,
    })

    // Realize the first derived entry against a real transaction.
    const entry = (await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    ))[0]
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'in',
      amount: 250_000,
    })
    await user.as.mutation(api.forecasts.markEntryRealized, {
      entryId: entry._id,
      transactionId: txId,
    })

    // Change the rule amount and re-expand: the realized entry keeps its
    // amount, its siblings resync.
    const rule = (await t.run(async (ctx) =>
      ctx.db.query('forecastRules').collect(),
    ))[0]
    await user.as.mutation(api.forecasts.updateRule, {
      ruleId: rule._id,
      patch: { amountCents: 999_999 },
    })
    const result = await user.as.mutation(api.forecasts.expandRules, {
      orgId: org.orgId,
      horizonMonths: 3,
    })
    expect(result.skippedProtected).toBeGreaterThan(0)

    const realized = await t.run(async (ctx) =>
      ctx.db.get('forecastEntries', entry._id),
    )
    expect(realized).toMatchObject({
      status: 'realized',
      amountCents: 250_000,
      realizedTransactionId: txId,
    })
  })
})

describe('getForecastGrid', () => {
  test('returns a coherent month axis and the EUR starting balance', async () => {
    const { user, org, t } = await forecastSetup()
    await createBankAccount(t, org, { currentBalance: 5_000_000 })
    await user.as.mutation(api.forecasts.createRule, {
      orgId: org.orgId,
      label: 'Salaires',
      amountCents: 300_000,
      direction: 'out',
      frequency: 'monthly',
      anchorDay: 28,
      startDate: Date.now(),
    })
    await user.as.mutation(api.forecasts.expandRules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })

    const grid = await user.as.query(api.forecasts.getForecastGrid, {
      orgId: org.orgId,
      historyMonths: 3,
      horizonMonths: 6,
    })

    // Axis: 3 history months + the current month + 6 horizon months.
    expect(grid.months).toHaveLength(3 + 1 + 6)
    expect(grid.months).toContain(grid.currentMonthKey)
    // Months are unique and sorted ascending (YYYY-MM keys sort lexically).
    expect(new Set(grid.months).size).toBe(grid.months.length)
    expect([...grid.months].sort()).toEqual(grid.months)

    expect(grid.startingBalanceCents).toBe(5_000_000)
    // The expanded rule feeds at least one out-row with pending flows.
    const outRow = grid.rows.find(
      (row) =>
        row.direction === 'out' &&
        row.totals.committedCents + row.totals.plannedCents > 0,
    )
    expect(outRow).toBeDefined()
  })
})

describe('markEntryRealized', () => {
  async function pendingEntrySetup() {
    const { t, user, org } = await forecastSetup()
    const entryId = await t.run(async (ctx) =>
      ctx.db.insert('forecastEntries', {
        orgId: org.orgId,
        date: Date.now(),
        amountCents: 100_000,
        direction: 'out',
        confidence: 'confirmed',
        status: 'pending',
        label: 'One-shot',
        overridden: false,
        currency: 'EUR',
      }),
    )
    const accountId = await createBankAccount(t, org)
    return { t, user, org, entryId, accountId }
  }

  test('close mode realizes the entry against the transaction', async () => {
    const { t, user, org, entryId, accountId } = await pendingEntrySetup()
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 100_000,
    })

    await user.as.mutation(api.forecasts.markEntryRealized, {
      entryId,
      transactionId: txId,
    })

    const entry = await t.run(async (ctx) =>
      ctx.db.get('forecastEntries', entryId),
    )
    expect(entry).toMatchObject({
      status: 'realized',
      realizedTransactionId: txId,
      amountCents: 100_000,
    })
    // The transaction itself is never touched (pointage stays the owner
    // of matchStatus / reconciled).
    const tx = await t.run(async (ctx) => ctx.db.get('transactions', txId))
    expect(tx).toMatchObject({ matchStatus: 'unmatched', reconciled: false })
  })

  test('keepRemainder splits the entry on a partial payment', async () => {
    const { t, user, org, entryId, accountId } = await pendingEntrySetup()
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 40_000,
    })

    await user.as.mutation(api.forecasts.markEntryRealized, {
      entryId,
      transactionId: txId,
      mode: 'keepRemainder',
    })

    const entries = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(entries).toHaveLength(2)
    const realized = entries.find((e) => e._id === entryId)
    expect(realized).toMatchObject({
      status: 'realized',
      amountCents: 40_000,
      realizedTransactionId: txId,
    })
    const remainder = entries.find((e) => e._id !== entryId)
    expect(remainder).toMatchObject({
      status: 'pending',
      amountCents: 60_000,
      direction: 'out',
    })
    // Pure one-shot: expandRules must never touch the remainder.
    expect(remainder?.ruleId).toBeUndefined()
    expect(remainder?.derivedKey).toBeUndefined()
  })

  test('a transaction from another org is refused', async () => {
    const { t, user, entryId } = await pendingEntrySetup()
    const otherOrg = await createOrg(t, 'org-other', [
      { userId: user.userId, role: 'owner' },
    ])
    const otherAccount = await createBankAccount(t, otherOrg)
    const otherTx = await createTransaction(t, otherOrg.orgId, otherAccount, {
      direction: 'out',
      amount: 100_000,
    })

    await expectConvexError(
      user.as.mutation(api.forecasts.markEntryRealized, {
        entryId,
        transactionId: otherTx,
      }),
      'transaction_wrong_org',
    )
  })
})
