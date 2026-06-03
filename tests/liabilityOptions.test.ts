/**
 * Tests purs du câblage des cibles passif du combobox de pointage
 * (src/lib/liabilityOptions.ts).
 *
 * Régression du bug « le groupe Comptes courants n'apparaît pas » : un
 * intercompanyLoan retourné par getLiabilities DOIT produire une option de
 * groupe Comptes courants (kind 'intercompany_loan', targetId = loan._id).
 *
 * Lancés avec le test runner natif de Node via tsx (aucune dépendance) :
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
    // Détenteur / contrepartie absents → placeholder.
    assert.equal(groups.equityOptions[0].sublabel, '—')
    assert.equal(groups.loanOptions[0].label, '—')
    // Côté débiteur → sous-libellé « Dette ».
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
