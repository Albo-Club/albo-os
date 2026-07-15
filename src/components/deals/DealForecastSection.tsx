import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionTone } from '~/lib/moneyTone'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

// Badge tone per confidence (same mapping as the cash forecast tables).
const CONFIDENCE_VARIANT = {
  confirmed: 'default',
  expected: 'secondary',
  probable: 'outline',
} as const

/**
 * Forecast side of a deal page: the pending forecast entries linked to the
 * deal (planned flows — SCPI rents, coupons, scheduled capital calls…) and
 * the undated committed remainder. Hidden when the deal has neither. The
 * realized layer is the existing Transactions section below.
 */
export function DealForecastSection({ dealId }: { dealId: Id<'deals'> }) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const forecast = useConvexQuery(api.forecasts.getDealForecast, { dealId })

  if (
    !forecast ||
    (forecast.entries.length === 0 && forecast.remainingCents <= 0)
  ) {
    return null
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('dealForecast.title')}
      </h2>
      {forecast.remainingCents > 0 && (
        <p className="text-muted-foreground text-sm">
          {t('dealForecast.committed', {
            remaining: fmtEur(forecast.remainingCents),
            committed: fmtEur(forecast.committedCents),
            paid: fmtEur(forecast.paidCents),
          })}
        </p>
      )}
      {forecast.entries.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dealForecast.col.date')}</TableHead>
                <TableHead>{t('dealForecast.col.label')}</TableHead>
                <TableHead>{t('dealForecast.col.confidence')}</TableHead>
                <TableHead className="text-right">
                  {t('dealForecast.col.amount')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forecast.entries.map((entry) => (
                <TableRow key={entry._id}>
                  <TableCell>{fmtDate(entry.date)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{entry.label}</span>
                      {entry.dateMissing && (
                        <Badge className="bg-warning text-warning-foreground">
                          {t('common:dateMissing')}
                        </Badge>
                      )}
                      {entry.derivedFromRule && (
                        <Badge variant="secondary">
                          {t('dealForecast.ruleBadge')}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={CONFIDENCE_VARIANT[entry.confidence]}>
                      {t(`dealForecast.confidence.${entry.confidence}`)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${directionTone(entry.direction)}`}
                  >
                    {entry.direction === 'out' ? '−' : '+'}
                    {fmtEur(entry.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {t('dealForecast.hint')}
      </p>
    </section>
  )
}
