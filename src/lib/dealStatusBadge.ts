/**
 * Single source of truth for a deal's status badge colour. The label stays with
 * the caller (`t(`status.${status}`)`); this returns only the visual (Badge
 * variant + optional tint). One rule governs the colour: it appears ONLY when
 * it carries a signal.
 *   - pending (TS)              → amber   (committed, not yet wired — no report
 *                                          exists yet, so a marker helps)
 *   - fully_exited, moic ≥ 1    → green   (realized gain)
 *   - fully_exited, moic < 1    → red     (realized loss)
 *   - written_off               → red     (loss booked, whatever the moic)
 *   - partially_exited, moic ≥ 1 → green  (realized gain on a still-open
 *                                          position; win-only — a MOIC < 1 is
 *                                          not a loss yet, so it stays neutral)
 *   - active / other            → neutral (no signal — active deals are tracked
 *                                          through their reports, not a colour)
 *
 * `moic` is the realized multiple — `DealRow.moic` (server-side) in the lists,
 * or `dealMoic(deal, txs).moic` on the deal sheet. Null/undefined ⇒ not
 * computable (no capital deployed) ⇒ neutral, never a loss.
 */

export type DealBadgeVisual = {
  variant: 'secondary' | 'outline'
  className?: string
}

// Tints mirror the former ExitBadge exactly (outline base + coloured overlay).
const WIN = 'border-positive/40 bg-positive/10 text-positive'
const LOST = 'border-destructive/40 bg-destructive/10 text-destructive'
const PENDING = 'bg-warning text-warning-foreground'

export function dealStatusBadge(
  status: string,
  moic?: number | null,
): DealBadgeVisual {
  if (status === 'pending') return { variant: 'secondary', className: PENDING }
  if (status === 'written_off') return { variant: 'outline', className: LOST }
  if (status === 'fully_exited') {
    if (moic == null) return { variant: 'secondary' }
    return moic >= 1
      ? { variant: 'outline', className: WIN }
      : { variant: 'outline', className: LOST }
  }
  // partially_exited: the position is still open, so surface a realized win
  // (green) but NEVER a loss — a MOIC < 1 on an open deal isn't a loss yet.
  if (status === 'partially_exited' && moic != null && moic >= 1) {
    return { variant: 'outline', className: WIN }
  }
  // active, and partial exits not yet in the green: neutral.
  return { variant: 'secondary' }
}
