/**
 * Front-side mirror of the pure part of convex/lib/vat.ts (same convention
 * as searchText.ts) — keep both derivations identical. Tax-inclusive (TTC)
 * amounts in cents, rates in basis points, VAT always derived.
 */

/** Allowed French VAT rates, in basis points (2000 = 20 %). */
export const VAT_RATES_BPS = [0, 550, 1000, 2000] as const

/** Rate pre-filled when classifying a transaction as an expense from the UI. */
export const DEFAULT_VAT_RATE_BPS = 2000

/** VAT contained in a tax-inclusive amount: ttc × rate / (10000 + rate). */
export function vatCentsFromTtc(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / (10000 + rateBps))
}
