import { useMemo, useState } from 'react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import { CashKpis } from './CashKpis'
import { ForecastChart } from './ForecastChart'
import type { CashAccount } from './CashAccounts'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const HORIZONS = [6, 12, 24] as const
// Depth of the actual history shown ahead of the projection.
const HISTORY_MONTHS = 6

type GridCell = {
  realizedCents: number
  committedCents: number
  plannedCents: number
}

type GridRow = {
  direction: 'in' | 'out'
  category: string
  // A month with no flow has no key (the record is sparse).
  byMonth: Record<string, GridCell | undefined>
  totals: GridCell
}

/**
 * Forecast cockpit of the Cash « Aperçu » tab: the KPI band (available
 * balance, end-of-month landing, 30/90-day nets), the projected-balance
 * curve (two scenarios: committed-only / with planned), the undated
 * committed pipeline of signed deals, and the category × month grid merging
 * the realized, committed and planned layers (forecasts.getForecastGrid —
 * current-month consumption, cf. KNOWN_ISSUES « Cash flow forecast »).
 */
export function ForecastOverview({
  orgId,
  accounts,
}: {
  orgId: Id<'organizations'>
  accounts: Array<CashAccount> | undefined
}) {
  const { t, i18n } = useTranslation(['cash', 'common'])
  const { fmtEur } = useFormatters()
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(12)

  const grid = useConvexQuery(api.forecasts.getForecastGrid, {
    orgId,
    historyMonths: HISTORY_MONTHS,
    horizonMonths: horizon,
  })
  const pipeline = useConvexQuery(api.forecasts.getCommittedPipeline, { orgId })
  // Shared subscription with UpcomingEntriesSection (same query + args).
  const upcoming = useConvexQuery(api.forecasts.getUpcomingEntries, { orgId })
  // Null until a 1st-of-month snapshot exists for the previous month.
  const reliability = useConvexQuery(api.forecasts.getForecastReliability, {
    orgId,
  })

  // Headline balances (moved here from CashAccounts): available = active,
  // non-pledged accounts — the phase-0 perimeter, all currencies.
  const { availableCents, blockedCents } = useMemo(() => {
    if (!accounts) return { availableCents: null, blockedCents: 0 }
    const available = accounts
      .filter((a) => a.accountStatus === 'active' && !a.pledged)
      .reduce((sum, a) => sum + (a.currentBalance ?? 0), 0)
    const total = accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0)
    return { availableCents: available, blockedCents: total - available }
  }, [accounts])

  // End-of-month landing = the current month's projection point.
  const landing = grid?.projection[0] ?? null

  const fmtMonth = (monthKey: string) =>
    new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(i18n.language, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
  const categoryLabel = (slug: string) =>
    t(`common:categories.${slug}`, { defaultValue: slug })

  return (
    <section className="space-y-4">
      <CashKpis
        availableCents={availableCents}
        blockedCents={blockedCents}
        landingPlannedCents={landing?.plannedBalanceCents ?? null}
        landingCommittedCents={landing?.committedBalanceCents ?? null}
        net30Cents={upcoming?.net30Cents ?? null}
        net90Cents={upcoming?.net90Cents ?? null}
        fmtEur={fmtEur}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('cash:forecast.title')}
        </h2>
        <Select
          value={String(horizon)}
          onValueChange={(value) =>
            setHorizon(Number(value) as (typeof HORIZONS)[number])
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZONS.map((months) => (
              <SelectItem key={months} value={String(months)}>
                {t('cash:forecast.horizonMonths', { count: months })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!grid ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {t('cash:forecast.startingBalance', {
              amount: fmtEur(grid.startingBalanceCents),
            })}
            {reliability && (
              <>
                {' · '}
                {t('cash:forecast.reliability', {
                  month: fmtMonth(reliability.monthKey),
                  projected: fmtEur(reliability.projectedCents),
                  actual: fmtEur(reliability.actualCents),
                  delta: `${reliability.deltaCents >= 0 ? '+' : '−'}${fmtEur(
                    Math.abs(reliability.deltaCents),
                  )}`,
                })}
              </>
            )}
          </p>
          <ForecastChart
            projection={grid.projection}
            history={grid.history}
            labels={{
              real: t('cash:forecast.chartReal'),
              committed: t('cash:forecast.chartCommitted'),
              planned: t('cash:forecast.chartPlanned'),
            }}
            fmtEur={fmtEur}
          />
        </>
      )}

      {pipeline && pipeline.totalRemainingCents > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              {t('cash:forecast.pipeline.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold tabular-nums">
              {fmtEur(pipeline.totalRemainingCents)}
            </p>
            <ul className="text-muted-foreground space-y-1 text-sm">
              {pipeline.rows.slice(0, 5).map((row) => (
                <li key={row.dealId} className="flex justify-between gap-4">
                  <span className="truncate">{row.name}</span>
                  <span className="tabular-nums">
                    {fmtEur(row.remainingCents)}
                  </span>
                </li>
              ))}
              {pipeline.rows.length > 5 && (
                <li>
                  {t('cash:forecast.pipeline.more', {
                    count: pipeline.rows.length - 5,
                  })}
                </li>
              )}
            </ul>
            <p className="text-muted-foreground text-xs">
              {t('cash:forecast.pipeline.hint')}
            </p>
          </CardContent>
        </Card>
      )}

      {grid && grid.rows.length > 0 && (
        <ForecastGridTable
          months={grid.months}
          currentMonthKey={grid.currentMonthKey}
          rows={grid.rows}
          history={grid.history}
          projection={grid.projection}
          fmtEur={fmtEur}
          fmtMonth={fmtMonth}
          categoryLabel={categoryLabel}
        />
      )}
    </section>
  )
}

/**
 * The category × month grid. Cell content depends on the month's position:
 * past = realized; current = realized + remaining-to-come; future =
 * committed + planned (planned share detailed in a sub-line). The last row
 * carries the balance trajectory: real end-of-month balances in the past,
 * projected (with-planned scenario) from the current month on.
 */
function ForecastGridTable({
  months,
  currentMonthKey,
  rows,
  history,
  projection,
  fmtEur,
  fmtMonth,
  categoryLabel,
}: {
  months: Array<string>
  currentMonthKey: string
  rows: Array<GridRow>
  history: Array<{ monthKey: string; balanceCents: number }>
  projection: Array<{
    monthKey: string
    committedBalanceCents: number
    plannedBalanceCents: number
  }>
  fmtEur: (cents?: number | null) => string
  fmtMonth: (monthKey: string) => string
  categoryLabel: (slug: string) => string
}) {
  const { t } = useTranslation('cash')

  const balanceByMonth = new Map<string, number>()
  for (const point of history) {
    balanceByMonth.set(point.monthKey, point.balanceCents)
  }
  // Projected months override the history's current-month point: the grid
  // shows the END-of-month landing, not the balance as of today.
  for (const point of projection) {
    balanceByMonth.set(point.monthKey, point.plannedBalanceCents)
  }

  function cellContent(row: GridRow, month: string) {
    const cell = row.byMonth[month]
    if (!cell) return <span className="text-muted-foreground">—</span>
    const upcoming = cell.committedCents + cell.plannedCents
    if (month < currentMonthKey) {
      return cell.realizedCents === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{fmtEur(cell.realizedCents)}</span>
      )
    }
    if (month === currentMonthKey) {
      return (
        <span className="flex flex-col items-end gap-0.5">
          <span className="tabular-nums">
            {cell.realizedCents === 0 && upcoming === 0
              ? '—'
              : fmtEur(cell.realizedCents)}
          </span>
          {upcoming > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t('forecast.grid.upcoming', { amount: fmtEur(upcoming) })}
            </span>
          )}
        </span>
      )
    }
    if (upcoming === 0) return <span className="text-muted-foreground">—</span>
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="tabular-nums">{fmtEur(upcoming)}</span>
        {cell.plannedCents > 0 && cell.committedCents > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t('forecast.grid.plannedShare', {
              amount: fmtEur(cell.plannedCents),
            })}
          </span>
        )}
      </span>
    )
  }

  const section = (direction: 'in' | 'out') => {
    const list = rows.filter((r) => r.direction === direction)
    if (list.length === 0) return null
    return (
      <>
        <TableRow className="bg-muted/40">
          <TableCell className="font-semibold" colSpan={months.length + 1}>
            {direction === 'in'
              ? t('analysis.inflows')
              : t('analysis.outflows')}
          </TableCell>
        </TableRow>
        {list.map((row) => (
          <TableRow key={`${row.direction}:${row.category}`}>
            <TableCell
              className={`pl-6 ${
                row.category === 'uncategorized'
                  ? 'text-muted-foreground italic'
                  : ''
              }`}
            >
              {categoryLabel(row.category)}
            </TableCell>
            {months.map((month) => (
              <TableCell
                key={month}
                className={`text-right align-top ${
                  month < currentMonthKey ? 'text-muted-foreground' : ''
                } ${month === currentMonthKey ? 'bg-muted/30' : ''}`}
              >
                {cellContent(row, month)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-48">
              {t('forecast.grid.colCategory')}
            </TableHead>
            {months.map((month) => (
              <TableHead
                key={month}
                className={`text-right whitespace-nowrap ${
                  month === currentMonthKey ? 'font-semibold' : ''
                }`}
              >
                {fmtMonth(month)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {section('in')}
          {section('out')}
          <TableRow className="border-t-2">
            <TableCell className="font-semibold">
              {t('forecast.grid.balance')}
            </TableCell>
            {months.map((month) => {
              const balance = balanceByMonth.get(month)
              return (
                <TableCell
                  key={month}
                  className={`text-right font-semibold tabular-nums ${
                    month === currentMonthKey ? 'bg-muted/30' : ''
                  } ${balance != null && balance < 0 ? 'text-destructive' : ''}`}
                >
                  {balance == null ? '—' : fmtEur(balance)}
                </TableCell>
              )
            })}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
