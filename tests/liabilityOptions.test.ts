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
  receivable: 'Créance',
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
            side: 'creditor',
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
      sublabel: 'Créance',
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
        loans: [{ _id: 'loan_1', side: 'debtor', counterpartyName: null }],
      },
      labels,
    )

    assert.equal(groups.equityOptions.length, 1)
    assert.equal(groups.loanOptions.length, 1)
    // Missing holder / counterparty → placeholder.
    assert.equal(groups.equityOptions[0].sublabel, '—')
    assert.equal(groups.loanOptions[0].label, '—')
    // Debtor side → "Dette" sublabel.
    assert.equal(groups.loanOptions[0].sublabel, 'Dette')
  })

  it('aucune donnée → deux groupes vides (jamais undefined)', () => {
    const groups = buildLiabilityOptions(
      { equityPositions: [], loans: [] },
      labels,
    )

    assert.deepEqual(groups, { equityOptions: [], loanOptions: [] })
  })
})
