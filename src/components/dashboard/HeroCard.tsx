import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type * as RechartsModule from 'recharts'

import { Badge } from '~/components/ui/badge'
import { Card, CardContent } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionBadgeClass } from '~/lib/moneyTone'

// `import type` is erased at compile time — recharts touches `window` at
// load, so the real import stays inside useEffect (KNOWN_ISSUES pattern
// "Browser-only libs", same as ForecastChart).
type RechartsMod = typeof RechartsModule

type SeriesPoint = { month: number; navCents: number }

/** Minimal area sparkline of the NAV trend — no axes, accent-token fill. */
function NavSparkline({ series }: { series: Array<SeriesPoint> }) {
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

  if (!recharts) return <Skeleton className="h-20 w-full" />

  const { Area, AreaChart, ResponsiveContainer } = recharts
  const data = series.map((point) => ({ month: point.month, nav: point.navCents }))

  return (
    <div className="h-20 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="navHeroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="nav"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#navHeroFill)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Hero KPI: estimated portfolio value (NAV) with a TVPI badge and the
 * monthly NAV-trend sparkline.
 */
export function HeroCard({
  navCents,
  navIsPartial,
  tvpi,
  series,
}: {
  navCents: number
  navIsPartial: boolean
  tvpi: number | null
  series: Array<SeriesPoint>
}) {
  const { t } = useTranslation('dashboard')
  const { fmtEur, fmtEurCompact, fmtMultiple } = useFormatters()

  return (
    <Card className="justify-between gap-4">
      <CardContent className="flex flex-col gap-3">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t('hero.eyebrow')}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="text-4xl font-semibold tabular-nums whitespace-nowrap"
            title={fmtEur(navCents)}
          >
            {fmtEurCompact(navCents)}
          </span>
          {tvpi != null ? (
            <Badge variant="outline" className={directionBadgeClass(true)}>
              <TrendingUp className="size-3" />
              {t('kpi.tvpi')} {fmtMultiple(tvpi)}
            </Badge>
          ) : null}
        </div>
        {navIsPartial ? (
          <p className="text-muted-foreground text-sm">
            {t('hero.navPartialNote')}
          </p>
        ) : null}
      </CardContent>
      {series.length > 1 ? (
        <div className="px-2">
          <NavSparkline series={series} />
        </div>
      ) : null}
    </Card>
  )
}
