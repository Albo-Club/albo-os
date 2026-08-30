/// <reference types="vite/client" />
/**
 * Regression: lot 5 of the Dette & Garanties module — the ownership share
 * and the dated loan amendments.
 *
 * Two invariants are pinned here.
 *
 * 1. **The ownership share lives in ONE place** (SPEC D33): the issuing
 *    company's cap table. The holder's side READS it and never carries a
 *    second copy — two entries would diverge with nothing to say which is
 *    right.
 * 2. **An amendment keeps the history** (SPEC D35). « Corriger » overwrites
 *    the terms, as if the previous ones had never existed; « Mettre à jour
 *    au JJ/MM » leaves the instalments already run untouched and applies the
 *    new terms to what remains. The two gestures must stay distinguishable.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createOrg,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'lot5@test.dev')
  const org = await createOrg(t, 'org-lot5', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

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

describe('ownership: the share lives in one place (D33)', () => {
  test('a cap table line carries its share, and the list gives it back', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.liabilities.createEquityPosition, {
      orgId: org.orgId,
      type: 'capital_social',
      amountCents: 10_000_00,
      ownershipBps: 6000,
      effectiveDate: utc(2019, 3, 12),
    })

    const liabilities = await user.as.query(api.liabilities.getLiabilities, {
      orgId: org.orgId,
    })
    expect(liabilities.equityPositions[0].ownershipBps).toBe(6000)
  })

  test('a share is optional — a share premium carries none', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.liabilities.createEquityPosition, {
      orgId: org.orgId,
      type: 'prime_emission',
      amountCents: 90_000_00,
      effectiveDate: utc(2019, 3, 12),
    })

    const liabilities = await user.as.query(api.liabilities.getLiabilities, {
      orgId: org.orgId,
    })
    // Absent, not zero: 0 % would claim the holder owns nothing.
    expect(liabilities.equityPositions[0].ownershipBps).toBeUndefined()
  })

  test('a share above 100 % or at zero is refused', async () => {
    const { user, org } = await orgSetup()
    for (const ownershipBps of [0, -100, 10_001]) {
      await expectConvexError(
        user.as.mutation(api.liabilities.createEquityPosition, {
          orgId: org.orgId,
          type: 'capital_social',
          amountCents: 10_000_00,
          ownershipBps,
          effectiveDate: utc(2019, 3, 12),
        }),
        'invalid_ownership',
      )
    }
  })

  test("the holder's side READS the issuer's cap table, by SIREN", async () => {
    const { t, user } = await orgSetup()
    // CALTE, and the subsidiary with its own org — the shape
    // `migrations/createSubsidiaryOrgs` produces: the SIREN is cloned onto
    // the new org's root, and the subsidiary also has a line inside CALTE.
    const calte = await createOrg(t, 'org-calte-lot5', [
      { userId: user.userId, role: 'owner' },
    ])
    const sci = await createOrg(t, 'org-sci-lot5', [
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
    // The share is entered ONCE, on the SCI's own cap table.
    await user.as.mutation(api.liabilities.createEquityPosition, {
      orgId: sci.orgId,
      holderOrgId: calte.orgId,
      type: 'capital_social',
      amountCents: 6_000_00,
      ownershipBps: 6000,
      effectiveDate: utc(2019, 3, 12),
    })

    const read = await user.as.query(api.liabilities.getOwnershipForCompany, {
      orgId: calte.orgId,
      companyId: lineInCalte,
    })
    expect(read?.ownershipBps).toBe(6000)
    expect(read?.issuingOrgSlug).toBe('org-sci-lot5')
  })

  test('no SIREN, no match, or no share entered → null, never a made-up 0 %', async () => {
    const { t, user } = await orgSetup()
    const calte = await createOrg(t, 'org-calte-null', [
      { userId: user.userId, role: 'owner' },
    ])
    const noSiren = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: calte.orgId,
        name: 'Sans SIREN',
        kind: 'group_entity',
      }),
    )
    expect(
      await user.as.query(api.liabilities.getOwnershipForCompany, {
        orgId: calte.orgId,
        companyId: noSiren,
      }),
    ).toBeNull()

    const unmatched = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: calte.orgId,
        name: 'Sans org jumelle',
        kind: 'group_entity',
        siren: '999999999',
      }),
    )
    expect(
      await user.as.query(api.liabilities.getOwnershipForCompany, {
        orgId: calte.orgId,
        companyId: unmatched,
      }),
    ).toBeNull()
  })

  test('a company of another org is not readable from here', async () => {
    const { t, user, org } = await orgSetup()
    const other = await createOrg(t, 'org-other-lot5', [
      { userId: user.userId, role: 'owner' },
    ])
    await expectConvexError(
      user.as.query(api.liabilities.getOwnershipForCompany, {
        orgId: org.orgId,
        companyId: other.rootCompanyId,
      }),
      'not_found',
    )
  })
})

describe('amendments: the past never moves (D35)', () => {
  test('the instalments already run are untouched, the rest is recomputed', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const before = await user.as.query(api.loans.getById, { loanId })
    const cut = before.schedule[24].date

    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: cut,
      rateBps: 350,
      notes: 'Renégociation 2023',
    })
    const after = await user.as.query(api.loans.getById, { loanId })

    // Same number of instalments, and the first two years are identical.
    for (let k = 0; k < 24; k++) {
      expect(after.schedule[k].paymentCents).toBe(
        before.schedule[k].paymentCents,
      )
      expect(after.schedule[k].remainingCents).toBe(
        before.schedule[k].remainingCents,
      )
    }
    // From the effective date, the new rate applies.
    expect(after.schedule[23].rateBps).toBe(185)
    expect(after.schedule[24].rateBps).toBe(350)
    expect(after.schedule[24].paymentCents).toBeGreaterThan(
      before.schedule[24].paymentCents,
    )
  })

  test('an amendment shows up on the sheet, most recent first', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: utc(2023, 7, 5),
      rateBps: 350,
    })
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: utc(2025, 7, 5),
      rateBps: 420,
    })

    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.amendments).toHaveLength(2)
    expect(sheet.amendments[0].effectiveDate).toBe(utc(2025, 7, 5))
    expect(sheet.amendments[0].rateBps).toBe(420)
    // An untouched field stays null — it carried over, it did not change.
    expect(sheet.amendments[0].durationMonths).toBeNull()
  })

  test('re-entering the same date REPLACES, never stacks a second truth', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: utc(2023, 7, 5),
      rateBps: 350,
    })
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: utc(2023, 7, 5),
      rateBps: 400,
    })

    const sheet = await user.as.query(api.loans.getById, { loanId })
    expect(sheet.amendments).toHaveLength(1)
    expect(sheet.amendments[0].rateBps).toBe(400)
  })

  test('an amendment before the first instalment is a correction, and is refused', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await expectConvexError(
      user.as.mutation(api.loans.addAmendment, {
        loanId,
        effectiveDate: utc(2021, 5, 1),
        rateBps: 350,
      }),
      'amendment_before_start',
    )
  })

  test('a revolving has no schedule to segment — refused', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      label: 'Crédit lombard',
      lenderName: 'Neuflize',
      principalCents: 6_600_000_00,
      signedDate: utc(2023, 1, 10),
      firstPaymentDate: utc(2023, 2, 10),
      amortizationKind: 'revolving',
      creditLimitCents: 8_000_000_00,
      rateBps: 410,
      rateKind: 'variable',
      paymentFrequency: 'monthly',
    })
    await expectConvexError(
      user.as.mutation(api.loans.addAmendment, {
        loanId,
        effectiveDate: utc(2024, 1, 10),
        rateBps: 380,
      }),
      'revolving_not_amendable',
    )
  })

  test('deleting an amendment puts the original terms back', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const before = await user.as.query(api.loans.getById, { loanId })
    const amendmentId = await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: before.schedule[24].date,
      rateBps: 350,
    })
    await user.as.mutation(api.loans.removeAmendment, { amendmentId })

    const after = await user.as.query(api.loans.getById, { loanId })
    expect(after.amendments).toHaveLength(0)
    expect(after.summary.outstandingCents).toBe(
      before.summary.outstandingCents,
    )
  })

  test('deleting the loan takes its amendments with it', async () => {
    const { t, user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: utc(2023, 7, 5),
      rateBps: 350,
    })
    await user.as.mutation(api.loans.remove, { loanId })

    const left = await t.run(async (ctx) =>
      ctx.db.query('loanAmendments').collect(),
    )
    expect(left).toHaveLength(0)
  })

  test('the To do signal reads the AMENDED schedule, not the original', async () => {
    const { user, org } = await orgSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      ...palatine,
    })
    const before = await user.as.query(api.loans.getById, { loanId })
    const cut = before.schedule[24].date
    await user.as.mutation(api.loans.addAmendment, {
      loanId,
      effectiveDate: cut,
      rateBps: 350,
    })

    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    const sheet = await user.as.query(api.loans.getById, { loanId })
    // The signal must name instalments the sheet actually shows — the two
    // read through the same helper, so an amount here exists there.
    const amounts = new Set(
      sheet.schedule.map((row) => row.paymentCents + row.insuranceCents),
    )
    for (const row of todo.overdueInstalments) {
      expect(amounts.has(row.amountCents)).toBe(true)
    }
  })
})
