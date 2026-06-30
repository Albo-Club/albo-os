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
 * booked), even when the MOIC can't be computed. Renders nothing for
 * `active` / `partially_exited`.
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
  if (status !== 'fully_exited' && status !== 'written_off') return null

  const { isWin } = dealMoic(deal, transactions)
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
