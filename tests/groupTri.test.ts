/**
 * Company-level TRI: the whole point of moving the computation server-side.
 *
 * IRR is NOT additive — a company's TRI can't be derived from its per-deal
 * TRIs. It must be solved on the UNION of the company's dated flows. This test
 * pins that exact XIRR on a concrete 2-deal company (different entry/exit
 * dates) and shows it diverges materially from the old two-point approximation
 * (`annualizedTri` on the aggregate MOIC over earliest-entry → latest-exit),
 * which is what the participations list used to display.
 *
 * Run with Node's native test runner via tsx:
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MS_PER_YEAR,
  annualizedTri,
  moic,
  proceedsFromReceived,
  realizedCashflows,
} from '../convex/lib/metrics'
import { xirr } from '../src/lib/xirr'

// Clean 365-day years so the actual/365 day-count yields exact year fractions
// (leap years would otherwise nudge the pinned rate).
const YEAR = MS_PER_YEAR
const t0 = Date.UTC(2020, 0, 1)

/** NPV of dated flows at annual rate `r` (actual/365) — the IRR defining check. */
function npv(flows: Array<{ amount: number; date: number }>, r: number): number {
  const base = Math.min(...flows.map((f) => f.date))
  return flows.reduce(
    (s, f) => s + f.amount / Math.pow(1 + r, (f.date - base) / MS_PER_YEAR),
    0,
  )
}

describe('company-level TRI (union of dated flows)', () => {
  // Deal A (share): −100 000 € at t0, +150 000 € one year later → 1.5× in 1y.
  // Deal B (share): −100 000 € at t0+2y, +120 000 € at t0+4y  → 1.2× over 2y.
  const dealA = realizedCashflows(
    [
      { direction: 'out', amount: 100000, date: t0 },
      { direction: 'in', amount: 150000, date: t0 + 1 * YEAR },
    ],
    'share',
  )
  const dealB = realizedCashflows(
    [
      { direction: 'out', amount: 100000, date: t0 + 2 * YEAR },
      { direction: 'in', amount: 120000, date: t0 + 4 * YEAR },
    ],
    'share',
  )
  const union = [...dealA, ...dealB]

  it('exact XIRR solves the union (NPV ≈ 0 at the returned rate)', () => {
    const exact = xirr(union)
    assert.ok(exact != null)
    // Defining property of the IRR: the discounted flows net to zero.
    assert.ok(Math.abs(npv(union, exact)) < 1e-2, `NPV not ~0: ${npv(union, exact)}`)
    // Pinned value (~28.6 %/yr) — money-weighted, pulled up by deal A's 50 %/yr.
    assert.ok(Math.abs(exact - 0.2864) < 5e-3, `expected ~0.286, got ${exact}`)
  })

  it('diverges materially from the old two-point approximation', () => {
    const exact = xirr(union)
    assert.ok(exact != null)

    // Old approach: aggregate MOIC over the company, annualized between the
    // earliest entry and the latest exit (here t0 → t0+4y, 4 years).
    const capital = 100000 + 100000
    const proceeds =
      proceedsFromReceived(150000, 'share') + proceedsFromReceived(120000, 'share')
    const companyMoic = moic({ capital, proceeds })
    assert.equal(companyMoic, 1.35)
    const approx = annualizedTri({
      moic: companyMoic,
      entryDate: t0,
      exitDate: t0 + 4 * YEAR,
    })
    assert.ok(approx != null)
    assert.ok(Math.abs(approx - 0.0779) < 1e-3, `expected ~7.8 %, got ${approx}`)

    // ~28.6 % (exact) vs ~7.8 % (approx): >20 points apart — the approximation
    // stretched everything over 4 years and ignored each flow's real timing.
    assert.ok(exact - approx > 0.15, `expected >15pt gap, got ${exact - approx}`)
  })

  it('is null (shown "—") for a total loss with no proceeds', () => {
    // A written-off company: only outflows, no sign change → IRR undefined.
    const flows = realizedCashflows(
      [
        { direction: 'out', amount: 100000, date: t0 },
        { direction: 'out', amount: 50000, date: t0 + 1 * YEAR },
      ],
      'share',
    )
    assert.equal(xirr(flows), null)
  })
})
