import { useEffect, useState } from 'react'

import type * as RechartsModule from 'recharts'
import type { PlanVsActualRow } from '~/lib/projectionSeries'
import { Skeleton } from '~/components/ui/skeleton'

// `import type` est effacé à la compilation — pas d'import runtime de
// recharts au chargement du module (le vrai import reste dans useEffect).
type RechartsMod = typeof RechartsModule

/**
 * Courbes cumulées BP initial / BP révisé / réalisé. recharts touche
 * `window` au chargement → dynamic-import dans useEffect + skeleton
 * (pattern KNOWN_ISSUES « Browser-only libs »).
 */
export function PlanVsActualChart({
  rows,
  hasRevised,
  labels,
  fmtEur,
  fmtPeriod,
}: {
  rows: Array<PlanVsActualRow>
  hasRevised: boolean
  labels: { initial: string; revised: string; actual: string }
  fmtEur: (cents?: number | null) => string
  fmtPeriod: (ms: number) => string
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
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = recharts

  const data = rows.map((row) => ({
    period: row.period,
    [labels.initial]: row.initialCumCents,
    ...(hasRevised ? { [labels.revised]: row.revisedCumCents } : {}),
    [labels.actual]: row.actualCumCents,
  }))

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="period"
            tickFormatter={fmtPeriod}
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
            labelFormatter={(ms) => fmtPeriod(Number(ms))}
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
          <Line
            type="monotone"
            dataKey={labels.initial}
            stroke="var(--chart-2)"
            strokeDasharray="6 3"
            strokeWidth={2}
            dot={false}
          />
          {hasRevised && (
            <Line
              type="monotone"
              dataKey={labels.revised}
              stroke="var(--chart-3)"
              strokeDasharray="3 3"
              strokeWidth={2}
              dot={false}
            />
          )}
          <Line
            type="monotone"
            dataKey={labels.actual}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
