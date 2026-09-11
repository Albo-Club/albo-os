/**
 * Pure tests for report period parsing (convex/lib/reportPeriod.ts):
 * deterministic period bounds — never delegated to the LLM.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizePeriodDisplay,
  parsePeriod,
  periodRank,
} from '../convex/lib/reportPeriod'

describe('normalizePeriodDisplay', () => {
  it('translates French months and capitalizes', () => {
    assert.equal(normalizePeriodDisplay('janvier 2026'), 'January 2026')
    assert.equal(normalizePeriodDisplay('  décembre   2025 '), 'December 2025')
  })

  it('leaves already-normalized strings untouched', () => {
    assert.equal(normalizePeriodDisplay('Q4 2025'), 'Q4 2025')
    assert.equal(normalizePeriodDisplay('January 2026'), 'January 2026')
  })
})

describe('parsePeriod', () => {
  it('parses a month', () => {
    const p = parsePeriod('January 2026')
    assert.ok(p)
    assert.equal(p.startMs, Date.UTC(2026, 0, 1))
    assert.equal(p.endMs, Date.UTC(2026, 1, 1) - 1)
  })

  it('parses a quarter', () => {
    const p = parsePeriod('Q4 2025')
    assert.ok(p)
    assert.equal(p.startMs, Date.UTC(2025, 9, 1))
    assert.equal(p.endMs, Date.UTC(2026, 0, 1) - 1)
  })

  it('parses a half-year (S and H notations)', () => {
    const s1 = parsePeriod('S1 2026')
    assert.ok(s1)
    assert.equal(s1.startMs, Date.UTC(2026, 0, 1))
    assert.equal(s1.endMs, Date.UTC(2026, 6, 1) - 1)
    const h2 = parsePeriod('H2 2025')
    assert.ok(h2)
    assert.equal(h2.startMs, Date.UTC(2025, 6, 1))
  })

  it('parses a year', () => {
    const p = parsePeriod('2025')
    assert.ok(p)
    assert.equal(p.startMs, Date.UTC(2025, 0, 1))
    assert.equal(p.endMs, Date.UTC(2026, 0, 1) - 1)
  })

  it('parses a month range', () => {
    const p = parsePeriod('November - December 2025')
    assert.ok(p)
    assert.equal(p.startMs, Date.UTC(2025, 10, 1))
    assert.equal(p.endMs, Date.UTC(2026, 0, 1) - 1)
  })

  it('returns null on garbage', () => {
    assert.equal(parsePeriod('whenever'), null)
    assert.equal(parsePeriod(''), null)
  })
})

describe('periodRank', () => {
  /** Newest period first, the wider one first at equal end. */
  function order(periods: Array<string>): Array<string> {
    return [...periods].sort((a, b) => {
      const ra = periodRank(a)
      const rb = periodRank(b)
      assert.ok(ra && rb)
      return rb.endMs - ra.endMs || rb.span - ra.span
    })
  }

  it('files an annual recap above the months it covers', () => {
    // Sorting on the period START would bury "2025" under every month of the
    // year — it starts on 01/01/2025.
    assert.deepEqual(order(['January 2025', '2025', 'December 2025']), [
      '2025',
      'December 2025',
      'January 2025',
    ])
  })

  it('files a quarter above its last month, and a half above the quarter', () => {
    assert.deepEqual(order(['December 2025', 'Q4 2025', 'S2 2025']), [
      'S2 2025',
      'Q4 2025',
      'December 2025',
    ])
  })

  it('ranks a later month above an earlier wider period', () => {
    assert.deepEqual(order(['2025', 'January 2026']), ['January 2026', '2025'])
  })

  it('gives a month range the width of its span', () => {
    const range = periodRank('November - December 2025')
    const month = periodRank('December 2025')
    assert.ok(range && month)
    assert.equal(range.endMs, month.endMs)
    assert.ok(range.span > month.span)
  })

  it('returns null on an unparseable period', () => {
    assert.equal(periodRank('whenever'), null)
  })
})
