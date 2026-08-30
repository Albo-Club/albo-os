/// <reference types="vite/client" />
/**
 * Regression: real estate — convex/properties.ts.
 *
 * Four invariants are pinned here.
 *
 * 1. NOTHING derivable is stored. There is no cost-price column, no
 *    operating result, no yield: `list` / `getById` recompute all of them on
 *    every read, so matching a flow moves the figures with no migration.
 * 2. ONE source per cost line item (SPEC D43). The entered amount and the
 *    matched flows are never added together — that addition is the bug the
 *    whole design exists to prevent (C14).
 * 3. Tenancy: every function goes through `requireOrgMember`, and a flow can
 *    only be matched to a property of its own org.
 * 4. A pledged property never disappears in silence (C12).
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
  const user = await createUser(t, 'realestate@test.dev')
  const org = await createOrg(t, 'org-realestate', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

/** The SPEC's example property (§ 6.6). */
const chapelle = {
  name: '18 rue de la Chapelle',
  address: 'Paris 18e',
  propertyType: 'immeuble' as const,
  usage: 'locatif_nu' as const,
  acquiredDate: utc(2019, 2, 9),
  costBasis: [
    {
      poste: 'acquisition' as const,
      source: 'manual' as const,
      manualAmountCents: 658_800_00,
    },
    {
      poste: 'frais_acquisition' as const,
      source: 'manual' as const,
      manualAmountCents: 18_300_00,
    },
    { poste: 'travaux' as const, source: 'flows' as const },
  ],
}

describe('properties: every figure is derived, never stored', () => {
  test('the cost price sums the three line items, each at its own source', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 64_900_00,
      rawLabel: 'VIR TRAVAUX TOITURE',
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'property',
      targetId: propertyId,
      category: 'travaux',
    })

    const sheet = await user.as.query(api.properties.getById, { propertyId })
    // 658 800 + 18 300 (entered) + 64 900 (one matched flow).
    expect(sheet.costBasisCents).toBe(742_000_00)
    const travaux = sheet.costBasis.find((p) => p.poste === 'travaux')
    expect(travaux?.source).toBe('flows')
    expect(travaux?.flowCount).toBe(1)
  })

  test('a line item on `manual` NEVER adds its matched flows (C14)', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 500_000_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'property',
      targetId: propertyId,
      category: 'acquisition',
    })

    const sheet = await user.as.query(api.properties.getById, { propertyId })
    const acquisition = sheet.costBasis.find((p) => p.poste === 'acquisition')
    // The entered amount stands — 1 158 800 € would be the bug.
    expect(acquisition?.amountCents).toBe(658_800_00)
    // …and the ignored flow is SURFACED, not swallowed.
    expect(acquisition?.ignoredFlowCount).toBe(1)
    expect(acquisition?.ignoredFlowCents).toBe(500_000_00)
  })

  test('switching a line item source moves the cost price, with no re-entry', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 700_000_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'property',
      targetId: propertyId,
      category: 'acquisition',
    })

    await user.as.mutation(api.properties.setCostPosteSource, {
      propertyId,
      poste: 'acquisition',
      source: 'flows',
    })
    let sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(
      sheet.costBasis.find((p) => p.poste === 'acquisition')?.amountCents,
    ).toBe(700_000_00)

    // Back to `manual`: the entered amount is still there — the switch never
    // destroyed it.
    await user.as.mutation(api.properties.setCostPosteSource, {
      propertyId,
      poste: 'acquisition',
      source: 'manual',
    })
    sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(
      sheet.costBasis.find((p) => p.poste === 'acquisition')?.amountCents,
    ).toBe(658_800_00)
  })

  test('rents and charges come from matched flows, and nothing else', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const rentId = await createTransaction(t, org.orgId, accountId, {
      direction: 'in',
      amount: 58_200_00,
    })
    const chargeId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 14_900_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: rentId,
      kind: 'property',
      targetId: propertyId,
      category: 'loyer',
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: chargeId,
      kind: 'property',
      targetId: propertyId,
      category: 'charges',
    })

    const sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(sheet.operating.revenueCents).toBe(58_200_00)
    expect(sheet.operating.chargesCents).toBe(14_900_00)
    expect(sheet.operating.netCents).toBe(43_300_00)
    // Yield against the cost price — derived on the fly, stored nowhere.
    expect(sheet.netYield).toBeGreaterThan(0)
  })

  test('the latent gain is unknown, not zero, until the property is valued', async () => {
    const { user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })

    let sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(sheet.currentValueCents).toBeNull()
    expect(sheet.latentGainCents).toBeNull()

    await user.as.mutation(api.properties.addValuation, {
      propertyId,
      asOf: utc(2026, 3, 1),
      valueCents: 860_000_00,
      source: 'estimation agence',
    })
    sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(sheet.currentValueCents).toBe(860_000_00)
    expect(sheet.latentGainCents).toBe(860_000_00 - 677_100_00)
  })

  test('a second valuation at the same date replaces it, never stacks a second truth', async () => {
    const { user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    await user.as.mutation(api.properties.addValuation, {
      propertyId,
      asOf: utc(2026, 3, 1),
      valueCents: 800_000_00,
    })
    await user.as.mutation(api.properties.addValuation, {
      propertyId,
      asOf: utc(2026, 3, 1),
      valueCents: 860_000_00,
    })

    const sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(sheet.valuations).toHaveLength(1)
    expect(sheet.valuations[0].valueCents).toBe(860_000_00)
  })

  test('the list total counts held properties only — a sale is money that left', async () => {
    const { user, org } = await orgSetup()
    const heldId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const soldId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
      name: 'Bien revendu',
    })
    for (const id of [heldId, soldId]) {
      await user.as.mutation(api.properties.addValuation, {
        propertyId: id,
        asOf: utc(2026, 1, 1),
        valueCents: 100_000_00,
      })
    }
    await user.as.mutation(api.properties.update, {
      propertyId: soldId,
      status: 'sold',
      saleDate: utc(2026, 6, 1),
      salePriceCents: 120_000_00,
      ...chapelle,
      name: 'Bien revendu',
    })

    const list = await user.as.query(api.properties.list, { orgId: org.orgId })
    expect(list.properties).toHaveLength(2)
    expect(list.totalValueCents).toBe(100_000_00)
  })
})

describe('properties: matching is human, and scoped to the org', () => {
  test('a property flow REQUIRES its nature — it would be unreadable without', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 1_000_00,
    })

    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: txId,
        kind: 'property',
        targetId: propertyId,
      }),
      'missing_category',
    )
  })

  test('a category on a NON-property target is refused — nothing would read it', async () => {
    const { t, user, org } = await orgSetup()
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 1_000_00,
    })
    const positionId = await t.run(async (ctx) =>
      ctx.db.insert('equityPositions', {
        orgId: org.orgId,
        type: 'capital_social',
        amountCents: 10_000_00,
        effectiveDate: utc(2019, 3, 12),
      }),
    )

    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: txId,
        kind: 'equity',
        targetId: positionId,
        category: 'travaux',
      }),
      'category_not_supported',
    )
  })

  test("a flow cannot be matched to another org's property", async () => {
    const { t, user, org } = await orgSetup()
    const other = await createOrg(t, 'org-other-realestate', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreignId = await user.as.mutation(api.properties.create, {
      orgId: other.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 1_000_00,
    })

    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: txId,
        kind: 'property',
        targetId: foreignId,
        category: 'travaux',
      }),
      'property_wrong_org',
    )
  })

  test('a non-member reads nothing of the properties', async () => {
    const { t, org } = await orgSetup()
    const outsider = await createUser(t, 'outsider@test.dev')
    await expectConvexError(
      outsider.as.query(api.properties.list, { orgId: org.orgId }),
      'not_a_member',
    )
  })

  test('detaching a property flow puts the transaction back in the queue', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'in',
      amount: 4_850_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'property',
      targetId: propertyId,
      category: 'loyer',
    })
    await user.as.mutation(api.liabilities.deallocateTransaction, {
      transactionId: txId,
    })

    const tx = await t.run(async (ctx) => ctx.db.get('transactions', txId))
    expect(tx?.matchStatus).toBe('unmatched')
    expect(tx?.allocation).toBeUndefined()
    const sheet = await user.as.query(api.properties.getById, { propertyId })
    expect(sheet.operating.revenueCents).toBe(0)
  })
})

describe('properties: a pledged asset never disappears in silence', () => {
  test('deletion is refused while a guarantee bites on the property (C12)', async () => {
    const { user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      label: 'Prêt Crédit Mutuel 2019',
      lenderName: 'Crédit Mutuel',
      principalCents: 538_000_00,
      signedDate: utc(2019, 2, 9),
      firstPaymentDate: utc(2019, 3, 5),
      durationMonths: 240,
      amortizationKind: 'constant_annuity',
      rateBps: 150,
      rateKind: 'fixed',
      paymentFrequency: 'monthly',
    })
    await user.as.mutation(api.guarantees.create, {
      loanId,
      pledgorOrgId: org.orgId,
      subjectKind: 'property',
      subjectPropertyId: propertyId,
      form: 'ppd',
      pledgedAmountCents: 538_000_00,
      actDate: utc(2019, 2, 9),
    })

    await expectConvexError(
      user.as.mutation(api.properties.remove, { propertyId }),
      'has_guarantees',
    )
  })

  test('deletion is refused while transactions are matched to it', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'out',
      amount: 1_000_00,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'property',
      targetId: propertyId,
      category: 'charges',
    })

    await expectConvexError(
      user.as.mutation(api.properties.remove, { propertyId }),
      'has_allocations',
    )
  })

  test('a clean property deletes, and takes its valuations with it', async () => {
    const { t, user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    await user.as.mutation(api.properties.addValuation, {
      propertyId,
      asOf: utc(2026, 1, 1),
      valueCents: 100_000_00,
    })
    await user.as.mutation(api.properties.remove, { propertyId })

    const left = await t.run(async (ctx) =>
      ctx.db.query('propertyValuations').collect(),
    )
    expect(left).toHaveLength(0)
  })
})

describe('guarantees: a PPD on a building reads from BOTH sides (D13)', () => {
  test('one row, read from the loan and from the property', async () => {
    const { user, org } = await orgSetup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      ...chapelle,
    })
    await user.as.mutation(api.properties.addValuation, {
      propertyId,
      asOf: utc(2026, 1, 1),
      valueCents: 860_000_00,
    })
    const loanId = await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      label: 'Prêt Crédit Mutuel 2019',
      lenderName: 'Crédit Mutuel',
      principalCents: 538_000_00,
      signedDate: utc(2019, 2, 9),
      firstPaymentDate: utc(2019, 3, 5),
      durationMonths: 240,
      amortizationKind: 'constant_annuity',
      rateBps: 150,
      rateKind: 'fixed',
      paymentFrequency: 'monthly',
    })
    await user.as.mutation(api.guarantees.create, {
      loanId,
      pledgorOrgId: org.orgId,
      subjectKind: 'property',
      subjectPropertyId: propertyId,
      form: 'ppd',
      pledgedAmountCents: 538_000_00,
    })

    // From the loan.
    const fromLoan = await user.as.query(api.guarantees.listByLoan, { loanId })
    expect(fromLoan).toHaveLength(1)
    expect(fromLoan[0].subjectKind).toBe('property')
    expect(fromLoan[0].subject.label).toBe('18 rue de la Chapelle')
    // The margin compares against the property's own valuation.
    expect(fromLoan[0].assetSummary.currentValueCents).toBe(860_000_00)
    expect(fromLoan[0].assetSummary.availableMarginCents).toBe(
      860_000_00 - 538_000_00,
    )

    // From the property — the very same row, not a copy.
    const fromProperty = await user.as.query(
      api.guarantees.listBySubjectProperty,
      { propertyId },
    )
    expect(fromProperty.guarantees).toHaveLength(1)
    expect(fromProperty.guarantees[0]._id).toBe(fromLoan[0]._id)
    expect(fromProperty.guarantees[0].loanLabel).toBe('Prêt Crédit Mutuel 2019')
    expect(fromProperty.summary.pledgedTotalCents).toBe(538_000_00)
  })
})
