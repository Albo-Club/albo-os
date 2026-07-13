/**
 * Pure tests for report period parsing (convex/lib/reportPeriod.ts):
 * deterministic period bounds — never delegated to the LLM.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizePeriodDisplay, parsePeriod } from '../convex/lib/reportPeriod'

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
