import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

export function KpiCard({
  label,
  value,
  title,
  delta,
  hint,
  icon: Icon,
}: {
  label: string
  value: string | number
  /** Exact value, surfaced as a native tooltip when `value` is abbreviated. */
  title?: string
  delta?: number
  hint?: string
  icon?: LucideIcon
}) {
  const positive = (delta ?? 0) >= 0
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
        {Icon ? (
          <Icon className="text-muted-foreground size-4" />
        ) : null}
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-semibold tabular-nums whitespace-nowrap"
          title={title}
        >
          {value}
        </div>
        <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
          {delta !== undefined ? (
            <>
              <DeltaIcon
                className={
                  positive
                    ? 'size-3 text-positive'
                    : 'size-3 text-destructive'
                }
              />
              <span
                className={
                  positive ? 'text-positive' : 'text-destructive'
                }
              >
                {positive ? '+' : ''}
                {delta}%
              </span>
            </>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}
