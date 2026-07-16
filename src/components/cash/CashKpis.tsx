import { useTranslation } from 'react-i18next'

import { directionTone, signTone } from '~/lib/moneyTone'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'

/** Gross inflows/outflows and net of one KPI window (30 or 90 days). */
export type FlowWindow = {
  inCents: number
  outCents: number
  netCents: number
}

/**
 * Cockpit KPI band (Cash « Vue d'ensemble » tab, above the curve):
 * available balance, end-of-month landing, then one composite tile per
 * horizon (30/90 days) showing inflows, outflows and net. Purely
 * presentational — the data comes from ForecastOverview (accounts + grid +
 * upcoming entries). `null` values render as skeletons while loading.
 *
 * Scope note: the available balance keeps the phase-0 account perimeter
 * (all currencies), while landing/flows are EUR (forecast grid) — coherent
 * today where every account is EUR, kept as-is rather than unified.
 */
export function CashKpis({
  availableCents,
  blockedCents,
  landingPlannedCents,
  landingCommittedCents,
  flows30,
  flows90,
  fmtEur,
}: {
  availableCents: number | null
  /** total − available; 0 hides the hint. */
  blockedCents: number
  landingPlannedCents: number | null
  /** Committed-only landing, shown as subtext when scenarios diverge. */
  landingCommittedCents: number | null
  flows30: FlowWindow | null
  flows90: FlowWindow | null
  fmtEur: (cents?: number | null) => string
}) {
  const { t } = useTranslation('cash')

  const fmtSigned = (cents: number) =>
    `${cents >= 0 ? '+' : '−'}${fmtEur(Math.abs(cents))}`

  const flowTile = (key: string, title: string, flows: FlowWindow | null) => (
    <Card key={key}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {flows == null ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span className="text-muted-foreground">
                {t('kpis.inflows')}
              </span>
              <span className={directionTone('in')}>
                +{fmtEur(flows.inCents)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span className="text-muted-foreground">
                {t('kpis.outflows')}
              </span>
              <span className={directionTone('out')}>
                −{fmtEur(flows.outCents)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t pt-1 font-semibold tabular-nums">
              <span>{t('kpis.net')}</span>
              <span className={signTone(flows.netCents)}>
                {fmtSigned(flows.netCents)}
              </span>
            </div>
          </>
        )}
        <p className="text-muted-foreground text-xs">{t('kpis.flowsHint')}</p>
      </CardContent>
    </Card>
  )

  const simpleTiles: Array<{
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
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {simpleTiles.map((tile) => (
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
      {flowTile('flows30', t('kpis.window30'), flows30)}
      {flowTile('flows90', t('kpis.window90'), flows90)}
    </div>
  )
}
