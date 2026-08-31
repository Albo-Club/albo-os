/// <reference types="vite/client" />
/**
 * Regression: bank debt — convex/loans.ts.
 *
 * Two invariants are pinned here.
 *
 * 1. NOTHING derivable is stored. There is no capital-outstanding column and
 *    no schedule table: `list` / `getById` rebuild both on every read, so a
 *    correction to the terms moves the outstanding with no migration. The one
 *    assumed exception is the outstanding of a `revolving`.
 * 2. Tenancy: every function goes through `requireOrgMember`, and the loan's
 *    satellites (rate steps, direct-debit account) must live in the same org.
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

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'debt@test.dev')
  const org = await createOrg(t, 'org-debt', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

/** The SPEC's example loan: 500 k€, 240 months, 1,85 % fixed. */
const palatine = {
  label: 'Prêt Palatine 2021',
  lenderName: 'Banque Palatine',
  principalCents: 500_000_00,
  signedDate: utc(2021, 6, 14),
  firstPaymentDate: utc(2021, 7, 5),
  durationMonths: 240,
  amortizationKind: 'constant_annuity' as const,
  rateBps: 185,
  rateKind: 'fixed' as const,
  paymentFrequency: 'monthly' as const,
}

describe('loans: the outstanding is derived, never stored', () => {
  test('a fresh loan exposes a schedule and an outstanding below the principal', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.schedule).toHaveLength(240)
    // Five years in, part of the capital is repaid — and the row itself
    // still only holds the principal.
    expect(sheet.loan.principalCents).toBe(500_000_00)
    expect(sheet.summary.outstandingCents).toBeLessThan(500_000_00)
    expect(sheet.summary.outstandingCents).toBeGreaterThan(0)
  })

  test('correcting the terms moves the outstanding with no migration', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const before = await user.as.query(api.loans.getById, { loanId })
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'active',
      ...palatine,
      principalCents: 250_000_00,
    })
    const after = await user.as.query(api.loans.getById, { loanId })
    expect(after.summary.outstandingCents).toBeLessThan(
      before.summary.outstandingCents,
    )
    expect(after.schedule[0].paymentCents).toBeLessThan(
      before.schedule[0].paymentCents,
    )
  })

  test('a settled loan owes nothing, whatever its schedule says', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await user.as.mutation(api.loans.update, {
      loanId,
      status: 'repaid',
      ...palatine,
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.summary.outstandingCents).toBe(0)
    const listed = await user.as.query(api.loans.list, { orgId: org.orgId })
    expect(listed.totalOutstandingCents).toBe(0)
  })

  test('the list total is the sum of the derived outstandings', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.loans.create, { orgId: org.orgId, ...palatine })
    await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
      label: 'Prêt in fine',
      amortizationKind: 'bullet',
      principalCents: 6_600_000_00,
    })
    const listed = await user.as.query(api.loans.list, { orgId: org.orgId })
    expect(listed.loans).toHaveLength(2)
    expect(listed.totalOutstandingCents).toBe(
      listed.loans.reduce((sum, row) => sum + row.outstandingCents, 0),
    )
    // The in fine owes its whole principal until the very last instalment.
    const bullet = listed.loans.find((row) => row.label === 'Prêt in fine')
    expect(bullet?.outstandingCents).toBe(6_600_000_00)
  })

  test('a revolving stores its outstanding — the module’s one exception', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
      label: 'Crédit lombard 2023',
      amortizationKind: 'revolving',
      durationMonths: undefined,
      principalCents: 6_600_000_00,
      creditLimitCents: 8_000_000_00,
      rateKind: 'variable',
      rateBps: 410,
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.summary.outstandingCents).toBe(6_600_000_00)
    // Drawdown headroom = ceiling − outstanding (SPEC C17).
    expect(sheet.summary.availableCreditCents).toBe(1_400_000_00)
    // Interest-only projection, no capital instalment at all.
    expect(sheet.schedule.length).toBeGreaterThan(0)
    expect(sheet.schedule.every((row) => row.capitalCents === 0)).toBe(true)
  })
})

describe('loans: term validation', () => {
  test('an amortizing loan without a duration is refused', async () => {
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        durationMonths: undefined,
      }),
      'missing_duration',
    )
  })

  test('a deferral covering the whole term is refused', async () => {
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        durationMonths: 24,
        deferralMonths: 24,
        deferralKind: 'partial',
      }),
      'deferral_too_long',
    )
  })

  test('an IN FINE deferral covering the whole term is refused too', async () => {
    // It used to be exempt, and the exemption cost the balloon: the schedule
    // came out with no capital line at all, so the outstanding never fell and
    // the capital never reached the cash projection.
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        amortizationKind: 'bullet',
        durationMonths: 24,
        deferralMonths: 24,
        deferralKind: 'partial',
      }),
      'deferral_too_long',
    )
  })

  test('a revolving ceiling below the outstanding is refused', async () => {
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        amortizationKind: 'revolving',
        durationMonths: undefined,
        principalCents: 8_000_000_00,
        creditLimitCents: 6_600_000_00,
      }),
      'limit_below_outstanding',
    )
  })

  test('a zero or negative principal is refused', async () => {
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        principalCents: 0,
      }),
      'invalid_amount',
    )
  })
})

describe('loans: variable rate series', () => {
  const variable = {
    ...palatine,
    label: 'Prêt révisable',
    rateKind: 'variable' as const,
    durationMonths: 24,
    firstPaymentDate: utc(2026, 1, 5),
    rateBps: 1200,
  }

  test('a rate step changes the instalments that follow it', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...variable,
    })
    const before = await user.as.query(api.loans.getById, { loanId })
    await user.as.mutation(api.loans.addRate, {
      loanId,
      fromDate: utc(2026, 7, 1),
      rateBps: 2400,
      kind: 'actual',
    })
    const after = await user.as.query(api.loans.getById, { loanId })
    expect(after.schedule[0].paymentCents).toBe(before.schedule[0].paymentCents)
    expect(after.schedule[6].rateBps).toBe(2400)
    expect(after.schedule[6].paymentCents).toBeGreaterThan(
      before.schedule[6].paymentCents,
    )
  })

  test('instalments past the last actual revision are flagged projected', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...variable,
    })
    await user.as.mutation(api.loans.addRate, {
      loanId,
      fromDate: utc(2026, 6, 1),
      rateBps: 1000,
      kind: 'actual',
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.schedule[0].projected).toBe(false)
    expect(sheet.schedule[6].projected).toBe(true)
  })

  test('re-entering the same effective date replaces the step, never stacks', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...variable,
    })
    await user.as.mutation(api.loans.addRate, {
      loanId,
      fromDate: utc(2026, 7, 1),
      rateBps: 2400,
      kind: 'actual',
    })
    await user.as.mutation(api.loans.addRate, {
      loanId,
      fromDate: utc(2026, 7, 1),
      rateBps: 1800,
      kind: 'forecast',
    })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.rates).toHaveLength(1)
    expect(sheet.rates[0].rateBps).toBe(1800)
    expect(sheet.rates[0].kind).toBe('forecast')
  })

  test('a fixed-rate loan refuses a rate step', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await expectConvexError(
      user.as.mutation(api.loans.addRate, {
        loanId,
        fromDate: utc(2026, 7, 1),
        rateBps: 240,
        kind: 'actual',
      }),
      'rate_is_fixed',
    )
  })
})

describe('loans: tenancy and deletion guardrails', () => {
  test('a non-member can neither read nor write a loan', async () => {
    const { t, user, org } = await orgSetup()
    const outsider = await createUser(t, 'outsider@test.dev')
    await createOrg(t, 'org-other', [
      { userId: outsider.userId, role: 'owner' },
    ])
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await expectConvexError(
      outsider.as.query(api.loans.getById, { loanId }),
      'not_a_member',
    )
    await expectConvexError(
      outsider.as.query(api.loans.list, { orgId: org.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      outsider.as.mutation(api.loans.update, {
        loanId,
        status: 'cancelled',
        ...palatine,
      }),
      'not_a_member',
    )
  })

  test('the direct-debit account must belong to the borrowing org', async () => {
    const { t, user, org } = await orgSetup()
    const otherOrg = await createOrg(t, 'org-elsewhere', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreignAccount = await createBankAccount(t, otherOrg)
    await expectConvexError(
      user.as.mutation(api.loans.create, {
        orgId: org.orgId,
        ...palatine,
        bankAccountId: foreignAccount,
      }),
      'account_wrong_org',
    )
  })

  test('deleting a loan drops its rate series with it', async () => {
    const { t, user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
      rateKind: 'variable',
    })
    await user.as.mutation(api.loans.addRate, {
      loanId,
      fromDate: utc(2026, 7, 1),
      rateBps: 240,
      kind: 'actual',
    })
    await user.as.mutation(api.loans.remove, { loanId })
    const rates = await t.run(async (ctx) => ctx.db.query('loanRates').collect())
    expect(rates).toHaveLength(0)
  })

  test('deleting a loan is refused while a document hangs off it', async () => {
    const { t, user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['offre de prêt']))
      await ctx.db.insert('documents', {
        orgId: org.orgId,
        loanId,
        title: 'Offre de prêt.pdf',
        kind: 'acte_pret',
        storageId,
        source: 'upload',
        uploadedAt: Date.now(),
      })
    })
    await expectConvexError(
      user.as.mutation(api.loans.remove, { loanId }),
      'has_documents',
    )
  })

  test('deleting a loan is refused while a transaction is matched to it', async () => {
    const { t, user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const account = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_536_00,
    })
    // Matching to a loan is the next lot; the guardrail is already in place,
    // so the allocation is written directly here.
    await t.run(async (ctx) => {
      await ctx.db.patch('transactions', txId, {
        allocation: { kind: 'intercompany_loan', targetId: loanId },
      })
    })
    await expectConvexError(
      user.as.mutation(api.loans.remove, { loanId }),
      'has_allocations',
    )
  })

  test('listOptions offers active loans only, and reads no transaction', async () => {
    const { user, org } = await orgSetup()
    const activeId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const settledId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
      label: 'Prêt soldé',
    })
    await user.as.mutation(api.loans.update, {
      loanId: settledId,
      status: 'repaid',
      ...palatine,
      label: 'Prêt soldé',
    })
    const options = await user.as.query(api.loans.listOptions, {
      orgId: org.orgId,
    })
    expect(options.map((option) => option._id)).toEqual([activeId])
  })
})
