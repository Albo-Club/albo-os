import { useEffect, useState } from 'react'

import type * as RechartsModule from 'recharts'
import { Skeleton } from '~/components/ui/skeleton'

// `import type` is erased at compile time — no runtime import of recharts
// at module load (the real import stays inside useEffect).
type RechartsMod = typeof RechartsModule

/**
 * Cash balance curve: actual history (solid) + projected (dashed) on the
 * same axis. The junction happens at the current month: the last actual
 * point AND the first projected point both equal the current balance, so
 * the two lines touch. recharts touches `window` at load time →
 * dynamic-import inside useEffect + skeleton (KNOWN_ISSUES pattern
 * "Browser-only libs").
 */
export function ForecastChart({
  months,
  history,
  labels,
  fmtEur,
}: {
  months: Array<{ monthKey: string; projectedBalanceCents: number }>
  /** Actual end-of-month balance, last point = current month at current balance. */
  history?: Array<{ monthKey: string; balanceCents: number }> | null
  labels: { real: string; projected: string }
  fmtEur: (cents?: number | null) => string
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

  // One row per month; `real` and `projected` coexist at the current month
  // (junction). The current month's projected value is replaced by the
  // current balance: its remaining flows are already rolled into next month.
  const byMonth = new Map<
    string,
    { month: string; real?: number; projected?: number }
  >()
  for (const point of history ?? []) {
    byMonth.set(point.monthKey, {
      month: point.monthKey,
      real: point.balanceCents,
    })
  }
  const junction = history?.at(-1)
  for (const month of months) {
    const row = byMonth.get(month.monthKey) ?? { month: month.monthKey }
    row.projected =
      junction && month.monthKey === junction.monthKey
        ? junction.balanceCents
        : month.projectedBalanceCents
    byMonth.set(month.monthKey, row)
  }
  const data = [...byMonth.values()]
  const hasNegative = data.some(
    (row) => (row.real ?? 0) < 0 || (row.projected ?? 0) < 0,
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
          {history && history.length > 0 && (
            <Legend wrapperStyle={{ fontSize: 12 }} />
          )}
          {hasNegative && (
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
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
            dataKey="projected"
            name={labels.projected}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            strokeDasharray={history && history.length > 0 ? '6 4' : undefined}
            fill="url(#forecastFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
