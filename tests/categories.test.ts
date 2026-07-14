/**
 * Pure tests for the treasury categories (convex/lib/categories.ts, category
 * lists mirrored in src/lib/categories.ts): mirror sync, analysis bucket
 * derivation, learned-rule pattern derivation and matching.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHARGE_CATEGORIES,
  PRODUCT_CATEGORIES,
  deriveCategoryPattern,
  effectiveCategory,
  findMatchingRule,
  isValidCategory,
  matchesCategoryPattern,
} from '../convex/lib/categories'
import {
  CHARGE_CATEGORIES as FRONT_CHARGE,
  PRODUCT_CATEGORIES as FRONT_PRODUCT,
} from '../src/lib/categories'

describe('category lists', () => {
  it('convex/ and src/ mirrors are identical', () => {
    assert.deepEqual([...CHARGE_CATEGORIES], [...FRONT_CHARGE])
    assert.deepEqual([...PRODUCT_CATEGORIES], [...FRONT_PRODUCT])
  })

  it('isValidCategory scopes slugs to their status', () => {
    assert.equal(isValidCategory('charge', 'salaries'), true)
    assert.equal(isValidCategory('charge', 'investment_income'), false)
    assert.equal(isValidCategory('product', 'investment_income'), true)
    assert.equal(isValidCategory('product', 'salaries'), false)
    assert.equal(isValidCategory('charge', 'nonsense'), false)
  })
})

describe('effectiveCategory', () => {
  it('deal match → deals', () => {
    assert.equal(
      effectiveCategory({
        matchStatus: 'matched',
        allocation: { kind: 'deal', targetId: 'x' },
        category: undefined,
      }),
      'deals',
    )
  })

  it('liability allocations → equity / intercos', () => {
    assert.equal(
      effectiveCategory({
        matchStatus: 'matched',
        allocation: { kind: 'equity', targetId: 'x' },
        category: undefined,
      }),
      'equity',
    )
    assert.equal(
      effectiveCategory({
        matchStatus: 'matched',
        allocation: { kind: 'intercompany_loan', targetId: 'x' },
        category: undefined,
      }),
      'intercos',
    )
  })

  it('charge/product → stored category, else uncategorized', () => {
    assert.equal(
      effectiveCategory({
        matchStatus: 'charge',
        allocation: undefined,
        category: 'salaries',
      }),
      'salaries',
    )
    assert.equal(
      effectiveCategory({
        matchStatus: 'product',
        allocation: undefined,
        category: undefined,
      }),
      'uncategorized',
    )
  })

  it('absent matchStatus (pre-backfill) → unmatched', () => {
    assert.equal(
      effectiveCategory({
        matchStatus: undefined,
        allocation: undefined,
        category: undefined,
      }),
      'unmatched',
    )
  })

  it('ignored / internal_transfer are excluded (null)', () => {
    assert.equal(
      effectiveCategory({
        matchStatus: 'ignored',
        allocation: undefined,
        category: undefined,
      }),
      null,
    )
    assert.equal(
      effectiveCategory({
        matchStatus: 'internal_transfer',
        allocation: undefined,
        category: undefined,
      }),
      null,
    )
  })
})

describe('deriveCategoryPattern', () => {
  it('prefers the counterparty when present', () => {
    assert.equal(deriveCategoryPattern('VIR SEPA 123456', 'Antese'), 'antese')
  })

  it('drops volatile tokens (dates, references) from the label', () => {
    // Real Palatine subscription label: the long numeric refs churn monthly.
    assert.equal(
      deriveCategoryPattern(
        'ABO ePALATINE ENTREPRISE XCBVX007 2026071100001582000001 CONTRAT N K1522708',
      ),
      'abo epalatine entreprise xcbvx007',
    )
  })

  it('keeps at most 4 stable tokens, accent-folded and lowercased', () => {
    assert.equal(
      deriveCategoryPattern('Prélèvement URSSAF Île-de-France cotisations T3'),
      'prelevement urssaf ile-de-france cotisations',
    )
  })

  it('returns null when nothing stable remains', () => {
    assert.equal(deriveCategoryPattern('20260711 0001582 000001'), null)
  })
})

describe('matchesCategoryPattern / findMatchingRule', () => {
  it('matches non-consecutive tokens (volatile tokens in between)', () => {
    const searchText =
      'abo epalatine entreprise xcbvx007 2026081100009999000001 contrat n k1522708'
    assert.equal(
      matchesCategoryPattern(searchText, 'abo epalatine entreprise xcbvx007'),
      true,
    )
  })

  it('requires every pattern token', () => {
    assert.equal(matchesCategoryPattern('abo entreprise', 'abo epalatine'), false)
  })

  it('never matches a row without searchText (pre-backfill)', () => {
    assert.equal(matchesCategoryPattern(undefined, 'abo'), false)
  })

  it('findMatchingRule prefers the most specific (longest) pattern', () => {
    const rules = [
      { pattern: 'sepa', id: 'broad' },
      { pattern: 'sepa g7 calte', id: 'specific' },
    ]
    const match = findMatchingRule(rules, 'sepa g7 707012 07 calte abo707012-1')
    assert.equal(match?.id, 'specific')
  })

  it('findMatchingRule returns null when nothing matches', () => {
    assert.equal(findMatchingRule([{ pattern: 'urssaf' }], 'abo epalatine'), null)
  })
})
