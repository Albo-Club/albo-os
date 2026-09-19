/**
 * Pure tests for the capital & valuation position
 * (convex/lib/capitalPosition.ts): entry read from the deal, current point
 * from the latest capital event, nothing stored.
 *
 * Reference case: ACT Running (ALB-248). Entry in September 2025 at 80 €,
 * 313 shares, 37 500 outstanding (post-money 3 000 000 €); the December 2025
 * round at the SAME price adds 2 500 shares → 40 000 outstanding, post-money
 * 3 200 000 €. Our line is worth the same 25 040 €, our stake dilutes from
 * 0.83 % to 0.78 %, and it is not a down round.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeCapitalPosition } from '../convex/lib/capitalPosition'
import type {
  CapitalEventInput,
  EntryDealInput,
} from '../convex/lib/capitalPosition'

const SEPT_2025 = Date.UTC(2025, 8, 5)
const DEC_2025 = Date.UTC(2025, 11, 10)

const actEntry: EntryDealInput = {
  dealId: 'deal-act',
  asOf: SEPT_2025,
  sharesAcquired: 313,
  pricePerShareCents: 80_00,
  postMoneyCents: 3_000_000_00,
  ownershipBps: 83, // 0.83 % as recorded on the deal
  costCents: 25_040_00,
}

const decemberRound: CapitalEventInput = {
  eventId: 'ev-dec',
  asOf: DEC_2025,
  kind: 'round',
  pricePerShareCents: 80_00,
  sharesIssued: 2_500,
  totalSharesAfter: 40_000,
}

describe('computeCapitalPosition — ACT Running', () => {
  it('without any event, current is the entry and nothing has moved', () => {
    const pos = computeCapitalPosition([actEntry], [], null)
    assert.equal(pos.unchanged, true)
    assert.equal(pos.downRound, false)
    assert.equal(pos.sharesHeld, 313)
    assert.equal(pos.costCents, 25_040_00)
    assert.equal(pos.entry.postMoneyCents, 3_000_000_00)
    assert.equal(pos.entry.pricePerShareCents, 80_00)
    // Outstanding count derived from the deal: 3 000 000 € ÷ 80 €.
    assert.equal(pos.entry.totalShares, 37_500)
    // The recorded stake wins over the ratio on the entry.
    assert.equal(pos.entry.ownershipBps, 83)
    assert.deepEqual(pos.current, pos.entry)
    assert.equal(pos.valueCents, 25_040_00)
    assert.equal(pos.timeline.length, 1)
    assert.equal(pos.timeline[0].kind, 'entry')
  })

  it('the December round dilutes the stake without moving the value', () => {
    const pos = computeCapitalPosition([actEntry], [decemberRound], null)
    assert.equal(pos.unchanged, false)
    assert.equal(pos.downRound, false)
    assert.equal(pos.current.asOf, DEC_2025)
    assert.equal(pos.current.totalShares, 40_000)
    assert.equal(pos.current.postMoneyCents, 3_200_000_00)
    assert.equal(pos.current.pricePerShareCents, 80_00)
    // 313 / 40 000 = 0.7825 % → 78 bps.
    assert.equal(pos.current.ownershipBps, 78)
    assert.equal(pos.valueCents, 25_040_00)
    assert.deepEqual(
      pos.timeline.map((p) => [p.kind, p.postMoneyCents]),
      [
        ['entry', 3_000_000_00],
        ['round', 3_200_000_00],
      ],
    )
  })

  it('a later round below the entry price is a down round', () => {
    const pos = computeCapitalPosition(
      [actEntry],
      [{ ...decemberRound, pricePerShareCents: 50_00 }],
      null,
    )
    assert.equal(pos.downRound, true)
    assert.equal(pos.valueCents, 313 * 50_00)
    assert.equal(pos.current.postMoneyCents, 40_000 * 50_00)
  })

  it('events are ordered by date whatever the input order', () => {
    const earlier: CapitalEventInput = {
      ...decemberRound,
      eventId: 'ev-oct',
      asOf: Date.UTC(2025, 9, 1),
      totalSharesAfter: 38_000,
    }
    const pos = computeCapitalPosition(
      [actEntry],
      [decemberRound, earlier],
      null,
    )
    assert.deepEqual(
      pos.timeline.map((p) => p.id),
      ['deal-act', 'ev-oct', 'ev-dec'],
    )
    assert.equal(pos.current.totalShares, 40_000)
  })

  it('a deal without post-money falls back on the company share count', () => {
    const bare: EntryDealInput = {
      ...actEntry,
      postMoneyCents: null,
      ownershipBps: null,
    }
    const pos = computeCapitalPosition([bare], [], 37_500)
    assert.equal(pos.entry.totalShares, 37_500)
    assert.equal(pos.entry.postMoneyCents, 37_500 * 80_00)
    // No recorded stake: the ratio on the outstanding count.
    assert.equal(pos.entry.ownershipBps, 83)
  })

  it('a second share deal adds to the shares held and the cost', () => {
    const followOn: EntryDealInput = {
      dealId: 'deal-act-2',
      asOf: DEC_2025,
      sharesAcquired: 100,
      pricePerShareCents: 80_00,
      postMoneyCents: 3_200_000_00,
      ownershipBps: null,
      costCents: 8_000_00,
    }
    const pos = computeCapitalPosition([followOn, actEntry], [], null)
    assert.equal(pos.sharesHeld, 413)
    assert.equal(pos.costCents, 33_040_00)
    // The entry stays the FIRST deal.
    assert.equal(pos.entry.asOf, SEPT_2025)
    assert.equal(pos.entry.ownershipBps, 83)
    assert.equal(pos.timeline[0].id, 'deal-act')
  })

  it('without any share deal, everything is empty and nothing throws', () => {
    const pos = computeCapitalPosition([], [], null)
    assert.equal(pos.sharesHeld, 0)
    assert.equal(pos.entry.postMoneyCents, null)
    assert.equal(pos.valueCents, null)
    assert.equal(pos.timeline.length, 0)
  })
})
