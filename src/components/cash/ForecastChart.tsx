import { useEffect, useState } from 'react'

import type * as RechartsModule from 'recharts'
import { Skeleton } from '~/components/ui/skeleton'

// `import type` is erased at compile time — no runtime import of recharts
// at module load (the real import stays inside useEffect).
type RechartsMod = typeof RechartsModule

/**
 * Cash balance curve: actual history (solid) + TWO projected scenarios on
 * the same axis — committed-only (confirmed flows) and with-planned
 * (confirmed + expected/probable), both dashed. The junction happens at the
 * current month: the last actual point AND the first point of each
 * projected line equal the current balance (the month's remaining flows
 * are already cumulated into the following months). recharts touches
 * `window` at load time → dynamic-import inside useEffect + skeleton
 * (KNOWN_ISSUES pattern "Browser-only libs").
 */
export function ForecastChart({
  projection,
  history,
  labels,
  fmtEur,
  thresholdCents,
}: {
  projection: Array<{
    monthKey: string
    committedBalanceCents: number
    plannedBalanceCents: number
  }>
  /** Actual end-of-month balance, last point = current month at current balance. */
  history?: Array<{ monthKey: string; balanceCents: number }> | null
  labels: { real: string; committed: string; planned: string }
  fmtEur: (cents?: number | null) => string
  /** Active alert threshold, drawn as a horizontal reference line. */
  thresholdCents?: number | null
}) {
  const [recharts, setRecharts] = useState<RechartsMod | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('recharts').then((mod) => {
      if (!cancelled) setRecharts(mod)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!recharts) return <Skeleton className="h-64 w-full" />

  const {
    Area,
    AreaChart,
    CartesianGrid,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = recharts

  // One row per month; `real` and the projected series coexist at the
  // current month (junction at the current balance).
  const byMonth = new Map<
    string,
    { month: string; real?: number; committed?: number; planned?: number }
  >()
  for (const point of history ?? []) {
    byMonth.set(point.monthKey, {
      month: point.monthKey,
      real: point.balanceCents,
    })
  }
  const junction = history?.at(-1)
  for (const point of projection) {
    const row = byMonth.get(point.monthKey) ?? { month: point.monthKey }
    const isJunction = junction && point.monthKey === junction.monthKey
    row.committed = isJunction
      ? junction.balanceCents
      : point.committedBalanceCents
    row.planned = isJunction ? junction.balanceCents : point.plannedBalanceCents
    byMonth.set(point.monthKey, row)
  }
  const data = [...byMonth.values()]
  const hasNegative = data.some(
    (row) =>
      (row.real ?? 0) < 0 || (row.committed ?? 0) < 0 || (row.planned ?? 0) < 0,
  )
  // The two scenarios only diverge when expected/probable entries exist —
  // hide the redundant planned line otherwise.
  const scenariosDiverge = data.some(
    (row) =>
      row.committed !== undefined &&
      row.planned !== undefined &&
      row.committed !== row.planned,
  )

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="realFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="month"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(cents: number) => fmtEur(cents)}
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            width={90}
          />
          <Tooltip
            formatter={(value) => fmtEur(Number(value))}
            contentStyle={{
              backgroundColor: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--popover-foreground)',
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {hasNegative && (
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
          )}
          {thresholdCents != null && thresholdCents > 0 && (
            <ReferenceLine
              y={thresholdCents}
              stroke="var(--chart-4)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{
                value: fmtEur(thresholdCents),
                position: 'insideBottomRight',
                fontSize: 11,
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
          {history && history.length > 0 && (
            <Area
              type="monotone"
              dataKey="real"
              name={labels.real}
              stroke="var(--chart-2)"
              strokeWidth={2.5}
              fill="url(#realFill)"
            />
          )}
          <Area
            type="monotone"
            dataKey="committed"
            name={labels.committed}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            fill="url(#forecastFill)"
          />
          {scenariosDiverge && (
            <Area
              type="monotone"
              dataKey="planned"
              name={labels.planned}
              stroke="var(--chart-3)"
              strokeWidth={2}
              strokeDasharray="2 4"
              fill="none"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
