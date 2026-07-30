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
 * Cockpit KPI line (Cash overview, above the curve): the available balance
 * today, then the PROJECTED balance at 30 and 90 days — available + net of
 * the window's pending entries (overdue included) — each detailed as a small
 * three-line sum (inflows, outflows, net). Purely presentational — the data
 * comes from ForecastOverview. `null` values render as skeletons.
 *
 * Rounding follows CLAUDE.md § « Gestion des arrondis » : the available
 * balance is a real amount (cent-precise), the projected balances and their
 * flow details are forecast figures (rounded to the euro).
 */
export function CashKpis({
  availableCents,
  accountsCount,
  flows30,
  flows90,
  fmtEur,
  fmtEurCents,
}: {
  /** Sum of the available accounts; `null` while loading. */
  availableCents: number | null
  /** Number of available accounts — `undefined` while loading. */
  accountsCount: number | undefined
  flows30: FlowWindow | null
  flows90: FlowWindow | null
  fmtEur: (cents?: number | null) => string
  fmtEurCents: (cents?: number | null) => string
}) {
  const { t } = useTranslation('cash')

  const fmtSigned = (cents: number) =>
    `${cents >= 0 ? '+' : '−'}${fmtEur(Math.abs(cents))}`

  const projectedTile = (
    key: string,
    title: string,
    flows: FlowWindow | null,
  ) => (
    <Card key={key}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {availableCents == null || flows == null ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtEur(availableCents + flows.netCents)}
            </p>
            {/* Three-line sum: inflows and outflows over the ruled net line. */}
            <div className="max-w-52 space-y-0.5 text-xs tabular-nums">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">
                  {t('kpis.inflows')}
                </span>
                <span className={directionTone('in')}>
                  +{fmtEur(flows.inCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">
                  {t('kpis.outflows')}
                </span>
                <span className={directionTone('out')}>
                  −{fmtEur(flows.outCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t pt-0.5 font-medium">
                <span>{t('kpis.net')}</span>
                <span className={signTone(flows.netCents)}>
                  {fmtSigned(flows.netCents)}
                </span>
              </div>
            </div>
          </>
        )}
        <p className="text-muted-foreground text-xs">{t('kpis.flowsHint')}</p>
      </CardContent>
    </Card>
  )

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            {t('kpis.availableToday')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {availableCents == null ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums">
              {fmtEurCents(availableCents)}
            </p>
          )}
          {accountsCount !== undefined && (
            <p className="text-muted-foreground text-xs">
              {accountsCount === 0
                ? t('accountsEmpty')
                : t('kpis.activeAccounts', { count: accountsCount })}
            </p>
          )}
        </CardContent>
      </Card>
      {projectedTile('p30', t('kpis.projected30'), flows30)}
      {projectedTile('p90', t('kpis.projected90'), flows90)}
    </div>
  )
}
