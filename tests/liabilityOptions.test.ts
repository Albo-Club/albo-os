/**
 * Pure tests for the wiring of the liability targets in the pointage
 * combobox (src/lib/liabilityOptions.ts).
 *
 * Regression for the "Comptes courants group does not show up" bug: an
 * intercompanyLoan returned by getLiabilities MUST produce a Comptes
 * courants group option (kind 'intercompany_loan', targetId = loan._id).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLiabilityOptions } from '../src/lib/liabilityOptions'

const labels = {
  equityType: (type: string) => `type:${type}`,
  payable: 'Dette',
}

describe('buildLiabilityOptions', () => {
  it('un loan produit une option Comptes courants identifiée par son _id', () => {
    const { loanOptions } = buildLiabilityOptions(
      {
        equityPositions: [],
        loans: [
          {
            _id: 'loan_1',
            counterpartyName: 'Albo Club',
          },
        ],
      },
      labels,
    )

    assert.equal(loanOptions.length, 1)
    assert.deepEqual(loanOptions[0], {
      kind: 'intercompany_loan',
      targetId: 'loan_1',
      label: 'Albo Club',
      sublabel: 'Dette',
    })
  })

  it('une equityPosition produit une option Capitaux propres', () => {
    const { equityOptions } = buildLiabilityOptions(
      {
        equityPositions: [
          { _id: 'equity_1', type: 'capital_social', holderName: 'CALTE' },
        ],
        loans: [],
      },
      labels,
    )

    assert.equal(equityOptions.length, 1)
    assert.deepEqual(equityOptions[0], {
      kind: 'equity',
      targetId: 'equity_1',
      label: 'type:capital_social',
      sublabel: 'CALTE',
    })
  })

  it('les deux groupes sont alimentés indépendamment (1 equity + 1 loan)', () => {
    const groups = buildLiabilityOptions(
      {
        equityPositions: [
          { _id: 'equity_1', type: 'capital_social', holderName: null },
        ],
        loans: [{ _id: 'loan_1', counterpartyName: null }],
      },
      labels,
    )

    assert.equal(groups.equityOptions.length, 1)
    assert.equal(groups.loanOptions.length, 1)
    // Missing holder / counterparty → placeholder.
    assert.equal(groups.equityOptions[0].sublabel, '—')
    assert.equal(groups.loanOptions[0].label, '—')
    // Only the debtor sees a C/C → the sublabel is always "Dette".
    assert.equal(groups.loanOptions[0].sublabel, 'Dette')
  })

  it('aucune donnée → quatre groupes vides (jamais undefined)', () => {
    const groups = buildLiabilityOptions(
      { equityPositions: [], loans: [] },
      labels,
    )

    assert.deepEqual(groups, {
      equityOptions: [],
      loanOptions: [],
      bankLoanOptions: [],
      propertyOptions: [],
    })
  })

  it('un prêt bancaire alimente le groupe Prêts', () => {
    const groups = buildLiabilityOptions(
      { equityPositions: [], loans: [] },
      labels,
      [
        {
          _id: 'bankloan_1',
          label: 'Prêt Palatine 2021',
          lenderName: 'Banque Palatine',
        },
      ],
    )

    assert.deepEqual(groups.bankLoanOptions, [
      {
        kind: 'loan',
        targetId: 'bankloan_1',
        label: 'Prêt Palatine 2021',
        sublabel: 'Banque Palatine',
      },
    ])
    // Chaque groupe vient de SA source : un prêt bancaire ne fuit jamais
    // dans les comptes courants, et réciproquement.
    assert.deepEqual(groups.loanOptions, [])
  })

  it('un bien alimente le groupe Biens', () => {
    const groups = buildLiabilityOptions(
      { equityPositions: [], loans: [] },
      labels,
      [],
      [
        {
          _id: 'property_1',
          name: '18 rue de la Chapelle',
          address: 'Paris 18e',
        },
      ],
    )

    assert.deepEqual(groups.propertyOptions, [
      {
        kind: 'property',
        targetId: 'property_1',
        label: '18 rue de la Chapelle',
        sublabel: 'Paris 18e',
      },
    ])
    // Même règle que pour les prêts : chaque groupe vient de SA source, un
    // bien ne fuit ni dans les prêts ni dans les comptes courants.
    assert.deepEqual(groups.bankLoanOptions, [])
    assert.deepEqual(groups.loanOptions, [])
  })

  it('un compte courant ne fuit pas dans le groupe Prêts', () => {
    const groups = buildLiabilityOptions(
      {
        equityPositions: [],
        loans: [
          { _id: 'loan_1', counterpartyName: 'Albo Club' },
        ],
      },
      labels,
    )

    assert.equal(groups.loanOptions.length, 1)
    assert.deepEqual(groups.bankLoanOptions, [])
    assert.deepEqual(groups.propertyOptions, [])
  })
})
