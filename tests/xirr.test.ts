/**
 * Pure tests for the XIRR helper (src/lib/xirr.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { xirr } from '../src/lib/xirr'

const DAY = 24 * 60 * 60 * 1000
const YEAR = 365 * DAY
const t0 = Date.UTC(2024, 0, 1)

describe('xirr', () => {
  it('one year, +10% return', () => {
    const r = xirr([
      { amount: -1000, date: t0 },
      { amount: 1100, date: t0 + YEAR },
    ])
    assert.ok(r != null)
    assert.ok(Math.abs(r - 0.1) < 1e-4, `expected ~0.10, got ${r}`)
  })

  it('doubling over one year → ~100%', () => {
    const r = xirr([
      { amount: -1000, date: t0 },
      { amount: 2000, date: t0 + YEAR },
    ])
    assert.ok(r != null)
    assert.ok(Math.abs(r - 1) < 1e-4, `expected ~1.0, got ${r}`)
  })

  it('multi-flow series with a known rate', () => {
    // Investing 1000, receiving 600 at +1y and 600 at +2y. At r=13.066%:
    //   600/1.13066 + 600/1.13066^2 ≈ 1000.
    const r = xirr([
      { amount: -1000, date: t0 },
      { amount: 600, date: t0 + YEAR },
      { amount: 600, date: t0 + 2 * YEAR },
    ])
    assert.ok(r != null)
    assert.ok(Math.abs(r - 0.13066) < 1e-3, `expected ~0.1307, got ${r}`)
  })

  it('negative IRR when capital is not yet recovered', () => {
    const r = xirr([
      { amount: -1000, date: t0 },
      { amount: 100, date: t0 + YEAR },
    ])
    assert.ok(r != null)
    assert.ok(r < 0, `expected negative, got ${r}`)
    assert.ok(Math.abs(r - -0.9) < 1e-4, `expected ~-0.90, got ${r}`)
  })

  it('unit-independent (cents give the same rate as euros)', () => {
    const euros = xirr([
      { amount: -1000, date: t0 },
      { amount: 1200, date: t0 + YEAR },
    ])
    const cents = xirr([
      { amount: -100000, date: t0 },
      { amount: 120000, date: t0 + YEAR },
    ])
    assert.ok(euros != null && cents != null)
    assert.ok(Math.abs(euros - cents) < 1e-9)
  })

  it('returns null without a sign change', () => {
    assert.equal(
      xirr([
        { amount: 1000, date: t0 },
        { amount: 500, date: t0 + YEAR },
      ]),
      null,
    )
    assert.equal(
      xirr([
        { amount: -1000, date: t0 },
        { amount: -500, date: t0 + YEAR },
      ]),
      null,
    )
  })

  it('returns null with fewer than two flows', () => {
    assert.equal(xirr([]), null)
    assert.equal(xirr([{ amount: -1000, date: t0 }]), null)
  })
})
