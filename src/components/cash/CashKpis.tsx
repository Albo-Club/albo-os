import { useTranslation } from 'react-i18next'

import { signTone } from '~/lib/moneyTone'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'

/**
 * Cockpit KPI band (Cash « Aperçu » tab, above the curve): available
 * balance, end-of-month landing, 30/90-day nets. Purely presentational —
 * the data comes from ForecastOverview (accounts + grid + upcoming
 * entries). `null` values render as skeletons while loading.
 *
 * Scope note: the available balance keeps the phase-0 account perimeter
 * (all currencies), while landing/nets are EUR (forecast grid) — coherent
 * today where every account is EUR, kept as-is rather than unified.
 */
export function CashKpis({
  availableCents,
  blockedCents,
  landingPlannedCents,
  landingCommittedCents,
  net30Cents,
  net90Cents,
  fmtEur,
}: {
  availableCents: number | null
  /** total − available; 0 hides the hint. */
  blockedCents: number
  landingPlannedCents: number | null
  /** Committed-only landing, shown as subtext when scenarios diverge. */
  landingCommittedCents: number | null
  net30Cents: number | null
  net90Cents: number | null
  fmtEur: (cents?: number | null) => string
}) {
  const { t } = useTranslation('cash')

  const fmtSigned = (cents: number) =>
    `${cents >= 0 ? '+' : '−'}${fmtEur(Math.abs(cents))}`

  const tiles: Array<{
    key: string
    title: string
    value: number | null
    render: (cents: number) => { text: string; tone: string }
    hint?: string
  }> = [
    {
      key: 'available',
      title: t('availableBalance'),
      value: availableCents,
      render: (cents) => ({ text: fmtEur(cents), tone: '' }),
      hint:
        blockedCents > 0
          ? t('totalHint', { amount: fmtEur(blockedCents) })
          : undefined,
    },
    {
      key: 'landing',
      title: t('kpis.landing'),
      value: landingPlannedCents,
      render: (cents) => ({
        text: fmtEur(cents),
        tone: cents < 0 ? 'text-destructive' : '',
      }),
      hint:
        landingCommittedCents != null &&
        landingCommittedCents !== landingPlannedCents
          ? t('kpis.landingCommitted', { amount: fmtEur(landingCommittedCents) })
          : undefined,
    },
    {
      key: 'net30',
      title: t('kpis.net30'),
      value: net30Cents,
      render: (cents) => ({ text: fmtSigned(cents), tone: signTone(cents) }),
      hint: t('kpis.netHint'),
    },
    {
      key: 'net90',
      title: t('kpis.net90'),
      value: net90Cents,
      render: (cents) => ({ text: fmtSigned(cents), tone: signTone(cents) }),
      hint: t('kpis.netHint'),
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {tile.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {tile.value == null ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p
                className={`text-2xl font-semibold tabular-nums ${tile.render(tile.value).tone}`}
              >
                {tile.render(tile.value).text}
              </p>
            )}
            {tile.hint && (
              <p className="text-muted-foreground text-xs">{tile.hint}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
