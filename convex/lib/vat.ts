/**
 * VAT — helpers shared between schema, mutations, queries and agent tools.
 * The pure derivation mirrors src/lib/vat.ts (same convention as
 * searchText.ts), tested via node:test (tests/vat.test.ts).
 *
 * Convention (cf. KNOWN_ISSUES.md « TVA récupérable »): transaction amounts
 * are always VAT-inclusive (TTC) in cents; the rate is stored in basis
 * points on `charge` / `product` transactions only; the VAT amount is
 * ALWAYS derived, never stored.
 */

import { v } from 'convex/values'

/** Allowed French VAT rates, in basis points (2000 = 20 %). */
export const VAT_RATES_BPS = [0, 550, 1000, 2000] as const

export type VatRateBps = (typeof VAT_RATES_BPS)[number]

export const vatRateBpsValidator = v.union(
  v.literal(0),
  v.literal(550),
  v.literal(1000),
  v.literal(2000),
)

/** VAT contained in a VAT-inclusive (TTC) amount: ttc × rate / (10000 + rate). */
export function vatCentsFromTtc(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / (10000 + rateBps))
}
