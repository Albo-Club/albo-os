/**
 * Pure tests for the liabilities logic (convex/lib/liabilities.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 *
 * Deliberately OUTSIDE convex/: a `node:test` import inside convex/ would
 * break the Convex deployment bundle.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeLoanBalanceCents,
  loanSideForOrg,
} from '../convex/lib/liabilities'

describe('loanSideForOrg', () => {
  const loan = { fromOrgId: 'org_calte', toOrgId: 'org_albo' }

  it('créancier si l’org est fromOrgId', () => {
    assert.equal(loanSideForOrg(loan, 'org_calte'), 'creditor')
  })

  it('débiteur si l’org est toOrgId', () => {
    assert.equal(loanSideForOrg(loan, 'org_albo'), 'debtor')
  })

  it('null si l’org n’est pas partie au prêt', () => {
    assert.equal(loanSideForOrg(loan, 'org_autre'), null)
  })
})

describe('computeLoanBalanceCents', () => {
  it('créancier : un prêt de 100 000 € (out) → créance +', () => {
    assert.equal(
      computeLoanBalanceCents([{ direction: 'out', amount: 10_000_000 }]),
      10_000_000,
    )
  })

  it('créancier : prêt 150 000 € − remboursement reçu 50 000 € → +100 000 €', () => {
    assert.equal(
      computeLoanBalanceCents([
        { direction: 'out', amount: 15_000_000 },
        { direction: 'in', amount: 5_000_000 },
      ]),
      10_000_000,
    )
  })

  it('débiteur : un emprunt de 100 000 € (in) → dette −', () => {
    assert.equal(
      computeLoanBalanceCents([{ direction: 'in', amount: 10_000_000 }]),
      -10_000_000,
    )
  })

  it('débiteur : emprunt 150 000 € − remboursement versé 50 000 € → −100 000 €', () => {
    assert.equal(
      computeLoanBalanceCents([
        { direction: 'in', amount: 15_000_000 },
        { direction: 'out', amount: 5_000_000 },
      ]),
      -10_000_000,
    )
  })

  it('aucune transaction pointée → solde 0', () => {
    assert.equal(computeLoanBalanceCents([]), 0)
  })

  it('scénario de vérification symétrique : CALTE +100 000 € / Albo −100 000 €', () => {
    // CALTE (creditor) only sees ITS leg: out 100 000 €.
    const calteOwnTxs = [{ direction: 'out' as const, amount: 10_000_000 }]
    // Albo (debtor) only sees ITS leg: in 100 000 €.
    const alboOwnTxs = [{ direction: 'in' as const, amount: 10_000_000 }]

    const calteBalance = computeLoanBalanceCents(calteOwnTxs)
    const alboBalance = computeLoanBalanceCents(alboOwnTxs)

    assert.equal(calteBalance, 10_000_000) // receivable
    assert.equal(alboBalance, -10_000_000) // debt
    assert.equal(calteBalance + alboBalance, 0) // symmetry
  })
})
