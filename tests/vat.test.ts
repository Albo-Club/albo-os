/**
 * Pure tests for the VAT derivation (convex/lib/vat.ts, mirrored in
 * src/lib/vat.ts): VAT-inclusive amounts in cents, rates in basis points,
 * VAT never stored.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VAT_RATES_BPS, vatCentsFromTtc } from '../convex/lib/vat'
import {
  VAT_RATES_BPS as FRONT_RATES,
  vatCentsFromTtc as frontVatCentsFromTtc,
} from '../src/lib/vat'

describe('vatCentsFromTtc', () => {
  it('20 % : 120 € TTC → 20 € de TVA', () => {
    assert.equal(vatCentsFromTtc(12000, 2000), 2000)
  })

  it('10 % : 110 € TTC → 10 € de TVA', () => {
    assert.equal(vatCentsFromTtc(11000, 1000), 1000)
  })

  it('5,5 % : 105,50 € TTC → 5,50 € de TVA', () => {
    assert.equal(vatCentsFromTtc(10550, 550), 550)
  })

  it('taux 0 → TVA nulle', () => {
    assert.equal(vatCentsFromTtc(12000, 0), 0)
  })

  it('arrondi au cent le plus proche (100 € TTC à 20 % → 16,67 €)', () => {
    assert.equal(vatCentsFromTtc(10000, 2000), 1667)
  })

  it('le miroir front reste identique au module Convex', () => {
    assert.deepEqual([...FRONT_RATES], [...VAT_RATES_BPS])
    for (const amount of [0, 1, 9999, 10000, 123456]) {
      for (const rate of VAT_RATES_BPS) {
        assert.equal(
          frontVatCentsFromTtc(amount, rate),
          vatCentsFromTtc(amount, rate),
        )
      }
    }
  })
})
