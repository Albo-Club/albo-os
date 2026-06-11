/**
 * Semantic color classes for money movements (`positive` / `destructive`
 * tokens from brand.css) — use them everywhere a direction (inflow/outflow)
 * or a sign (receivable/debt) is displayed, for consistency.
 */

/** Amount signed by its direction: inflow in green, outflow in red. */
export function directionTone(direction: 'in' | 'out'): string {
  return direction === 'out' ? 'text-destructive' : 'text-positive'
}

/** Signed balance: positive (receivable) in green, negative (debt) in red. */
export function signTone(cents: number): string {
  return cents >= 0 ? 'text-positive' : 'text-destructive'
}

/** Tinted badge (with `variant="outline"`): inflow/receivable vs outflow/debt. */
export function directionBadgeClass(positive: boolean): string {
  return positive
    ? 'border-positive/40 bg-positive/10 text-positive'
    : 'border-destructive/40 bg-destructive/10 text-destructive'
}
