/**
 * Single source of truth for a deal's status badge colour. The label stays with
 * the caller (`t(`status.${status}`)`); this returns only the visual (Badge
 * variant + optional tint). The colour is the one the participations list uses
 * for its section bands (`participationBucketBand`), so a deal reads the same
 * everywhere: one badge, one palette.
 *   - pending (TS)               → amber   (committed, not yet wired)
 *   - active                     → blue    (position open)
 *   - fully_exited, moic ≥ 1     → green   (realized gain)
 *   - fully_exited, moic < 1     → red     (realized loss)
 *   - written_off                → red     (loss booked, whatever the moic)
 *   - fully_exited, moic unknown → neutral (outcome not computable — never
 *                                           claim a win nor a loss)
 *
 * `moic` is the realized multiple — `DealRow.moic` (server-side) in the lists,
 * or `dealMoic(deal, txs).moic` on the deal sheet. Null/undefined ⇒ not
 * computable (no capital deployed).
 */

export type DealBadgeVisual = {
  variant: 'secondary' | 'outline'
  className?: string
}

/** Status buckets the participations list splits into (one table each). */
export type ParticipationBucket = 'pending' | 'active' | 'exit_win' | 'exit_loss'

// Light tints (outline base + coloured overlay): readable on both themes.
const BUCKET_TINT: Record<ParticipationBucket, string> = {
  pending: 'border-warning/40 bg-warning/10 text-warning',
  active: 'border-info/40 bg-info/10 text-info',
  exit_win: 'border-positive/40 bg-positive/10 text-positive',
  exit_loss: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/**
 * Which participations bucket a single deal belongs to — same decision tree as
 * the company-level split in `ParticipationsView`. Returns null when a settled
 * deal has no computable MOIC (neither a win nor a loss).
 */
export function dealBucket(
  status: string,
  moic?: number | null,
): ParticipationBucket | null {
  if (status === 'pending') return 'pending'
  if (status === 'written_off') return 'exit_loss'
  if (status === 'fully_exited') {
    if (moic == null) return null
    return moic >= 1 ? 'exit_win' : 'exit_loss'
  }
  return 'active'
}

export function dealStatusBadge(
  status: string,
  moic?: number | null,
): DealBadgeVisual {
  const bucket = dealBucket(status, moic)
  if (bucket == null) return { variant: 'secondary' }
  return { variant: 'outline', className: BUCKET_TINT[bucket] }
}

/**
 * Tinted section band above each participations table (it replaces the
 * per-row accent bar): a softly tinted background + a solid status dot, on
 * the same amber/blue/green/red palette as the badges. Colours live here
 * only — never hardcode them at a call site.
 */
export function participationBucketBand(bucket: ParticipationBucket): {
  band: string
  dot: string
} {
  switch (bucket) {
    case 'pending':
      return { band: 'bg-warning/10', dot: 'bg-warning' }
    case 'active':
      return { band: 'bg-info/10', dot: 'bg-info' }
    case 'exit_win':
      return { band: 'bg-positive/10', dot: 'bg-positive' }
    case 'exit_loss':
      return { band: 'bg-destructive/10', dot: 'bg-destructive' }
  }
}

/**
 * i18n label key (participations `status.*`) matching the badge/accent
 * outcome: settled statuses surface as "Exit win" / "Exit loss" when the
 * realized MOIC decides the outcome, otherwise the raw status key.
 */
export function dealStatusLabelKey(
  status: string,
  moic?: number | null,
): string {
  if (status === 'written_off') return 'exit_loss'
  if (status === 'fully_exited' && moic != null) {
    return moic >= 1 ? 'exit_win' : 'exit_loss'
  }
  return status
}
