import { useMemo, useState } from 'react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import { CashKpis } from './CashKpis'
import { ForecastChart } from './ForecastChart'
import type { CashAccount } from './CashAccounts'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Skeleton } from '~/components/ui/skeleton'

const HORIZONS = [6, 12, 24] as const
// Depth of the actual history shown ahead of the projection.
const HISTORY_MONTHS = 6
// The threshold banner mirrors checkCashAlerts: available balance or any
// projected month (with-planned scenario) over the next 3 months.
const ALERT_LOOKAHEAD_MONTHS = 3

/**
 * Cockpit of the Cash « Vue d'ensemble » tab: the KPI band (available
 * balance, end-of-month landing, 30/90-day flows), then the projected-
 * balance curve (two scenarios: committed-only / with planned) with the
 * alert threshold drawn on it, plus an in-app banner when the threshold is
 * breached. The category × month grid and the committed pipeline moved to
 * the « Prévisionnel » tab (ForecastGridSection).
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
  // Shared subscription with UpcomingEntriesSection (same query + args).
  const upcoming = useConvexQuery(api.forecasts.getUpcomingEntries, { orgId })
  // Null until a 1st-of-month snapshot exists for the previous month.
  const reliability = useConvexQuery(api.forecasts.getForecastReliability, {
    orgId,
  })
  const alert = useConvexQuery(api.forecasts.getCashAlert, { orgId })

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

  const thresholdCents =
    alert?.active && alert.thresholdCents > 0 ? alert.thresholdCents : null
  const thresholdBreached =
    thresholdCents != null &&
    ((availableCents != null && availableCents < thresholdCents) ||
      (grid?.projection
        .slice(0, ALERT_LOOKAHEAD_MONTHS)
        .some((p) => p.plannedBalanceCents < thresholdCents) ??
        false))

  const fmtMonth = (monthKey: string) =>
    new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(i18n.language, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })

  return (
    <section className="space-y-4">
      {thresholdBreached && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          {t('cash:alert.breached', { amount: fmtEur(thresholdCents) })}
        </div>
      )}
      <CashKpis
        availableCents={availableCents}
        blockedCents={blockedCents}
        landingPlannedCents={landing?.plannedBalanceCents ?? null}
        landingCommittedCents={landing?.committedBalanceCents ?? null}
        flows30={
          upcoming
            ? {
                inCents: upcoming.in30Cents,
                outCents: upcoming.out30Cents,
                netCents: upcoming.net30Cents,
              }
            : null
        }
        flows90={
          upcoming
            ? {
                inCents: upcoming.in90Cents,
                outCents: upcoming.out90Cents,
                netCents: upcoming.net90Cents,
              }
            : null
        }
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
            thresholdCents={thresholdCents}
          />
        </>
      )}
    </section>
  )
}
