import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Loader2,
  Minus,
  RefreshCw,
} from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionBadgeClass } from '~/lib/moneyTone'
import { scoreVerdict, verdictSquareClass } from '~/lib/reportScore'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'

// Shape of companyIntelligence.aiAnalysis (Cerveau 3).
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

function TrendIcon({ dir }: { dir?: string }) {
  if (dir === 'up') return <ArrowUp className="size-3.5" />
  if (dir === 'down') return <ArrowDown className="size-3.5" />
  return <Minus className="size-3.5" />
}

/**
 * Full-width AI synthesis block (company-level Cerveau 3): score square + TL;DR,
 * conditional critical alert, strengths / watch points, three KPIs. Read-only;
 * the report pipeline does the writing. Lives outside the reporting tabs. When
 * no synthesis exists yet the placeholder stays a single discreet line.
 */
export function CompanyAiSynthesisBlock({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const [alertOpen, setAlertOpen] = useState(false)
  const intel = useConvexQuery(api.intelligence.getByCompany, { companyId })

  if (intel === undefined) {
    return <div className="text-muted-foreground text-sm">{t('loading')}</div>
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
    // Standalone placeholder: a single sober line, not a boxed empty state.
    // The rerun button sits at the right so empty/error entities (e.g. Parallel
    // ones, which never receive a mail report) can trigger the synthesis.
    return (
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
        <span>{t(`intelligence.status.${key}`)}</span>
        <RerunButton companyId={companyId} status={status} />
      </div>
    )
  }

  const health = analysis.health_score
  const score = typeof health?.score === 'number' ? health.score : null
  const verdict = score !== null ? scoreVerdict(score) : null
  const good = health?.good_points ?? []
  const bad = health?.bad_points ?? []
  const insights = (analysis.top_insights ?? []).slice(0, 3)
  const criticalAlert = (analysis.alerts ?? []).find(
    (a) => a.severity === 'critical',
  )

  return (
    <div className="bg-card space-y-4 rounded-xl border p-5">
      {/* Light header: label left, generation date + rerun button right. */}
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span>{t('reports.synthesis.header')}</span>
        <div className="flex items-center gap-1">
          {intel?.aiAnalysisUpdatedAt && (
            <span>
              {t('reports.synthesis.generatedAt', {
                date: fmtDate(intel.aiAnalysisUpdatedAt),
              })}
            </span>
          )}
          <RerunButton companyId={companyId} status={status} />
        </div>
      </div>

      {/* Hero line: score square + verdict + one-line TL;DR. */}
      <div className="flex items-start gap-4">
        {score !== null && verdict && (
          <div
            className={cn(
              'flex size-13 shrink-0 items-center justify-center rounded-lg border text-2xl font-semibold',
              verdictSquareClass(verdict),
            )}
          >
            {score}
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">
              {health?.label ??
                (verdict ? t(`reports.verdict.${verdict}`) : '')}
            </span>
            {score !== null && (
              <span className="text-muted-foreground text-sm">
                {t('reports.synthesis.scoreValue', { score })}
              </span>
            )}
          </div>
          {analysis.executive_summary && (
            <p className="text-muted-foreground text-[15px] leading-snug">
              {analysis.executive_summary}
            </p>
          )}
        </div>
      </div>

      {/* Critical alert — inline, conditional, expandable (not a full banner). */}
      {criticalAlert && (
        <button
          type="button"
          onClick={() => setAlertOpen((o) => !o)}
          className="border-destructive/25 bg-destructive/10 flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm"
        >
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="text-destructive font-medium">
              {criticalAlert.title}
            </span>
            {alertOpen && criticalAlert.message && (
              <span className="text-muted-foreground mt-1 block">
                {criticalAlert.message}
              </span>
            )}
          </span>
          <ChevronRight
            className={cn(
              'text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform',
              alertOpen && 'rotate-90',
            )}
          />
        </button>
      )}

      {/* Strengths / watch points — two equal columns, one-line bullets. */}
      {(good.length > 0 || bad.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <BulletColumn
            title={t('intelligence.section.good')}
            tone="positive"
            items={good}
          />
          <BulletColumn
            title={t('intelligence.section.bad')}
            tone="destructive"
            items={bad}
          />
        </div>
      )}

      {/* Three KPIs — aligned row, equal heights. */}
      {insights.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {insights.map((ins, i) => (
            <KpiTile key={i} insight={ins} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * "Rerun analysis" trigger. Kicks `intelligence.rerun` (org-guarded); the block
 * re-renders reactively as the status moves processing → completed. `busy`
 * combines the in-flight mutation and the backend `processing` status so the
 * spinner stays continuous from click to result (no flicker in between).
 */
function RerunButton({
  companyId,
  status,
}: {
  companyId: Id<'companies'>
  status: string | null
}) {
  const { t } = useTranslation('participations')
  const rerun = useConvexMutation(api.intelligence.rerun)
  const [pending, setPending] = useState(false)
  const busy = pending || status === 'processing'

  async function handleClick() {
    setPending(true)
    try {
      await rerun({ companyId })
    } catch {
      toast.error(t('intelligence.rerunError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-auto gap-1.5 px-2 py-1 text-xs"
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {t('intelligence.rerun')}
    </Button>
  )
}

function BulletColumn({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'positive' | 'destructive'
  items: Array<string>
}) {
  if (items.length === 0) return <div />
  return (
    <div className="space-y-1">
      <h4
        className={cn(
          'text-xs font-semibold tracking-wide uppercase',
          tone === 'positive' ? 'text-positive' : 'text-destructive',
        )}
      >
        {title}
      </h4>
      <ul className="space-y-1 text-sm">
        {items.map((item, i) => (
          <li key={i} className="truncate" title={item}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function KpiTile({ insight }: { insight: Insight }) {
  const dir = insight.trend_direction
  const pill =
    dir === 'up'
      ? directionBadgeClass(true)
      : dir === 'down'
        ? directionBadgeClass(false)
        : 'border-border bg-muted text-muted-foreground'
  return (
    <div className="flex flex-col rounded-lg border p-3">
      <span className="text-muted-foreground truncate text-xs tracking-wide uppercase">
        {insight.label}
      </span>
      <span className="mt-1 text-[22px] leading-tight font-semibold">
        {insight.current_value ?? '—'}
      </span>
      <div className="mt-1.5 flex items-center gap-2">
        {insight.trend && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs',
              pill,
            )}
          >
            <TrendIcon dir={dir} />
            {insight.trend}
          </span>
        )}
      </div>
      {insight.context && (
        <span className="text-muted-foreground mt-1 truncate text-xs" title={insight.context}>
          {insight.context}
        </span>
      )}
    </div>
  )
}
