import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

interface Insight {
  label?: string
  current_value?: string
  trend?: string
  trend_direction?: 'up' | 'down' | 'stable'
  context?: string
}
interface Alert {
  severity?: 'critical' | 'warning' | 'info'
  title?: string
  message?: string
}
interface Analysis {
  executive_summary?: string
  health_score?: {
    score?: number
    label?: string
    good_points?: Array<string>
    bad_points?: Array<string>
  }
  top_insights?: Array<Insight>
  alerts?: Array<Alert>
}

const ALERT_VARIANT: Record<string, 'destructive' | 'default' | 'secondary'> = {
  critical: 'destructive',
  warning: 'default',
  info: 'secondary',
}

function TrendIcon({ dir }: { dir?: string }) {
  if (dir === 'up') return <ArrowUp className="size-4 text-emerald-600" />
  if (dir === 'down') return <ArrowDown className="size-4 text-red-600" />
  return <Minus className="text-muted-foreground size-4" />
}

/** AI synthesis (Cerveau 3) for a company. Read-only; refreshed by the pipeline. */
export function CompanyIntelligenceCard({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation(['participations'])
  const { fmtDate } = useFormatters()
  const intel = useConvexQuery(api.intelligence.getByCompany, { companyId })

  if (intel === undefined) {
    return (
      <div className="text-muted-foreground text-sm">
        {t('participations:loading')}
      </div>
    )
  }

  const status = intel?.aiAnalysisStatus ?? null
  const analysis = (intel?.aiAnalysis ?? null) as Analysis | null

  if (!analysis || status !== 'completed') {
    const key =
      status === 'processing'
        ? 'processing'
        : status === 'error'
          ? 'error'
          : status === 'no_data'
            ? 'no_data'
            : 'empty'
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {t(`participations:intelligence.status.${key}`)}
      </div>
    )
  }

  const health = analysis.health_score
  const insights = analysis.top_insights ?? []
  const alerts = analysis.alerts ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{t('participations:intelligence.title')}</span>
          {typeof health?.score === 'number' && (
            <Badge variant="outline">
              {health.score}/10{health.label ? ` · ${health.label}` : ''}
            </Badge>
          )}
        </CardTitle>
        {analysis.executive_summary && (
          <CardDescription>{analysis.executive_summary}</CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-6 text-sm">
        {health && (
          <div className="grid gap-4 sm:grid-cols-2">
            {!!health.good_points?.length && (
              <div>
                <h4 className="mb-1 font-semibold text-emerald-700">
                  {t('participations:intelligence.section.good')}
                </h4>
                <ul className="list-disc space-y-1 pl-5">
                  {health.good_points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!health.bad_points?.length && (
              <div>
                <h4 className="mb-1 font-semibold text-red-700">
                  {t('participations:intelligence.section.bad')}
                </h4>
                <ul className="list-disc space-y-1 pl-5">
                  {health.bad_points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {insights.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold">
              {t('participations:intelligence.section.insights')}
            </h4>
            <div className="space-y-2">
              {insights.map((ins, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                >
                  <div>
                    <div className="font-medium">{ins.label}</div>
                    {ins.context && (
                      <div className="text-muted-foreground text-xs">
                        {ins.context}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="font-mono">{ins.current_value}</span>
                    <span className="flex items-center gap-1 text-xs">
                      <TrendIcon dir={ins.trend_direction} />
                      {ins.trend}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {alerts.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold">
              {t('participations:intelligence.section.alerts')}
            </h4>
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant={ALERT_VARIANT[a.severity ?? 'info'] ?? 'secondary'}>
                    {a.title}
                  </Badge>
                  <span className="text-muted-foreground">{a.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {intel?.aiAnalysisUpdatedAt && (
          <p className="text-muted-foreground text-xs">
            {t('participations:intelligence.updated', {
              date: fmtDate(intel.aiAnalysisUpdatedAt),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
