/**
 * TVA — helpers partagés entre schéma, mutations, queries et outils agent.
 * La dérivation pure est miroir de src/lib/vat.ts (même convention que
 * searchText.ts), testée via node:test (tests/vat.test.ts).
 *
 * Convention (cf. KNOWN_ISSUES.md « TVA récupérable ») : les montants de
 * transaction sont toujours TTC en cents ; le taux est stocké en basis
 * points sur les transactions `charge` / `product` uniquement ; le montant
 * de TVA est TOUJOURS dérivé, jamais stocké.
 */

import { v } from 'convex/values'

/** Taux de TVA français autorisés, en basis points (2000 = 20 %). */
export const VAT_RATES_BPS = [0, 550, 1000, 2000] as const

export type VatRateBps = (typeof VAT_RATES_BPS)[number]

export const vatRateBpsValidator = v.union(
  v.literal(0),
  v.literal(550),
  v.literal(1000),
  v.literal(2000),
)

/** TVA contenue dans un montant TTC : ttc × taux / (10000 + taux). */
export function vatCentsFromTtc(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / (10000 + rateBps))
}
