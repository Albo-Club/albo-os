/**
 * Pure tests for the royalties panel logic (src/lib/royalties.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildRoyaltyRows,
  normalizeQuarter,
  parseAmountToCents,
  parseBpPaste,
} from '../src/lib/royalties'

describe('parseAmountToCents', () => {
  it('plain integer euros → cents', () => {
    assert.equal(parseAmountToCents('12000'), 1200000)
  })

  it('French format with non-breaking space and € → cents', () => {
    assert.equal(parseAmountToCents('12 000,00 €'), 1200000)
    assert.equal(parseAmountToCents('1 234,50'), 123450)
  })

  it('US format with comma thousands and dot decimal → cents', () => {
    assert.equal(parseAmountToCents('12,000.00'), 1200000)
    assert.equal(parseAmountToCents('1,234.56'), 123456)
  })

  it('lone comma: 3 digits = thousands, else decimal', () => {
    assert.equal(parseAmountToCents('12,000'), 1200000)
    assert.equal(parseAmountToCents('12,50'), 1250)
  })

  it('space grouping forces the comma to be decimal (not thousands)', () => {
    // Regression: "311 995,152" used to be read as the integer 311995152
    // (comma + 3 digits → thousands) then ×100 → an absurd 311 995 152 €.
    // The space already grouped the thousands, so the comma is the decimal.
    assert.equal(parseAmountToCents('311 995,152'), 31199515)
    assert.equal(parseAmountToCents('174 300,00 €'), 17430000)
    assert.equal(parseAmountToCents('12 000'), 1200000)
    assert.equal(parseAmountToCents('12,000.00'), 1200000)
  })

  it('rejects non-numeric / negative', () => {
    assert.equal(parseAmountToCents('abc'), null)
    assert.equal(parseAmountToCents('-5'), null)
    assert.equal(parseAmountToCents(''), null)
  })
})

describe('normalizeQuarter', () => {
  it('canonicalizes FR/EN markers in any order', () => {
    assert.equal(normalizeQuarter('Q3 2025'), 'Q3 2025')
    assert.equal(normalizeQuarter('T3 2025'), 'Q3 2025')
    assert.equal(normalizeQuarter('2025-Q3'), 'Q3 2025')
    assert.equal(normalizeQuarter('3T 2025'), 'Q3 2025')
  })

  it('returns null when quarter or year is missing', () => {
    assert.equal(normalizeQuarter('2025'), null)
    assert.equal(normalizeQuarter('Q3'), null)
    assert.equal(normalizeQuarter(''), null)
  })
})

describe('parseBpPaste', () => {
  it('parses tab-separated rows, skips bad lines, dedups quarters', () => {
    const text = 'Q3 2025\t12000\nQ4 2025\t13500\nbad line\nQ3 2025\t99999'
    const { rows, skipped } = parseBpPaste(text)
    assert.equal(skipped, 1)
    assert.deepEqual(rows, [
      { quarter: 'Q3 2025', plannedRevenue: 9999900 }, // last wins on dedup
      { quarter: 'Q4 2025', plannedRevenue: 1350000 },
    ])
  })

  it('sorts chronologically across years', () => {
    const { rows } = parseBpPaste('Q1 2026\t100\nQ4 2025\t200')
    assert.deepEqual(
      rows.map((r) => r.quarter),
      ['Q4 2025', 'Q1 2026'],
    )
  })
})

describe('buildRoyaltyRows', () => {
  // capital ignored here; depreciation 20% (2000 bps), royalty 2.17% (217 bps).
  const bp = [
    { quarter: 'Q3 2025', plannedRevenue: 1000000 }, // 10 000 €
    { quarter: 'Q4 2025', plannedRevenue: 2000000 },
  ]
  const actuals = [{ quarter: 'Q3 2025', actualRevenue: 900000 }] // 9 000 €

  it('derives degraded BP, royalties and the gap', () => {
    const { rows } = buildRoyaltyRows(bp, actuals, 2000, 217)
    const q3 = rows.find((r) => r.quarter === 'Q3 2025')!
    assert.equal(q3.plannedRevenue, 1000000)
    assert.equal(q3.degradedRevenue, 800000) // 1 000 000 × 0.8
    assert.equal(q3.actualRevenue, 900000)
    assert.equal(q3.plannedRoyalty, 21700) // 1 000 000 × 0.0217
    assert.equal(q3.degradedRoyalty, 17360) // 800 000 × 0.0217
    assert.equal(q3.actualRoyalty, 19530) // 900 000 × 0.0217
    assert.equal(q3.gapAbs, 2170) // 19 530 - 17 360 (actual > degraded)
    assert.ok(q3.gapPct && q3.gapPct > 0)
  })

  it('leaves a row without actuals with an undefined gap', () => {
    const { rows } = buildRoyaltyRows(bp, actuals, 2000, 217)
    const q4 = rows.find((r) => r.quarter === 'Q4 2025')!
    assert.equal(q4.actualRevenue, undefined)
    assert.equal(q4.gapAbs, undefined)
  })

  it('accumulates column totals', () => {
    const { totals } = buildRoyaltyRows(bp, actuals, 2000, 217)
    assert.equal(totals.plannedRevenue, 3000000)
    assert.equal(totals.degradedRevenue, 2400000)
    assert.equal(totals.actualRevenue, 900000)
    assert.equal(totals.gapAbs, 2170) // only Q3 has an actual
  })
})
