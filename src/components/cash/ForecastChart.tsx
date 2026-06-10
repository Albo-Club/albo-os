import { useEffect, useState } from 'react'

import type * as RechartsModule from 'recharts'
import { Skeleton } from '~/components/ui/skeleton'

// `import type` est effacé à la compilation — pas d'import runtime de
// recharts au chargement du module (le vrai import reste dans useEffect).
type RechartsMod = typeof RechartsModule

/**
 * Courbe du solde de trésorerie projeté (mensuel). recharts touche `window`
 * au chargement → dynamic-import dans useEffect + skeleton (pattern
 * KNOWN_ISSUES « Browser-only libs »).
 */
export function ForecastChart({
  months,
  label,
  fmtEur,
}: {
  months: Array<{ monthKey: string; projectedBalanceCents: number }>
  label: string
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
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = recharts

  const data = months.map((month) => ({
    month: month.monthKey,
    [label]: month.projectedBalanceCents,
  }))
  const hasNegative = months.some((m) => m.projectedBalanceCents < 0)

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
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
          {hasNegative && (
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
          )}
          <Area
            type="monotone"
            dataKey={label}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#forecastFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
