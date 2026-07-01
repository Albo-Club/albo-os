/**
 * Pure tests for the portfolio metrics (convex/lib/metrics.ts): the single
 * source of truth for MOIC / TVPI / DPI / annualized TRI / residual value.
 * Amounts in cents, one day-count (actual/365).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MS_PER_YEAR,
  annualizedTri,
  dpi,
  moic,
  proceedsFromReceived,
  residualValueCents,
  sumCashflows,
  tvpi,
} from '../convex/lib/metrics'

describe('sumCashflows', () => {
  const txs = [
    { direction: 'out' as const, amount: 100000 }, // capital deployed
    { direction: 'in' as const, amount: 12000 }, // proceeds received (TTC)
  ]

  it('capital is Σ outgoing, never de-VAT (royalty)', () => {
    // Capital stays gross even for royalties.
    assert.equal(sumCashflows(txs, 'royalty').capital, 100000)
    assert.equal(sumCashflows(txs, 'share').capital, 100000)
  })

  it('proceeds de-VAT ÷1.2 only for royalty, gross otherwise', () => {
    assert.equal(sumCashflows(txs, 'royalty').proceeds, 12000 / 1.2)
    assert.equal(sumCashflows(txs, 'share').proceeds, 12000)
  })

  it('empty transactions → zero capital and proceeds', () => {
    assert.deepEqual(sumCashflows([], 'royalty'), { capital: 0, proceeds: 0 })
  })
})

describe('proceedsFromReceived', () => {
  it('matches the per-transaction de-VAT on the aggregate', () => {
    assert.equal(proceedsFromReceived(12000, 'royalty'), 12000 / 1.2)
    assert.equal(proceedsFromReceived(12000, 'share'), 12000)
  })
})

describe('residualValueCents', () => {
  it('0 once fully exited or written off', () => {
    assert.equal(
      residualValueCents({
        status: 'fully_exited',
        lastValuationCents: 50000,
        paidActual: 30000,
      }),
      0,
    )
    assert.equal(
      residualValueCents({
        status: 'written_off',
        lastValuationCents: 50000,
        paidActual: 30000,
      }),
      0,
    )
  })

  it('last valuation, falling back to cost then 0', () => {
    assert.equal(
      residualValueCents({
        status: 'active',
        lastValuationCents: 50000,
        paidActual: 30000,
      }),
      50000,
    )
    assert.equal(
      residualValueCents({
        status: 'active',
        lastValuationCents: null,
        paidActual: 30000,
      }),
      30000,
    )
    assert.equal(
      residualValueCents({
        status: 'active',
        lastValuationCents: null,
        paidActual: null,
      }),
      0,
    )
  })
})

describe('moic', () => {
  it('proceeds / capital', () => {
    assert.equal(moic({ capital: 100000, proceeds: 150000 }), 1.5)
  })

  it('null when no capital was deployed', () => {
    assert.equal(moic({ capital: 0, proceeds: 150000 }), null)
    assert.equal(moic({ capital: -1, proceeds: 150000 }), null)
  })
})

describe('tvpi', () => {
  it('(received + residual) / capital, on the GROSS received', () => {
    // 12000 received (gross, not de-VAT'd) + 50000 residual over 100000 paid.
    assert.equal(
      tvpi({ capital: 100000, proceeds: 12000, residual: 50000 }),
      0.62,
    )
  })

  it('null when capital <= 0', () => {
    assert.equal(tvpi({ capital: 0, proceeds: 12000, residual: 50000 }), null)
  })
})

describe('dpi', () => {
  it('distributed / called', () => {
    assert.equal(dpi({ called: 100000, distributed: 40000 }), 0.4)
  })

  it('null when nothing was called', () => {
    assert.equal(dpi({ called: 0, distributed: 40000 }), null)
  })
})

describe('annualizedTri', () => {
  const entryDate = 0
  const exitDate = MS_PER_YEAR // exactly one year

  it('MOIC^(1/years) − 1 over a positive holding period', () => {
    assert.equal(annualizedTri({ moic: 2, entryDate, exitDate }), 1)
    // Over two years, a 4× is a 100 % annualized return.
    assert.equal(
      annualizedTri({ moic: 4, entryDate, exitDate: MS_PER_YEAR * 2 }),
      1,
    )
  })

  it('total loss (MOIC = 0) yields −100 %', () => {
    assert.equal(annualizedTri({ moic: 0, entryDate, exitDate }), -1)
  })

  it('null when MOIC unknown, dates missing, or period not positive', () => {
    assert.equal(annualizedTri({ moic: null, entryDate, exitDate }), null)
    assert.equal(annualizedTri({ moic: 2, entryDate: null, exitDate }), null)
    assert.equal(annualizedTri({ moic: 2, entryDate, exitDate: null }), null)
    assert.equal(annualizedTri({ moic: 2, entryDate: 10, exitDate: 10 }), null)
    assert.equal(annualizedTri({ moic: 2, entryDate: 20, exitDate: 10 }), null)
  })

  it('day-count is actual/365', () => {
    assert.equal(MS_PER_YEAR, 365 * 24 * 60 * 60 * 1000)
  })
})
