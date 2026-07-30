import { useEffect, useState } from 'react'

import type * as RechartsModule from 'recharts'
import { Skeleton } from '~/components/ui/skeleton'

// `import type` is erased at compile time — no runtime import of recharts
// at module load (the real import stays inside useEffect).
type RechartsMod = typeof RechartsModule

/**
 * Position (0 = top of the path, 1 = its bottom) of the y = 0 line inside a
 * series' own bounding box, i.e. where the curve must switch from the
 * positive to the negative colour. Returns 1 for an all-positive series and 0
 * for an all-negative one — both collapse the two-stop gradient below to a
 * single colour, so the exact value stops mattering.
 *
 * Why the series' bounding box and not the chart's: the gradient uses the
 * default `objectBoundingBox` units, which map to the painted path, whose
 * vertical extent IS [min, max] of the series (monotone interpolation never
 * overshoots). That keeps the colour break exact without any pixel maths or
 * a hardcoded y-domain. It also holds for the area fill as long as
 * `baseValue={0}` — the fill path then spans the same extent.
 */
function zeroOffset(min: number, max: number): number {
  if (min >= 0) return 1
  if (max <= 0) return 0
  return max / (max - min)
}

/**
 * Cash balance curve: ONE trajectory of the bank balance — solid over the
 * actual history, dashed over the projection (confirmed + expected +
 * probable flows: everything that will hit the account). The junction
 * happens at the current month: the last actual point AND the first
 * projected point equal the current balance (the month's remaining flows are
 * already cumulated into the following months). The line is green above zero
 * and red below it, breaking exactly on the zero line. recharts touches
 * `window` at load time → dynamic-import inside useEffect + skeleton
 * (KNOWN_ISSUES pattern "Browser-only libs").
 */
export function ForecastChart({
  projection,
  history,
  labels,
  fmtEur,
}: {
  projection: Array<{ monthKey: string; plannedBalanceCents: number }>
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
  // (junction at the current balance).
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
  for (const point of projection) {
    const row = byMonth.get(point.monthKey) ?? { month: point.monthKey }
    row.projected =
      junction && point.monthKey === junction.monthKey
        ? junction.balanceCents
        : point.plannedBalanceCents
    byMonth.set(point.monthKey, row)
  }
  const data = [...byMonth.values()]

  const extent = (key: 'real' | 'projected') => {
    const values = data
      .map((row) => row[key])
      .filter((value): value is number => value !== undefined)
    return values.length === 0
      ? { min: 0, max: 0 }
      : { min: Math.min(...values), max: Math.max(...values) }
  }
  const realExtent = extent('real')
  const projectedExtent = extent('projected')
  const hasNegative = realExtent.min < 0 || projectedExtent.min < 0

  // Two stops at the same offset = hard colour break on the zero line.
  const signGradient = (id: string, offset: number, opacity?: number) => (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop
        offset={offset}
        stopColor="var(--positive)"
        stopOpacity={opacity ?? 1}
      />
      <stop
        offset={offset}
        stopColor="var(--destructive)"
        stopOpacity={opacity ?? 1}
      />
    </linearGradient>
  )

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
        >
          <defs>
            {signGradient(
              'realStroke',
              zeroOffset(realExtent.min, realExtent.max),
            )}
            {signGradient(
              'realFill',
              zeroOffset(realExtent.min, realExtent.max),
              0.16,
            )}
            {signGradient(
              'projectedStroke',
              zeroOffset(projectedExtent.min, projectedExtent.max),
            )}
            {signGradient(
              'projectedFill',
              zeroOffset(projectedExtent.min, projectedExtent.max),
              0.12,
            )}
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
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
          )}
          {history && history.length > 0 && (
            <Area
              type="monotone"
              dataKey="real"
              name={labels.real}
              baseValue={0}
              stroke="url(#realStroke)"
              strokeWidth={2.5}
              fill="url(#realFill)"
            />
          )}
          <Area
            type="monotone"
            dataKey="projected"
            name={labels.projected}
            baseValue={0}
            stroke="url(#projectedStroke)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            fill="url(#projectedFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
