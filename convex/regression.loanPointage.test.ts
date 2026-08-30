/// <reference types="vite/client" />
/**
 * Regression: branching bank debt into the existing rails — matching,
 * forecast, « To do ».
 *
 * Lot 3's success criterion, verbatim from the SPEC: « un prélèvement pointé
 * fait bouger la colonne Réel de l'échéancier, et les 6 prochaines échéances
 * apparaissent dans le prévisionnel. »
 *
 * The invariant that must NOT break while doing it: **matching stays 100 %
 * human**. Nothing here proposes, ranks or pre-selects a transaction. The
 * per-instalment actual is a CALENDAR attribution of an already-matched
 * outflow — the human decided the transaction belongs to the loan, the app
 * only places the consequence on the right line.
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

const DAY = 24 * 60 * 60 * 1000

/** A loan whose instalments straddle « now », so both halves are testable. */
function terms(now: number) {
  const start = new Date(now)
  return {
    label: 'Prêt Palatine 2021',
    lenderName: 'Banque Palatine',
    principalCents: 500_000_00,
    signedDate: now - 400 * DAY,
    // First instalment a year ago, on the 5th.
    firstPaymentDate: Date.UTC(start.getUTCFullYear() - 1, 0, 5),
    durationMonths: 240,
    amortizationKind: 'constant_annuity' as const,
    rateBps: 185,
    rateKind: 'fixed' as const,
    paymentFrequency: 'monthly' as const,
  }
}

async function setup() {
  const t = setupHarness()
  const user = await createUser(t, 'branchement@test.dev')
  const org = await createOrg(t, 'org-branchement', [
    { userId: user.userId, role: 'owner' },
  ])
  const account = await createBankAccount(t, org)
  const now = Date.now()
  const loanId = await user.as.mutation(api.loans.create, {
    orgId: org.orgId,
    ...terms(now),
  })
  return { t, user, org, account, loanId, now }
}

describe('matching a direct debit to a bank loan', () => {
  test('a matched outflow moves the Réel column of its instalment', async () => {
    const { t, user, org, account, loanId } = await setup()
    const before = await user.as.query(api.loans.getById, { loanId })
    expect(before.schedule.every((row) => row.actualCents === null)).toBe(true)

    // A debit dated on the instalment day itself.
    const instalment = before.schedule.find((row) => row.date < Date.now())!
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
      transactionDate: instalment.date,
      rawLabel: 'PRLV PALATINE PRET 8842190',
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })

    const after = await user.as.query(api.loans.getById, { loanId })
    const touched = after.schedule.filter((row) => row.actualCents !== null)
    expect(touched).toHaveLength(1)
    expect(touched[0].date).toBe(instalment.date)
    expect(touched[0].actualCents).toBe(2_536_00)
    // The plan is untouched — the actual is a control, not a source (§ 5.1).
    expect(touched[0].paymentCents).toBe(instalment.paymentCents)
    expect(after.paidCents).toBe(2_536_00)
    expect(after.transactions).toHaveLength(1)
  })

  test('a payment lands on the period it falls in, late ones included', async () => {
    const { t, user, org, account, loanId } = await setup()
    const sheet = await user.as.query(api.loans.getById, { loanId })
    const past = sheet.schedule.filter((row) => row.date < Date.now())
    const target = past[past.length - 3]
    const next = past[past.length - 2]

    // Paid three days LATE — still inside its own instalment period.
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 1_000_00,
      transactionDate: target.date + 3 * DAY,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })

    const after = await user.as.query(api.loans.getById, { loanId })
    const onTarget = after.schedule.find((row) => row.date === target.date)
    const onNext = after.schedule.find((row) => row.date === next.date)
    expect(onTarget?.actualCents).toBe(1_000_00)
    expect(onNext?.actualCents).toBeNull()
  })

  test('detaching puts the Réel column back to nothing', async () => {
    const { t, user, org, account, loanId } = await setup()
    const sheet = await user.as.query(api.loans.getById, { loanId })
    const instalment = sheet.schedule.find((row) => row.date < Date.now())!
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
      transactionDate: instalment.date,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })
    await user.as.mutation(api.liabilities.deallocateTransaction, {
      transactionId: txId,
    })
    const after = await user.as.query(api.loans.getById, { loanId })
    expect(after.schedule.every((row) => row.actualCents === null)).toBe(true)
    expect(after.transactions).toHaveLength(0)
  })

  test('a loan of another org cannot be a matching target', async () => {
    const { t, user, org, account } = await setup()
    const otherOrg = await createOrg(t, 'org-ailleurs', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreignLoan = await user.as.mutation(api.loans.create, {
      orgId: otherOrg.orgId,
      ...terms(Date.now()),
    })
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 1_00,
    })
    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: txId,
        kind: 'loan',
        targetId: foreignLoan,
      }),
      'bank_loan_wrong_org',
    )
  })

  test('a loan with matched transactions cannot be deleted', async () => {
    const { t, user, org, account, loanId } = await setup()
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })
    await expectConvexError(
      user.as.mutation(api.loans.remove, { loanId }),
      'has_allocations',
    )
  })

  test('the matched transaction leaves the queue without becoming a deal', async () => {
    const { t, user, org, account, loanId } = await setup()
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })
    const tx = await t.run(async (ctx) => ctx.db.get('transactions', txId))
    expect(tx?.matchStatus).toBe('matched')
    // `matched` is ambiguous by design: discriminate on dealId / allocation,
    // never assume « matched ⟹ deal » (KNOWN_ISSUES « Pointage »).
    expect(tx?.dealId).toBeUndefined()
    expect(tx?.allocation).toEqual({ kind: 'loan', targetId: loanId })
    // `reconciled` is the DEAL mirror only — a loan allocation never sets it.
    expect(tx?.reconciled).toBe(false)
  })
})

describe('loan instalments in the cash forecast', () => {
  test('the next instalments appear as pending outflows', async () => {
    const { t, user, org, loanId } = await setup()
    const result = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(result.loansProcessed).toBe(1)
    expect(result.created).toBeGreaterThanOrEqual(6)

    const entries = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(entries.length).toBe(result.created)
    for (const entry of entries) {
      expect(entry.direction).toBe('out')
      expect(entry.status).toBe('pending')
      expect(entry.loanId).toBe(loanId)
      expect(entry.category).toBe('debt')
      expect(entry.derivedKey?.startsWith(`loan:${loanId}:`)).toBe(true)
      // Only the future: a past instalment is a bank movement, and its place
      // is the matching queue.
      expect(entry.date).toBeGreaterThanOrEqual(Date.now() - DAY)
    }
  })

  test('re-running it duplicates nothing (idempotent by derivedKey)', async () => {
    const { t, user, org } = await setup()
    const first = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    const second = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(second.created).toBe(0)
    expect(second.updated).toBe(first.created)
    const entries = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(entries.length).toBe(first.created)
  })

  test('an instalment edited by hand is never rewritten', async () => {
    const { t, user, org } = await setup()
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    const entry = await t.run(async (ctx) => {
      const rows = await ctx.db.query('forecastEntries').collect()
      await ctx.db.patch('forecastEntries', rows[0]._id, {
        amountCents: 9_999_00,
        overridden: true,
      })
      return rows[0]._id
    })
    const rerun = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(rerun.skippedProtected).toBe(1)
    const after = await t.run(async (ctx) =>
      ctx.db.get('forecastEntries', entry),
    )
    expect(after?.amountCents).toBe(9_999_00)
  })

  test('the projected outflow includes the insurance — what leaves the bank', async () => {
    const { t, user, org } = await setup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...terms(Date.now()),
      label: 'Prêt assuré',
      insuranceMonthlyCents: 42_00,
    })
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 3,
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    const upcoming = sheet.schedule.find((row) => row.date > Date.now())!
    const entry = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('forecastEntries')
        .withIndex('by_loan', (q) => q.eq('loanId', loanId))
        .collect()
      return rows.find((row) => row.date === upcoming.date)
    })
    // The loan sheet keeps plan and insurance apart; the cash projection
    // cares about the actual outflow (§ 5.1).
    expect(entry?.amountCents).toBe(
      upcoming.paymentCents + upcoming.insuranceCents,
    )
  })

  test('an in fine loan puts its balloon in the projection at its date', async () => {
    const { t, user, org } = await setup()
    // First instalment is Jan of last year, so 36 months puts the balloon in
    // December of next year — ahead of today, inside a 24-month horizon.
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...terms(Date.now()),
      label: 'Prêt in fine',
      amortizationKind: 'bullet',
      principalCents: 6_600_000_00,
      durationMonths: 36,
    })
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 24,
    })
    const entries = await t.run(async (ctx) =>
      ctx.db
        .query('forecastEntries')
        .withIndex('by_loan', (q) => q.eq('loanId', loanId))
        .collect(),
    )
    const balloon = entries.find((row) => row.amountCents > 1_000_000_00)
    // Without `amortizationKind`, this capital would be smoothed over the
    // whole term and stay invisible until it landed (SPEC D45).
    expect(balloon).toBeDefined()
    expect(balloon!.amountCents).toBeGreaterThan(6_600_000_00)
  })

  test('correcting a loan drops the instalments it no longer produces', async () => {
    const { t, user, org, loanId } = await setup()
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 24,
    })
    const before = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(before.length).toBeGreaterThan(12)

    // « Corriger » shortens the loan: it now ends before the horizon, so the
    // instalments past the new term must not survive as ghosts (C7).
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'active',
      ...terms(Date.now()),
      durationMonths: 18,
    })
    const rerun = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 24,
    })
    expect(rerun.removedStale).toBeGreaterThan(0)
    const after = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(after.length).toBeLessThan(before.length)
  })

  test('a hand-edited instalment survives the purge', async () => {
    const { t, user, org, loanId } = await setup()
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 24,
    })
    // Protect the LAST future occurrence — the one a shortened term drops.
    const protectedId = await t.run(async (ctx) => {
      const rows = await ctx.db.query('forecastEntries').collect()
      rows.sort((a, b) => b.date - a.date)
      await ctx.db.patch('forecastEntries', rows[0]._id, { overridden: true })
      return rows[0]._id
    })
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'active',
      ...terms(Date.now()),
      durationMonths: 18,
    })
    await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 24,
    })
    const survivor = await t.run(async (ctx) =>
      ctx.db.get('forecastEntries', protectedId),
    )
    // A human decision is never undone by a regeneration.
    expect(survivor).not.toBeNull()
  })

  test('a settled loan projects nothing', async () => {
    const { t, user, org, loanId } = await setup()
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'repaid',
      ...terms(Date.now()),
    })
    const result = await user.as.mutation(api.forecasts.expandLoanSchedules, {
      orgId: org.orgId,
      horizonMonths: 6,
    })
    expect(result.loansProcessed).toBe(0)
    const entries = await t.run(async (ctx) =>
      ctx.db.query('forecastEntries').collect(),
    )
    expect(entries).toHaveLength(0)
  })
})

describe('« To do »: instalments due with nothing matched', () => {
  test('a due instalment with no matched outflow is surfaced', async () => {
    const { user, org } = await setup()
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.overdueInstalmentsCount).toBeGreaterThan(0)
    expect(todo.overdueInstalments[0].label).toBe('Prêt Palatine 2021')
    // Preview only — the exhaustive reading lives on the loan sheet.
    expect(todo.overdueInstalments.length).toBeLessThanOrEqual(5)
  })

  test('matching the debit removes its instalment from the signal', async () => {
    const { t, user, org, account, loanId } = await setup()
    const before = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    const target = before.overdueInstalments[0]

    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
      transactionDate: target.date,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'loan',
      targetId: loanId,
    })

    const after = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(after.overdueInstalmentsCount).toBe(
      before.overdueInstalmentsCount - 1,
    )
    expect(
      after.overdueInstalments.some((row) => row.date === target.date),
    ).toBe(false)
  })

  test('a settled loan raises no signal', async () => {
    const { user, org, loanId } = await setup()
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'repaid',
      ...terms(Date.now()),
    })
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.overdueInstalmentsCount).toBe(0)
  })
})
