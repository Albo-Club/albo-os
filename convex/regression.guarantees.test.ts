/// <reference types="vite/client" />
/**
 * Regression: guarantees — convex/guarantees.ts.
 *
 * The two things this table exists to make true:
 *
 * 1. **One row, three readings** (SPEC D13). The very same guarantee is read
 *    from the loan, from the pledged asset and from the guarantor. Nothing
 *    is stored twice, so nothing can diverge — and the reading crosses orgs,
 *    which is the whole point of the Concerto Capi case (lot 2's success
 *    criterion: the contract shows its three pledges and its margin from
 *    `calte`, while two of the three beneficiaries live elsewhere).
 * 2. **Authorization is `requireGuaranteeParty`**, not `requireOrgMember`: a
 *    guarantee legitimately spans two orgs. Membership of ONE party is
 *    enough, and membership of none is refused — orgs stay flat.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

import type { Id } from './_generated/dataModel'
import type { Harness, TestOrg } from './regression.setup'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

const loanTerms = {
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

/** A deal usable as a pledged placement, with a valuation. */
async function createPlacement(
  t: Harness,
  org: TestOrg,
  name: string,
  fairValue: number,
): Promise<Id<'deals'>> {
  const targetCompanyId = await createPortfolioCompany(t, org.orgId, name)
  return await t.run(async (ctx) => {
    const dealId = await ctx.db.insert('deals', {
      orgId: org.orgId,
      name,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId,
      instrumentKind: 'capitalization_account',
      currency: 'EUR',
      status: 'active',
    })
    await ctx.db.insert('valuations', {
      orgId: org.orgId,
      dealId,
      asOf: utc(2026, 3, 1),
      fairValue,
    })
    return dealId
  })
}

/**
 * The SPEC's own hardest case: Concerto Capi n°060 lives in `calte` and
 * secures three different borrowers — CALTE itself, SCI Chapelle, and an
 * outside company (SARL Bremontier, D-QA).
 */
async function concertoSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'garanties@test.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: user.userId, role: 'owner' },
  ])
  const sci = await createOrg(t, 'sci-chapelle', [
    { userId: user.userId, role: 'owner' },
  ])
  const concertoId = await createPlacement(
    t,
    calte,
    'Concerto Capi n°060',
    1_400_000_00,
  )

  const calteLoan = await user.as.mutation(api.loans.create, {
    orgId: calte.orgId,
    label: 'Prêt CALTE 2022',
    ...loanTerms,
    principalCents: 395_000_00,
  })
  const sciLoan = await user.as.mutation(api.loans.create, {
    orgId: sci.orgId,
    label: 'Prêt SCI Chapelle 2021',
    ...loanTerms,
  })

  // (a) CALTE's own loan, pledged 300 K€.
  await user.as.mutation(api.guarantees.create, {
    orgId: calte.orgId,
    loanId: calteLoan,
    pledgorOrgId: calte.orgId,
    subjectKind: 'placement',
    subjectDealId: concertoId,
    form: 'nantissement',
    rank: 1,
    pledgedAmountCents: 300_000_00,
    actDate: utc(2022, 1, 10),
  })
  // (b) The SCI's loan — the asset is in ANOTHER org (D13).
  await user.as.mutation(api.guarantees.create, {
    orgId: sci.orgId,
    loanId: sciLoan,
    pledgorOrgId: calte.orgId,
    subjectKind: 'placement',
    subjectDealId: concertoId,
    form: 'nantissement',
    rank: 2,
    pledgedAmountCents: 150_000_00,
    actDate: utc(2021, 6, 14),
  })
  // (c) An outside borrower, with no loan of ours at all (D-QA).
  await user.as.mutation(api.guarantees.create, {
    orgId: calte.orgId,
    borrowerLabel: 'SARL Bremontier',
    pledgorOrgId: calte.orgId,
    subjectKind: 'placement',
    subjectDealId: concertoId,
    form: 'nantissement',
    pledgedAmountCents: 500_000_00,
  })

  return { t, user, calte, sci, concertoId, calteLoan, sciLoan }
}

describe('guarantees: what the neighbouring surfaces read', () => {
  test('the debt list carries the FORMS of a loan’s securities, never amounts', async () => {
    const { user, calte, calteLoan } = await concertoSetup()
    // A second, weaker security on the same loan, plus one already released.
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorLabel: 'Clément Alteresco',
      subjectKind: 'external',
      subjectLabel: 'Caution personnelle',
      form: 'caution',
    })
    const releasedId = await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorOrgId: calte.orgId,
      subjectKind: 'shares',
      subjectCompanyId: calte.rootCompanyId,
      form: 'hypotheque',
    })
    await user.as.mutation(api.guarantees.setReleased, {
      guaranteeId: releasedId,
      releasedAt: Date.now(),
    })

    const { loans } = await user.as.query(api.loans.list, {
      orgId: calte.orgId,
    })
    const row = loans.find((loan) => loan._id === calteLoan)!
    // Strongest first, deduplicated, and the released one is gone: it no
    // longer bites, so badging it would overstate what covers the loan.
    expect(row.guaranteeForms).toEqual(['nantissement', 'caution'])
    // D44: the list carries ONE nature of figure, the outstanding. No
    // pledged amount travels with it.
    expect(JSON.stringify(row)).not.toContain('pledged')
  })

  test('a property’s securities carry the outstanding of the loan they cover', async () => {
    const { t, user, sci, sciLoan } = await concertoSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: sci.orgId,
      name: '18 rue de la Chapelle',
      address: 'Paris 18e',
      propertyType: 'immeuble',
      usage: 'locatif_nu',
      costBasis: [],
    })
    await user.as.mutation(api.guarantees.create, {
      orgId: sci.orgId,
      loanId: sciLoan,
      pledgorOrgId: sci.orgId,
      subjectKind: 'property',
      subjectPropertyId: propertyId,
      form: 'ppd',
      pledgedAmountCents: 400_000_00,
    })

    const view = await user.as.query(api.guarantees.listBySubjectProperty, {
      propertyId,
    })
    const row = view.guarantees[0]
    expect(row.loanLabel).toBe('Prêt SCI Chapelle 2021')
    // Derived from the schedule, never stored — and it is the DEBT's figure,
    // not the pledge's: 500 K€ borrowed, so what is left is under that and
    // above zero, while the pledge stays at its deed value of 400 K€.
    expect(row.loanOutstandingCents).toBeGreaterThan(0)
    expect(row.loanOutstandingCents).toBeLessThan(500_000_00)
    expect(row.loanOutstandingCents).not.toBe(row.pledgedAmountCents)
    expect(row.loanLastPaymentDate).not.toBeNull()

    // A settled loan owes nothing, exactly as in the debt list.
    await t.run(async (ctx) => {
      await ctx.db.patch('loans', sciLoan, { status: 'repaid' })
    })
    const after = await user.as.query(api.guarantees.listBySubjectProperty, {
      propertyId,
    })
    expect(after.guarantees[0].loanOutstandingCents).toBe(0)
  })
})

describe('guarantees: one row, three readings (D13)', () => {
  test('the asset shows its three pledges and its margin, across orgs', async () => {
    const { user, concertoId } = await concertoSetup()
    const view = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    expect(view.guarantees).toHaveLength(3)
    // 300 + 150 + 500 = 950 K€ pledged on a 1,4 M€ contract.
    expect(view.summary.pledgedTotalCents).toBe(950_000_00)
    expect(view.summary.currentValueCents).toBe(1_400_000_00)
    expect(view.summary.availableMarginCents).toBe(450_000_00)
  })

  test('dropping the outside borrower would overstate the margin (D-QA)', async () => {
    const { user, concertoId } = await concertoSetup()
    const view = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    const outside = view.guarantees.find(
      (row) => row.borrowerName === 'SARL Bremontier',
    )
    expect(outside).toBeDefined()
    expect(outside?.pledgedAmountCents).toBe(500_000_00)
    // Without that row the margin would read 950 000 € instead of 450 000 €.
    expect(
      view.summary.currentValueCents! -
        (view.summary.pledgedTotalCents - 500_000_00),
    ).toBe(950_000_00)
  })

  test('the borrowing loan sees the WHOLE asset, not just its own pledge', async () => {
    const { user, sciLoan } = await concertoSetup()
    const rows = await user.as.query(api.guarantees.listByLoan, {
      loanId: sciLoan,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].pledgedAmountCents).toBe(150_000_00)
    // The margin is the asset's, all borrowers included — otherwise this
    // loan's own pledge would look like the only one on the contract.
    expect(rows[0].assetSummary.pledgedTotalCents).toBe(950_000_00)
    expect(rows[0].assetSummary.availableMarginCents).toBe(450_000_00)
    // And the asset is read from another org.
    expect(rows[0].subject.label).toBe('Concerto Capi n°060')
  })

  test('the guarantor reads what it committed for someone else', async () => {
    const { user, calte } = await concertoSetup()
    const rows = await user.as.query(api.guarantees.listByPledgorOrg, {
      orgId: calte.orgId,
    })
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.borrowerName).sort()).toEqual([
      'SARL Bremontier',
      'calte',
      'sci-chapelle',
    ])
  })

  test('the guarantor comes back as an id, not only as a slug', async () => {
    const { user, calte, sciLoan } = await concertoSetup()
    // The SCI's loan sheet is where this guarantee is edited from, and its
    // guarantor is CALTE. The edit dialog preselects the guarantor from this
    // id: with only the slug, saving from the SCI's page would move the
    // guarantee onto the SCI.
    const [onLoan] = await user.as.query(api.guarantees.listByLoan, {
      loanId: sciLoan,
    })
    expect(onLoan.pledgorOrgSlug).toBe('calte')
    expect(onLoan.pledgorOrgId).toBe(calte.orgId)

    // Same on the guarantor's own Passif, the other surface that edits.
    const given = await user.as.query(api.guarantees.listByPledgorOrg, {
      orgId: calte.orgId,
    })
    expect(given.map((row) => row.pledgorOrgId)).toEqual([
      calte.orgId,
      calte.orgId,
      calte.orgId,
    ])
  })

  test('a third party’s security on the same outside debt hangs under ours', async () => {
    const { user, calte, concertoId } = await concertoSetup()
    // SPEC § 10 line 10b: 250 K€ on M. Peninque's AV Vibrato, standing on
    // the SAME Bremontier debt as our own 500 K€. No party of ours at all —
    // only CALTE's filing anchors it.
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      borrowerLabel: 'SARL Bremontier',
      pledgorLabel: 'M. Peninque',
      subjectKind: 'external',
      subjectLabel: 'AV Vibrato — M. Peninque',
      form: 'nantissement',
      pledgedAmountCents: 250_000_00,
    })

    const rows = await user.as.query(api.guarantees.listByPledgorOrg, {
      orgId: calte.orgId,
    })
    // Still THREE top-level rows: the co-security is not a fourth pledge of
    // ours, it is context on the one we gave for Bremontier.
    expect(rows).toHaveLength(3)
    const bremontier = rows.find(
      (row) => row.borrowerName === 'SARL Bremontier',
    )!
    expect(bremontier.isOwnPledge).toBe(true)
    expect(bremontier.pledgedAmountCents).toBe(500_000_00)
    expect(bremontier.otherSecurities).toHaveLength(1)
    expect(bremontier.otherSecurities[0].pledgedAmountCents).toBe(250_000_00)
    expect(bremontier.otherSecurities[0].pledgorName).toBe('M. Peninque')
    // It hangs under that pledge and nowhere else.
    expect(
      rows.filter((row) => row.otherSecurities.length > 0),
    ).toHaveLength(1)
    // And it never counts as a pledge on OUR asset: the Concerto Capi's
    // margin is untouched by a security that bites on someone else's AV.
    const view = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    expect(view.summary.pledgedTotalCents).toBe(950_000_00)
  })

  test('a co-security matching no pledge of ours is listed on its own', async () => {
    const { user, calte } = await concertoSetup()
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      borrowerLabel: 'SCI Tiers',
      pledgorLabel: 'M. Peninque',
      subjectKind: 'external',
      subjectLabel: 'AV Vibrato',
      form: 'caution',
      pledgedAmountCents: 90_000_00,
    })
    const rows = await user.as.query(api.guarantees.listByPledgorOrg, {
      orgId: calte.orgId,
    })
    // Four rows, not three: a row must never become unreachable because no
    // pledge of ours happens to share its borrower.
    expect(rows).toHaveLength(4)
    const orphan = rows.find((row) => row.borrowerName === 'SCI Tiers')!
    expect(orphan.isOwnPledge).toBe(false)
    expect(orphan.pledgorName).toBe('M. Peninque')
  })

  test('securities on a group loan are not repeated in « Garanties données »', async () => {
    const { user, calte, calteLoan } = await concertoSetup()
    // Filed in CALTE, on CALTE's own loan, but stood by an outside body: the
    // loan sheet already lists it, so the given-guarantees block stays quiet.
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorLabel: 'Saccef',
      subjectKind: 'external',
      subjectLabel: 'Garantie Saccef',
      form: 'garantie_organisme',
    })
    const rows = await user.as.query(api.guarantees.listByPledgorOrg, {
      orgId: calte.orgId,
    })
    expect(rows).toHaveLength(3)
    expect(rows.flatMap((row) => row.otherSecurities)).toHaveLength(0)
  })

  test('the guarantees are ordered strongest first (D48)', async () => {
    const { user, calte, calteLoan } = await concertoSetup()
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorLabel: 'Clément Alteresco',
      subjectKind: 'external',
      subjectLabel: 'Caution personnelle',
      form: 'caution',
    })
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorLabel: 'Saccef',
      subjectKind: 'external',
      subjectLabel: 'Garantie Saccef',
      form: 'garantie_organisme',
    })
    const rows = await user.as.query(api.guarantees.listByLoan, {
      loanId: calteLoan,
    })
    expect(rows.map((row) => row.form)).toEqual([
      'nantissement',
      'garantie_organisme',
      'caution',
    ])
  })
})

describe('guarantees: mainlevée and unquantified pledges', () => {
  test('a released guarantee stays listed but leaves the total (C6)', async () => {
    const { user, concertoId } = await concertoSetup()
    const before = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    const target = before.guarantees.find(
      (row) => row.pledgedAmountCents === 500_000_00,
    )!
    await user.as.mutation(api.guarantees.setReleased, {
      guaranteeId: target._id,
      releasedAt: utc(2026, 8, 1),
    })
    const after = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    expect(after.guarantees).toHaveLength(3) // history is kept
    expect(after.summary.pledgedTotalCents).toBe(450_000_00)
    expect(after.summary.availableMarginCents).toBe(950_000_00)
    expect(after.summary.releasedCount).toBe(1)
    // A mainlevée entered by mistake can be undone.
    await user.as.mutation(api.guarantees.setReleased, {
      guaranteeId: target._id,
    })
    const restored = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    expect(restored.summary.pledgedTotalCents).toBe(950_000_00)
  })

  test('an unquantified caution is excluded from the total, counted apart (C3)', async () => {
    const { user, calte, calteLoan, concertoId } = await concertoSetup()
    await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'caution',
      // No pledgedAmountCents: an unlimited caution.
    })
    const view = await user.as.query(api.guarantees.listBySubjectDeal, {
      dealId: concertoId,
    })
    expect(view.summary.pledgedTotalCents).toBe(950_000_00) // unchanged
    expect(view.summary.unquantifiedCount).toBe(1)
    expect(view.summary.activeCount).toBe(4)
  })
})

describe('guarantees: requireGuaranteeParty', () => {
  test('a member of ONE party can read and write', async () => {
    const { t, calte, sci, concertoId } = await concertoSetup()
    // This user is a member of the BORROWING org only — not of the org that
    // holds the pledged asset.
    const sciOnly = await createUser(t, 'sci-only@test.dev')
    await t.run(async (ctx) => {
      await ctx.db.insert('organizationMembers', {
        orgId: sci.orgId,
        userId: sciOnly.userId,
        role: 'member',
        joinedAt: Date.now(),
      })
    })
    const loanId = await sciOnly.as.mutation(api.loans.create, {
      orgId: sci.orgId,
      label: 'Prêt SCI bis',
      ...loanTerms,
    })
    const guaranteeId = await sciOnly.as.mutation(api.guarantees.create, {
      orgId: sci.orgId,
      loanId,
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'nantissement',
      pledgedAmountCents: 100_000_00,
    })
    expect(guaranteeId).toBeDefined()
    await sciOnly.as.mutation(api.guarantees.setReleased, {
      guaranteeId,
      releasedAt: utc(2026, 8, 1),
    })
  })

  test('a member of NO party is refused', async () => {
    const { t, calte, concertoId, calteLoan } = await concertoSetup()
    const outsider = await createUser(t, 'outsider@test.dev')
    const theirs = await createOrg(t, 'org-outsider', [
      { userId: outsider.userId, role: 'owner' },
    ])
    // Filing it in an org they DO belong to changes nothing: the loan and
    // the pledged asset are still someone else's.
    await expectConvexError(
      outsider.as.mutation(api.guarantees.create, {
        orgId: theirs.orgId,
        loanId: calteLoan,
        pledgorOrgId: calte.orgId,
        subjectKind: 'placement',
        subjectDealId: concertoId,
        form: 'nantissement',
        pledgedAmountCents: 1_00,
      }),
      'not_a_party',
    )
    await expectConvexError(
      outsider.as.query(api.guarantees.listByLoan, { loanId: calteLoan }),
      'not_a_member',
    )
    await expectConvexError(
      outsider.as.query(api.guarantees.listBySubjectDeal, {
        dealId: concertoId,
      }),
      'not_a_member',
    )
  })

  test('a guarantee touching no group org at all is filed in the recording org', async () => {
    const { user, calte } = await concertoSetup()
    // SPEC § 10 line 10b: outside borrower, outside guarantor, outside
    // asset. Nothing anchors the row but the org that records it — and
    // without the row, our own 500 K€ on the Concerto Capi reads as the only
    // security on that debt.
    const id = await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      borrowerLabel: 'SARL Bremontier',
      pledgorLabel: 'M. Peninque',
      subjectKind: 'external',
      subjectLabel: 'AV Vibrato — M. Peninque',
      form: 'nantissement',
      pledgedAmountCents: 250_000_00,
    })
    expect(id).toBeDefined()
  })

  test('the recording org must be one of ours', async () => {
    const { t, user, calte } = await concertoSetup()
    const stranger = await createUser(t, 'stranger@test.dev')
    const theirs = await createOrg(t, 'org-stranger', [
      { userId: stranger.userId, role: 'owner' },
    ])
    // Everything else about the row is legitimate — CALTE stands the
    // security — but it is not ours to drop into someone else's Passif.
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        orgId: theirs.orgId,
        borrowerLabel: 'SARL Bremontier',
        pledgorOrgId: calte.orgId,
        subjectKind: 'external',
        subjectLabel: 'AV Vibrato',
        form: 'nantissement',
      }),
      'not_a_member',
    )
  })
})

describe('guarantees: shape validation', () => {
  test('a beneficiary must be exactly one of loan / outside label', async () => {
    const { user, calte, calteLoan, concertoId } = await concertoSetup()
    const base = {
      orgId: calte.orgId,
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement' as const,
      subjectDealId: concertoId,
      form: 'nantissement' as const,
    }
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        ...base,
        loanId: calteLoan,
        borrowerLabel: 'SARL Bremontier',
      }),
      'ambiguous_borrower',
    )
    await expectConvexError(
      user.as.mutation(api.guarantees.create, base),
      'ambiguous_borrower',
    )
  })

  test('a guarantor is an org OR a label, never both', async () => {
    const { user, calte, calteLoan, concertoId } = await concertoSetup()
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        orgId: calte.orgId,
        loanId: calteLoan,
        pledgorOrgId: calte.orgId,
        pledgorLabel: 'Saccef',
        subjectKind: 'placement',
        subjectDealId: concertoId,
        form: 'nantissement',
      }),
      'ambiguous_pledgor',
    )
  })

  test('an unknown guarantor is accepted — the source deeds are often mute', async () => {
    const { user, calte, calteLoan } = await concertoSetup()
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      subjectKind: 'external',
      subjectLabel: 'Caution — garant à préciser',
      form: 'caution',
    })
    expect(guaranteeId).toBeDefined()
  })

  test('the subject must match its subjectKind', async () => {
    const { user, calte, calteLoan } = await concertoSetup()
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        orgId: calte.orgId,
        loanId: calteLoan,
        subjectKind: 'placement',
        form: 'nantissement',
      }),
      'missing_subject',
    )
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        orgId: calte.orgId,
        loanId: calteLoan,
        subjectKind: 'external',
        subjectLabel: '   ',
        form: 'nantissement',
      }),
      'missing_subject',
    )
  })

  test('the denormalized orgs come from the rows, never from the caller', async () => {
    const { t, user, sci, concertoId, calte } = await concertoSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: sci.orgId,
      label: 'Prêt à dénormaliser',
      ...loanTerms,
    })
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      orgId: sci.orgId,
      loanId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'nantissement',
      pledgedAmountCents: 1_000_00,
    })
    const stored = await t.run(async (ctx) =>
      ctx.db.get('guarantees', guaranteeId),
    )
    // Borrower org read off the loan, subject org off the deal.
    expect(stored?.borrowerOrgId).toBe(sci.orgId)
    expect(stored?.subjectOrgId).toBe(calte.orgId)
    // And the filing org is the one that was asked for — every row carries
    // one, which is what keeps a guarantee with no group party readable.
    expect(stored?.orgId).toBe(sci.orgId)
  })

  test('editing a guarantee never moves it to another Passif', async () => {
    const { t, user, sci, calte, calteLoan, concertoId } = await concertoSetup()
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      orgId: sci.orgId,
      borrowerLabel: 'SARL Bremontier',
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'nantissement',
      pledgedAmountCents: 200_000_00,
    })
    // Rewrite every party: the beneficiary becomes a group loan, the subject
    // the shares of another company. The filing org is not an argument of
    // `update`, and nothing here may substitute for one.
    await user.as.mutation(api.guarantees.update, {
      guaranteeId,
      loanId: calteLoan,
      pledgorOrgId: calte.orgId,
      subjectKind: 'shares',
      subjectCompanyId: calte.rootCompanyId,
      form: 'caution',
    })
    const stored = await t.run(async (ctx) =>
      ctx.db.get('guarantees', guaranteeId),
    )
    expect(stored?.orgId).toBe(sci.orgId)
    expect(stored?.borrowerOrgId).toBe(calte.orgId)
    expect(stored?.subjectCompanyId).toBe(calte.rootCompanyId)
  })

  test('a rank below 1 and a non-positive amount are refused', async () => {
    const { user, calte, calteLoan, concertoId } = await concertoSetup()
    const base = {
      orgId: calte.orgId,
      loanId: calteLoan,
      subjectKind: 'placement' as const,
      subjectDealId: concertoId,
      form: 'nantissement' as const,
    }
    await expectConvexError(
      user.as.mutation(api.guarantees.create, { ...base, rank: 0 }),
      'invalid_rank',
    )
    await expectConvexError(
      user.as.mutation(api.guarantees.create, {
        ...base,
        pledgedAmountCents: 0,
      }),
      'invalid_amount',
    )
  })
})

describe('guarantees: deletion guardrails', () => {
  test('a loan carrying guarantees cannot be deleted (C11)', async () => {
    const { user, calteLoan } = await concertoSetup()
    await expectConvexError(
      user.as.mutation(api.loans.remove, { loanId: calteLoan }),
      'has_guarantees',
    )
  })

  test('a pledged placement cannot be deleted (C12)', async () => {
    const { user, concertoId } = await concertoSetup()
    await expectConvexError(
      user.as.mutation(api.deals.remove, { id: concertoId }),
      'is_pledged',
    )
  })

  test('a RELEASED guarantee still blocks its placement’s deletion', async () => {
    // A mainlevée keeps the row as history (C6), and that history still needs
    // its subject: deleting the deal would leave it describing nothing.
    // Detaching — deleting the guarantee — is the way out, as for a loan.
    const { t, user, concertoId } = await concertoSetup()
    const ids = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('guarantees')
          .withIndex('by_subject_deal', (q) =>
            q.eq('subjectDealId', concertoId),
          )
          .collect()
      ).map((row) => row._id),
    )
    for (const guaranteeId of ids) {
      await user.as.mutation(api.guarantees.setReleased, {
        guaranteeId,
        releasedAt: Date.now(),
      })
    }
    await expectConvexError(
      user.as.mutation(api.deals.remove, { id: concertoId }),
      'is_pledged',
    )

    // Detaching them all is the way out, and then the deletion goes through.
    for (const guaranteeId of ids) {
      await user.as.mutation(api.guarantees.remove, { guaranteeId })
    }
    await user.as.mutation(api.deals.remove, { id: concertoId })
  })

  test('a guarantee carrying documents cannot be deleted', async () => {
    const { t, user, calte, calteLoan, concertoId } = await concertoSetup()
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      orgId: calte.orgId,
      loanId: calteLoan,
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'hypotheque',
      pledgedAmountCents: 10_000_00,
    })
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['acte']))
      await ctx.db.insert('documents', {
        orgId: calte.orgId,
        guaranteeId,
        title: 'Acte de nantissement.pdf',
        kind: 'acte_garantie',
        storageId,
        source: 'upload',
        uploadedAt: Date.now(),
      })
    })
    await expectConvexError(
      user.as.mutation(api.guarantees.remove, { guaranteeId }),
      'has_documents',
    )
  })

  test('a guarantee deed is filed in the borrower’s org', async () => {
    const { t, user, sci, calte, concertoId } = await concertoSetup()
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: sci.orgId,
      label: 'Prêt avec acte',
      ...loanTerms,
    })
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      orgId: sci.orgId,
      loanId,
      pledgorOrgId: calte.orgId,
      subjectKind: 'placement',
      subjectDealId: concertoId,
      form: 'nantissement',
      pledgedAmountCents: 10_000_00,
    })
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['acte'])),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      guaranteeId,
      title: 'Acte de nantissement.pdf',
      kind: 'acte_garantie',
      storageId,
    })
    const stored = await t.run(async (ctx) =>
      ctx.db.get('documents', documentId),
    )
    // The debt is read from the borrower's space, so the deed lives there.
    expect(stored?.orgId).toBe(sci.orgId)
    expect(stored?.companyId).toBeUndefined()
    const listed = await user.as.query(api.documents.listByGuarantee, {
      guaranteeId,
    })
    expect(listed.map((doc) => doc.title)).toEqual([
      'Acte de nantissement.pdf',
    ])
  })
})
