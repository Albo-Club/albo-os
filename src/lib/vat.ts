/**
 * Miroir front de la partie pure de convex/lib/vat.ts (même convention que
 * searchText.ts) — garder les deux dérivations identiques. Montants TTC en
 * cents, taux en basis points, TVA toujours dérivée.
 */

/** Taux de TVA français autorisés, en basis points (2000 = 20 %). */
export const VAT_RATES_BPS = [0, 550, 1000, 2000] as const

/** Taux pré-rempli quand on classe une transaction en charge depuis l'UI. */
export const DEFAULT_VAT_RATE_BPS = 2000

/** TVA contenue dans un montant TTC : ttc × taux / (10000 + taux). */
export function vatCentsFromTtc(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / (10000 + rateBps))
}
