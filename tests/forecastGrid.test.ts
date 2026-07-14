/**
 * Pure tests for the forecast grid (convex/lib/recurrence.ts:
 * buildForecastGrid): month axis, per-cell current-month consumption,
 * overdue rollover, committed/planned projection scenarios.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildForecastGrid } from '../convex/lib/recurrence'
import type { GridEntry, GridTx } from '../convex/lib/recurrence'

// Fixed "now": 2026-07-14 12:00 UTC → current month 2026-07.
const NOW = Date.UTC(2026, 6, 14, 12)

function tx(overrides: Partial<GridTx> & { transactionDate: number }): GridTx {
  return {
    amountCents: 100,
    direction: 'out',
    category: 'general',
    ...overrides,
  }
}

function entry(overrides: Partial<GridEntry> & { date: number }): GridEntry {
  return {
    amountCents: 100,
    direction: 'out',
    confidence: 'confirmed',
    status: 'pending',
    currency: 'EUR',
    category: 'general',
    ...overrides,
  }
}

function build(
  params: Partial<Parameters<typeof buildForecastGrid>[0]> = {},
) {
  return buildForecastGrid({
    realized: [],
    entries: [],
    startingBalanceCents: 0,
    now: NOW,
    historyMonths: 2,
    horizonMonths: 3,
    ...params,
  })
}

describe('buildForecastGrid — month axis', () => {
  it('covers history … current … horizon, current month flagged', () => {
    const grid = build()
    assert.deepEqual(grid.months, [
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ])
    assert.equal(grid.currentMonthKey, '2026-07')
  })
})

describe('buildForecastGrid — layers', () => {
  it('past months carry realized only; future months split committed/planned', () => {
    const grid = build({
      realized: [
        tx({ transactionDate: Date.UTC(2026, 5, 10), amountCents: 500 }),
      ],
      entries: [
        entry({ date: Date.UTC(2026, 7, 5), amountCents: 300 }),
        entry({
          date: Date.UTC(2026, 7, 20),
          amountCents: 200,
          confidence: 'expected',
        }),
      ],
    })
    const row = grid.rows[0]
    assert.deepEqual(row.byMonth['2026-06'], {
      realizedCents: 500,
      committedCents: 0,
      plannedCents: 0,
    })
    assert.deepEqual(row.byMonth['2026-08'], {
      realizedCents: 0,
      committedCents: 300,
      plannedCents: 200,
    })
  })

  it('realized/cancelled entries and non-EUR entries never count', () => {
    const grid = build({
      entries: [
        entry({ date: Date.UTC(2026, 7, 5), status: 'realized' }),
        entry({ date: Date.UTC(2026, 7, 5), status: 'cancelled' }),
        entry({ date: Date.UTC(2026, 7, 5), currency: 'USD' }),
      ],
    })
    assert.equal(grid.rows.length, 0)
    assert.equal(grid.ignoredNonEurEntries, 1)
  })

  it('excluded realized buckets (category null) are dropped', () => {
    const grid = build({
      realized: [tx({ transactionDate: Date.UTC(2026, 5, 10), category: null })],
    })
    assert.equal(grid.rows.length, 0)
  })
})

describe('buildForecastGrid — current-month consumption', () => {
  it('realized consumes committed first, remainder stays expected', () => {
    const grid = build({
      realized: [
        tx({ transactionDate: Date.UTC(2026, 6, 5), amountCents: 1000 }),
      ],
      entries: [entry({ date: Date.UTC(2026, 6, 25), amountCents: 1500 })],
    })
    assert.deepEqual(grid.rows[0].byMonth['2026-07'], {
      realizedCents: 1000,
      committedCents: 500,
      plannedCents: 0,
    })
  })

  it('leftover realized then consumes the planned tier', () => {
    const grid = build({
      realized: [
        tx({ transactionDate: Date.UTC(2026, 6, 5), amountCents: 2000 }),
      ],
      entries: [
        entry({ date: Date.UTC(2026, 6, 20), amountCents: 1500 }),
        entry({
          date: Date.UTC(2026, 6, 28),
          amountCents: 800,
          confidence: 'probable',
        }),
      ],
    })
    assert.deepEqual(grid.rows[0].byMonth['2026-07'], {
      realizedCents: 2000,
      committedCents: 0,
      plannedCents: 300,
    })
  })

  it('consumption is per (direction, category) cell — no cross-cell bleed', () => {
    const grid = build({
      realized: [
        tx({
          transactionDate: Date.UTC(2026, 6, 5),
          amountCents: 1000,
          category: 'salaries',
        }),
      ],
      entries: [
        entry({
          date: Date.UTC(2026, 6, 25),
          amountCents: 700,
          category: 'rent',
        }),
      ],
    })
    const rent = grid.rows.find((r) => r.category === 'rent')
    assert.equal(rent?.byMonth['2026-07']?.committedCents, 700)
  })

  it('overdue pending entries roll into the current month and get consumed', () => {
    const grid = build({
      realized: [
        tx({ transactionDate: Date.UTC(2026, 6, 2), amountCents: 400 }),
      ],
      // Dated last month, never realized nor cancelled: still expected.
      entries: [entry({ date: Date.UTC(2026, 4, 30), amountCents: 1000 })],
    })
    assert.deepEqual(grid.rows[0].byMonth['2026-07'], {
      realizedCents: 400,
      committedCents: 600,
      plannedCents: 0,
    })
  })
})

describe('buildForecastGrid — projection', () => {
  it('cumulates remaining nets from the current month, two scenarios', () => {
    const grid = build({
      startingBalanceCents: 10_000,
      realized: [
        // Already moved the bank balance — must not count again.
        tx({ transactionDate: Date.UTC(2026, 6, 5), amountCents: 1000 }),
      ],
      entries: [
        // Current month: 1500 committed out → 500 remaining after consumption.
        entry({ date: Date.UTC(2026, 6, 25), amountCents: 1500 }),
        // August: 2000 committed out + 800 probable in.
        entry({ date: Date.UTC(2026, 7, 10), amountCents: 2000 }),
        entry({
          date: Date.UTC(2026, 7, 15),
          amountCents: 800,
          direction: 'in',
          confidence: 'probable',
        }),
      ],
    })
    assert.deepEqual(grid.projection[0], {
      monthKey: '2026-07',
      committedBalanceCents: 9500,
      plannedBalanceCents: 9500,
    })
    assert.deepEqual(grid.projection[1], {
      monthKey: '2026-08',
      committedBalanceCents: 7500,
      plannedBalanceCents: 8300,
    })
    // No flows after August: the balance carries flat to the horizon.
    assert.equal(grid.projection.at(-1)?.committedBalanceCents, 7500)
    assert.equal(grid.projection.at(-1)?.plannedBalanceCents, 8300)
  })

  it('projection starts at the current month (never in the past)', () => {
    const grid = build({ startingBalanceCents: 42 })
    assert.equal(grid.projection[0]?.monthKey, '2026-07')
    assert.equal(grid.projection.length, 4) // current + 3 horizon months
  })
})
