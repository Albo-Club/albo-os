/**
 * Pure tests for the "plan vs actual" series (src/lib/projectionSeries.ts):
 * period alignment, cumulative sums, gap vs the revised plan (falling back
 * to the initial one), clamping of transactions before the first period.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlanVsActual } from '../src/lib/projectionSeries'

const JAN = Date.UTC(2026, 0, 1)
const JUL = Date.UTC(2026, 6, 1)
const JAN_27 = Date.UTC(2027, 0, 1)

describe('buildPlanVsActual', () => {
  it('aucune projection → aucune ligne (le réalisé seul ne suffit pas)', () => {
    const rows = buildPlanVsActual({
      initial: [],
      revised: [],
      actuals: [{ transactionDate: JAN, amount: 100, direction: 'in' }],
    })
    assert.deepEqual(rows, [])
  })

  it('cumuls par version et net in − out', () => {
    const rows = buildPlanVsActual({
      initial: [
        { period: JAN, amountCents: 10_000, direction: 'in' },
        { period: JAN, amountCents: 2_000, direction: 'out' },
        { period: JUL, amountCents: 10_000, direction: 'in' },
      ],
      revised: [],
      actuals: [],
    })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].initialCents, 8_000) // 10 000 in − 2 000 out
    assert.equal(rows[1].initialCumCents, 18_000)
  })

  it("l'écart cumulé se mesure contre le BP révisé quand il existe", () => {
    const rows = buildPlanVsActual({
      initial: [{ period: JAN, amountCents: 10_000, direction: 'in' }],
      revised: [{ period: JAN, amountCents: 6_000, direction: 'in' }],
      actuals: [{ transactionDate: JAN + 1000, amount: 5_000, direction: 'in' }],
    })
    assert.equal(rows[0].actualCumCents, 5_000)
    // vs revised (6 000), not vs initial (10 000)
    assert.equal(rows[0].gapCumCents, -1_000)
  })

  it('sans BP révisé, la référence est le BP initial', () => {
    const rows = buildPlanVsActual({
      initial: [{ period: JAN, amountCents: 10_000, direction: 'in' }],
      revised: [],
      actuals: [{ transactionDate: JAN + 1000, amount: 4_000, direction: 'in' }],
    })
    assert.equal(rows[0].gapCumCents, -6_000)
  })

  it('le réalisé est rangé dans la bonne période, clamp avant la première', () => {
    const rows = buildPlanVsActual({
      initial: [
        { period: JAN, amountCents: 1_000, direction: 'in' },
        { period: JUL, amountCents: 1_000, direction: 'in' },
        { period: JAN_27, amountCents: 1_000, direction: 'in' },
      ],
      revised: [],
      actuals: [
        // before the 1st period → clamped to January 2026
        { transactionDate: Date.UTC(2025, 5, 1), amount: 100, direction: 'in' },
        // between July 2026 and January 2027 → July 2026
        { transactionDate: Date.UTC(2026, 9, 15), amount: 200, direction: 'in' },
        // after the last period → last period
        { transactionDate: Date.UTC(2027, 5, 1), amount: 300, direction: 'out' },
      ],
    })
    assert.equal(rows[0].actualCents, 100)
    assert.equal(rows[1].actualCents, 200)
    assert.equal(rows[2].actualCents, -300)
    assert.equal(rows[2].actualCumCents, 0)
  })

  it('les périodes des deux versions sont fusionnées et triées', () => {
    const rows = buildPlanVsActual({
      initial: [{ period: JUL, amountCents: 1_000, direction: 'in' }],
      revised: [{ period: JAN, amountCents: 500, direction: 'in' }],
      actuals: [],
    })
    assert.deepEqual(
      rows.map((r) => r.period),
      [JAN, JUL],
    )
    assert.equal(rows[1].initialCumCents, 1_000)
    assert.equal(rows[1].revisedCumCents, 500)
  })
})
