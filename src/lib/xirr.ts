/**
 * XIRR — internal rate of return for irregularly-dated cash flows.
 *
 * Pure, dependency-free (mirrors src/lib/royalties.ts so it stays testable).
 * Used by the royalties panel to annualize the realized performance of a deal:
 * one outflow (invested capital at investmentDate) plus the dated incoming
 * transactions (de-VAT'd HT). Day-count is actual/365.
 *
 * Convention: amounts are signed (negative = outflow, positive = inflow). The
 * unit is free as long as it is consistent across flows — cents work fine since
 * the result is a ratio.
 */

export type CashFlow = { amount: number; date: number /* ms epoch */ }

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

/** Net present value of `flows` at annual rate `rate`, discounted from t0. */
function npv(flows: Array<CashFlow>, rate: number, t0: number): number {
  let sum = 0
  for (const f of flows) {
    const years = (f.date - t0) / MS_PER_YEAR
    sum += f.amount / Math.pow(1 + rate, years)
  }
  return sum
}

/** Derivative of `npv` with respect to `rate` (for Newton-Raphson). */
function dNpv(flows: Array<CashFlow>, rate: number, t0: number): number {
  let sum = 0
  for (const f of flows) {
    const years = (f.date - t0) / MS_PER_YEAR
    if (years === 0) continue
    sum += (-years * f.amount) / Math.pow(1 + rate, years + 1)
  }
  return sum
}

/**
 * Annualized internal rate of return (decimal, e.g. 0.10 = 10 %), or null when
 * it can't be solved: fewer than two flows, no sign change (a series that is
 * all-positive or all-negative has no IRR), or no convergence.
 *
 * Newton-Raphson from a 10 % guess, with a bisection fallback on
 * [-0.9999, 10] when the iteration diverges or the derivative vanishes.
 */
export function xirr(flows: Array<CashFlow>): number | null {
  if (flows.length < 2) return null

  const hasPositive = flows.some((f) => f.amount > 0)
  const hasNegative = flows.some((f) => f.amount < 0)
  if (!hasPositive || !hasNegative) return null

  const t0 = Math.min(...flows.map((f) => f.date))

  // Newton-Raphson.
  let rate = 0.1
  for (let i = 0; i < 100; i++) {
    const value = npv(flows, rate, t0)
    if (Math.abs(value) < 1e-7) return rate
    const slope = dNpv(flows, rate, t0)
    if (slope === 0 || !Number.isFinite(slope)) break
    const next = rate - value / slope
    if (!Number.isFinite(next) || next <= -1) break
    if (Math.abs(next - rate) < 1e-9) return next
    rate = next
  }

  // Bisection fallback. Requires a sign change of NPV across the bracket.
  let lo = -0.9999
  let hi = 10
  let fLo = npv(flows, lo, t0)
  let fHi = npv(flows, hi, t0)
  if (fLo === 0) return lo
  if (fHi === 0) return hi
  if (fLo * fHi > 0) return null

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(flows, mid, t0)
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid
    if (fLo * fMid < 0) {
      hi = mid
      fHi = fMid
    } else {
      lo = mid
      fLo = fMid
    }
  }
  return (lo + hi) / 2
}
