/**
 * Guard for `isPerformanceDeal` (convex/lib/instrumentMapping.ts): which deals
 * count as an INVESTMENT in the performance figures — deployed, distributed,
 * NAV, and the MOIC / TVPI / IRR ratios.
 *
 * The exclusion list is asserted EXHAUSTIVELY on purpose. A kind joining or
 * leaving the `management` archetype silently moves money in and out of every
 * KPI, so it must be a deliberate edit here, not a side effect elsewhere.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { INSTRUMENTS } from '../convex/lib/instruments'
import { isPerformanceDeal } from '../convex/lib/instrumentMapping'

/** The kinds deliberately kept out of the performance figures. */
const NON_PERFORMANCE = ['lead_spv']

describe('isPerformanceDeal', () => {
  it('excludes exactly the compensation kinds, nothing else', () => {
    const excluded = INSTRUMENTS.filter((kind) => !isPerformanceDeal(kind))
    assert.deepEqual([...excluded].sort(), [...NON_PERFORMANCE].sort())
  })

  it('lead_spv is SPV-management revenue, not an investment', () => {
    assert.equal(isPerformanceDeal('lead_spv'), false)
  })

  it('carry_vehicle stays an investment (the stake is real capital out)', () => {
    assert.equal(isPerformanceDeal('carry_vehicle'), true)
  })

  it('an unknown kind counts as an investment', () => {
    // The fallback must never drop money out of the totals in silence.
    assert.equal(isPerformanceDeal('some_future_kind'), true)
  })
})
