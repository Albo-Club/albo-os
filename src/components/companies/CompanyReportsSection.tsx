import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileText,
  Minus,
  Plus,
} from 'lucide-react'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionBadgeClass } from '~/lib/moneyTone'
import { scoreVerdict, verdictSquareClass } from '~/lib/reportScore'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'

// Shape of companyIntelligence.aiAnalysis (Cerveau 3). Kept in sync with
// CompanyIntelligenceCard — same backend payload, different presentation.
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

type ReportDoc = { _id: Id<'documents'>; title: string; url: string | null }

/** Localised relative age, e.g. "il y a 13 j" / "13 days ago". */
function useRelativeAge() {
  const { i18n } = useTranslation()
  return (ms: number) => {
    const days = Math.round((Date.now() - ms) / 86_400_000)
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    if (Math.abs(days) < 45) return rtf.format(-days, 'day')
    const months = Math.round(days / 30)
    if (Math.abs(months) < 12) return rtf.format(-months, 'month')
    return rtf.format(-Math.round(days / 365), 'year')
  }
}

function TrendIcon({ dir }: { dir?: string }) {
  if (dir === 'up') return <ArrowUp className="size-3.5" />
  if (dir === 'down') return <ArrowDown className="size-3.5" />
  return <Minus className="size-3.5" />
}

// ─── Zone 1 — AI synthesis hero ──────────────────────────────────────────────

function SynthesisHero({ companyId }: { companyId: Id<'companies'> }) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const [alertOpen, setAlertOpen] = useState(false)
  const intel = useConvexQuery(api.intelligence.getByCompany, { companyId })

  if (intel === undefined) {
    return (
      <div className="text-muted-foreground text-sm">
        {t('loading')}
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
      <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
        {t(`intelligence.status.${key}`)}
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
      {/* Light header: label left, generation date right. */}
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span>{t('reports.synthesis.header')}</span>
        {intel?.aiAnalysisUpdatedAt && (
          <span>
            {t('reports.synthesis.generatedAt', {
              date: fmtDate(intel.aiAnalysisUpdatedAt),
            })}
          </span>
        )}
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

// ─── Zone 2 — report history ─────────────────────────────────────────────────

type ReportRow = { _id: Id<'companyReports'>; title: string | null; headline: string | null; reportPeriod: string | null; emailDate: number | null; processedAt: number | null }

function ReportHistory({
  companyId,
  reports,
}: {
  companyId: Id<'companies'>
  reports: Array<ReportRow>
}) {
  const { t } = useTranslation('participations')
  const [openId, setOpenId] = useState<Id<'companyReports'> | null>(null)
  const docs = useConvexQuery(api.documents.listByCompany, { companyId })

  // Group a report's source attachments (email-ingested docs carry reportId).
  const docsByReport = useMemo(() => {
    const map = new Map<string, Array<ReportDoc>>()
    for (const d of docs ?? []) {
      if (!d.reportId) continue
      const list = map.get(d.reportId) ?? []
      list.push({ _id: d._id, title: d.title, url: d.url })
      map.set(d.reportId, list)
    }
    return map
  }, [docs])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('reports.history.title')}
        </h2>
        {/* Reports are ingested by email (read-only) — no manual create path
            exists yet, so the action is a disabled, explained affordance. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" size="sm" disabled>
                  <Plus className="size-4" />
                  {t('reports.history.add')}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('reports.history.addHint')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-2">
        {reports.map((r, i) => (
          <ReportCard
            key={r._id}
            report={r}
            isLatest={i === 0}
            docs={docsByReport.get(r._id) ?? []}
            onOpen={() => setOpenId(r._id)}
          />
        ))}
      </div>

      <ReportDetailDialog
        openId={openId}
        onClose={() => setOpenId(null)}
      />
    </section>
  )
}

function ReportCard({
  report,
  isLatest,
  docs,
  onOpen,
}: {
  report: ReportRow
  isLatest: boolean
  docs: Array<ReportDoc>
  onOpen: () => void
}) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const relAge = useRelativeAge()
  const received = report.processedAt ?? report.emailDate

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
    >
      {/* Neutral square — individual reports carry no health score (it lives at
          company level in the synthesis above). */}
      <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
        <FileText className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">
            {report.reportPeriod ??
              report.title ??
              t('reports.untitled')}
          </span>
          {isLatest && (
            <Badge variant="secondary" className="shrink-0">
              {t('reports.history.current')}
            </Badge>
          )}
        </div>
        {report.headline && (
          <p className="text-muted-foreground truncate text-sm">
            {report.headline}
          </p>
        )}
        {received != null && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('reports.history.received', { date: fmtDate(received) })} ·{' '}
            {relAge(received)}
          </p>
        )}
      </div>

      <ReportDocsButton docs={docs} />
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </div>
  )
}

/** "View documents" — opens a report's source attachment(s). Own click target
 *  (stopPropagation) so it doesn't open the report detail. */
function ReportDocsButton({ docs }: { docs: Array<ReportDoc> }) {
  const { t } = useTranslation('participations')
  const usable = docs.filter((d) => d.url)
  if (usable.length === 0) return null

  const label = t('reports.history.viewDocs')

  if (usable.length === 1) {
    return (
      <Button
        asChild
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={label}
        title={label}
      >
        <a
          href={usable[0].url!}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="size-4" />
        </a>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label={label}
          title={label}
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        {usable.map((d) => (
          <DropdownMenuItem key={d._id} asChild>
            <a href={d.url!} target="_blank" rel="noreferrer">
              <FileText className="size-4" />
              <span className="truncate">{d.title}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ReportDetailDialog({
  openId,
  onClose,
}: {
  openId: Id<'companyReports'> | null
  onClose: () => void
}) {
  const { t } = useTranslation('participations')
  const detail = useConvexQuery(
    api.companyReports.getById,
    openId ? { reportId: openId } : 'skip',
  )

  return (
    <Dialog open={openId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detail?.title ?? detail?.reportPeriod ?? t('reports.title')}
          </DialogTitle>
        </DialogHeader>

        {!detail ? (
          <div className="text-muted-foreground text-sm">
            {t('loading')}
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {detail.headline && <p className="font-medium">{detail.headline}</p>}

            {detail.keyHighlights.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {detail.keyHighlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}

            {Object.keys(detail.metrics).length > 0 && (
              <div>
                <h4 className="mb-1 font-semibold">{t('reports.metrics')}</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {Object.entries(detail.metrics).map(([k, val]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-mono">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.rawContent && (
              <div>
                <h4 className="mb-1 font-semibold">{t('reports.content')}</h4>
                <div className="text-muted-foreground max-h-72 overflow-y-auto rounded-md border p-3 whitespace-pre-wrap">
                  {detail.rawContent}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────

/**
 * Reports tab: an AI synthesis hero (zone 1, company-level Cerveau 3) over a
 * clickable history of email-ingested investor reports (zone 2). Read-only;
 * the report pipeline does the writing.
 */
export function CompanyReportsSection({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation('participations')
  const reports = useConvexQuery(api.companyReports.listByCompany, { companyId })

  if (!reports) {
    return (
      <div className="text-muted-foreground text-sm">
        {t('loading')}
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        {t('reports.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SynthesisHero companyId={companyId} />
      <ReportHistory companyId={companyId} reports={reports} />
    </div>
  )
}
