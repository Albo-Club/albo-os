import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText } from 'lucide-react'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
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

// ─── Report history ──────────────────────────────────────────────────────────

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
      <h2 className="text-lg font-semibold tracking-tight">
        {t('reports.history.title')}
      </h2>

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
 * Reports tab: a clickable history of email-ingested investor reports.
 * Read-only; the report pipeline does the writing. The company-level AI
 * synthesis now lives in its own full-width block above the tabs
 * (CompanyAiSynthesisBlock).
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

  return <ReportHistory companyId={companyId} reports={reports} />
}
