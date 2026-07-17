/**
 * Pure tests for the internal-transfer pair detection
 * (convex/lib/transferPairs.ts). Run via `pnpm test:unit`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectInternalTransferPairs } from '../convex/lib/transferPairs'
import type { TransferLeg } from '../convex/lib/transferPairs'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 5, 1)

const leg = (over: Partial<TransferLeg> & { id: string }): TransferLeg => ({
  bankAccountId: 'acc-a',
  direction: 'out',
  amountCents: 500000,
  dateMs: T0,
  ...over,
})

describe('detectInternalTransferPairs', () => {
  it('apparie deux jambes opposées, même montant, comptes différents, dates proches', () => {
    const paired = detectInternalTransferPairs([
      leg({ id: 'out1' }),
      leg({ id: 'in1', direction: 'in', bankAccountId: 'acc-b', dateMs: T0 + DAY }),
    ])
    assert.deepEqual([...paired].sort(), ['in1', 'out1'])
  })

  it("n'apparie ni même compte, ni montants différents, ni dates éloignées", () => {
    const paired = detectInternalTransferPairs([
      // Same account.
      leg({ id: 'out1' }),
      leg({ id: 'in1', direction: 'in', dateMs: T0 + DAY }),
      // Different amount.
      leg({ id: 'out2', amountCents: 100000 }),
      leg({ id: 'in2', direction: 'in', bankAccountId: 'acc-b', amountCents: 100001 }),
      // Too far apart.
      leg({ id: 'out3', amountCents: 200000 }),
      leg({ id: 'in3', direction: 'in', bankAccountId: 'acc-b', amountCents: 200000, dateMs: T0 + 6 * DAY }),
    ])
    assert.equal(paired.size, 0)
  })

  it('chaque jambe ne sert qu’une fois, appariement au plus proche en date', () => {
    const paired = detectInternalTransferPairs([
      leg({ id: 'out1', dateMs: T0 }),
      leg({ id: 'out2', dateMs: T0 + 3 * DAY }),
      // Closest to out1.
      leg({ id: 'in1', direction: 'in', bankAccountId: 'acc-b', dateMs: T0 + DAY }),
      // Only one inflow: out2 stays unpaired.
    ])
    assert.deepEqual([...paired].sort(), ['in1', 'out1'])
  })

  it('deux virements de même montant la même semaine s’apparient chacun avec leur jambe', () => {
    const paired = detectInternalTransferPairs([
      leg({ id: 'outA', dateMs: T0 }),
      leg({ id: 'inA', direction: 'in', bankAccountId: 'acc-b', dateMs: T0 }),
      leg({ id: 'outB', dateMs: T0 + 2 * DAY }),
      leg({ id: 'inB', direction: 'in', bankAccountId: 'acc-b', dateMs: T0 + 2 * DAY }),
    ])
    assert.deepEqual([...paired].sort(), ['inA', 'inB', 'outA', 'outB'])
  })
})
