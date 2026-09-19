/**
 * Guard for `tracksValuation` (convex/lib/instrumentMapping.ts): which deals
 * carry a valuation history — the rows read back as the line's current value,
 * which feed the TVPI of the participations list, the pledge margins, the
 * agent and the MCP.
 *
 * The list is asserted EXHAUSTIVELY on purpose (ALB-248). Opening a kind is a
 * decision about who provides the figure and how often, so it must be a
 * deliberate edit here, not a side effect elsewhere.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { INSTRUMENTS } from '../convex/lib/instruments'
import {
  TREASURY_PLACEMENT_KINDS,
  tracksValuation,
} from '../convex/lib/instrumentMapping'

/** The kinds that carry a valuation history, as arbitrated. */
const TRACKED = [
  'share',
  'spv_share',
  'bsa',
  'safe',
  'bsa_air',
  'oc',
  'convertible_note',
  'carry_vehicle',
  'os',
  'loan',
  'cca',
  'fund_lp',
  'scpi',
]

describe('tracksValuation', () => {
  it('tracks exactly the arbitrated kinds, nothing else', () => {
    const tracked = INSTRUMENTS.filter((kind) => tracksValuation(kind))
    assert.deepEqual([...tracked].sort(), [...TRACKED].sort())
  })

  it('leaves the treasury placements out (they value via currentValue)', () => {
    // Their balance field and the statement import already write the rows;
    // a second path would drift the Placements balance from the last value.
    for (const kind of TREASURY_PLACEMENT_KINDS) {
      assert.equal(tracksValuation(kind), false, kind)
    }
  })

  it('leaves out what is valued elsewhere or is not a position', () => {
    // A building is valued in the real-estate module, royalties are worth
    // their remaining flows, lead_spv is management revenue, and `unknown`
    // waits for its real instrument.
    assert.equal(tracksValuation('real_estate_direct'), false)
    assert.equal(tracksValuation('royalty'), false)
    assert.equal(tracksValuation('lead_spv'), false)
    assert.equal(tracksValuation('unknown'), false)
  })

  it('an unknown kind tracks nothing', () => {
    assert.equal(tracksValuation('some_future_kind'), false)
  })
})
