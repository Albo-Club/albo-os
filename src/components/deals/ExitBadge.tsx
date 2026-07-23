import { useTranslation } from 'react-i18next'

import type { Doc } from '../../../convex/_generated/dataModel'
import type { MoicTransaction } from '~/lib/dealMetrics'
import { dealMoic } from '~/lib/dealMetrics'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'

/**
 * Win/lost badge for an exited deal, derived from the realized MOIC (never
 * stored). Three states:
 *   - MOIC ≥ 1               → "Exit win"  (positive tint)
 *   - MOIC < 1 (computable)  → "Exit lost" (destructive tint)
 *   - MOIC null (no capital) → "Sorti"     (neutral) — no loss is asserted
 * Exception: `written_off` is always "Exit lost" (the loss is explicitly
 * booked), even when the MOIC can't be computed.
 *
 * `partially_exited` is a special case: the deal is still open (the remaining
 * position can still move), so a realized MOIC < 1 means "not fully returned
 * yet", NOT a loss. Only a realized win is surfaced (MOIC ≥ 1 → "Exit win");
 * anything else renders nothing — we never assert a loss (or a neutral "Sorti")
 * on a deal that isn't closed. Renders nothing for `active`.
 */
export function ExitBadge({
  deal,
  transactions,
}: {
  deal: Doc<'deals'>
  transactions: Array<MoicTransaction> | undefined
}) {
  const { t } = useTranslation('participations')
  const { status } = deal
  if (
    status !== 'fully_exited' &&
    status !== 'written_off' &&
    status !== 'partially_exited'
  )
    return null

  const { isWin } = dealMoic(deal, transactions)
  // Partial exit: surface the badge only once it's in the green; stay silent
  // otherwise (a MOIC < 1 or null on an open deal is not a loss). Past this
  // guard a partial exit only ever reaches the 'win' branch below.
  if (status === 'partially_exited' && isWin !== true) return null

  // written_off forces "lost"; otherwise the MOIC decides (null → neutral).
  const tone =
    status === 'written_off' || isWin === false
      ? 'lost'
      : isWin === true
        ? 'win'
        : 'neutral'

  if (tone === 'neutral') {
    return <Badge variant="secondary">{t('exitBadge.exited')}</Badge>
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        tone === 'win'
          ? 'border-positive/40 bg-positive/10 text-positive'
          : 'border-destructive/40 bg-destructive/10 text-destructive',
      )}
    >
      {tone === 'win' ? t('exitBadge.win') : t('exitBadge.lost')}
    </Badge>
  )
}
