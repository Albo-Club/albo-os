import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionTone } from '~/lib/moneyTone'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOWS = [30, 90] as const

// Badge tone per confidence (same mapping as ForecastSection).
const CONFIDENCE_VARIANT = {
  confirmed: 'default',
  expected: 'secondary',
  probable: 'outline',
} as const

/**
 * Cockpit list of upcoming pending entries (30/90-day toggle), overdue ones
 * first with a badge — rule-derived occurrences INCLUDED, contrary to the
 * hand-managed one-shot table lower on the page. Read-only: editing stays
 * on the rules / one-off surfaces, reconciliation on the suggestions card.
 */
export function UpcomingEntriesSection({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('cash')
  const { fmtEur, fmtDate } = useFormatters()
  const [windowDays, setWindowDays] =
    useState<(typeof WINDOWS)[number]>(30)

  const upcoming = useConvexQuery(api.forecasts.getUpcomingEntries, { orgId })

  const cutoff = Date.now() + windowDays * DAY_MS
  const entries = upcoming?.entries.filter((e) => e.date <= cutoff)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">{t('upcoming.title')}</h3>
        <div className="flex gap-1">
          {WINDOWS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={windowDays === days ? 'default' : 'outline'}
              onClick={() => setWindowDays(days)}
            >
              {t('upcoming.window', { count: days })}
            </Button>
          ))}
        </div>
      </div>
      {!entries ? (
        <Skeleton className="h-24 w-full" />
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('upcoming.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('forecast.entries.col.date')}</TableHead>
                <TableHead>{t('forecast.entries.col.label')}</TableHead>
                <TableHead>{t('forecast.entries.col.confidence')}</TableHead>
                <TableHead className="text-right">
                  {t('forecast.entries.col.amount')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry._id}>
                  <TableCell
                    className={entry.overdue ? 'text-destructive' : ''}
                  >
                    {fmtDate(entry.date)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{entry.label}</span>
                      {entry.overdue && (
                        <Badge variant="destructive">
                          {t('upcoming.overdue')}
                        </Badge>
                      )}
                      {entry.derivedFromRule && (
                        <Badge variant="secondary">
                          {t('forecast.suggestions.ruleBadge')}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={CONFIDENCE_VARIANT[entry.confidence]}>
                      {t(`forecast.entries.confidence.${entry.confidence}`)}
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
    </section>
  )
}
