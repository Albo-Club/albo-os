import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  FileChartColumn,
  FileText,
  Megaphone,
  Paperclip,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { ReactNode } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type { VascoCommunication } from '../../../convex/vasco'
import { AddReportDialog } from '~/components/companies/AddReportDialog'
import {
  VascoCommunicationDialog,
  useIsoDate,
  useVascoCommunications,
} from '~/components/vasco/VascoCommunications'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { LoadingLine, Spinner } from '~/components/ui/spinner'

/**
 * What a company SENDS us, in one chronological feed: the investor reports the
 * pipeline analysed, and the VASCO communications of the SPVs. It is the
 * journal of the fiche — read in order, once, when something lands.
 *
 * Documents used to share this feed. They no longer do: they are the vault,
 * not the journal, and they live in their own card in the identity panel
 * (`CompanyDocumentsCard`, which says why at length). What stays here is a
 * report's own attachments — they ARE the report, folded into its row, and
 * they never take a line of their own.
 *
 * The add door is shared with the documents card: same dialog, same full kind
 * selector, only the pre-selected kind differs. Opened from here it points at
 * "reporting", so the pipeline is the default of the reports section and a
 * plain filing the default of the vault.
 */

type ReportRow = FunctionReturnType<
  typeof api.companyReports.listByCompany
>[number]
type ReportDoc = { _id: Id<'documents'>; title: string; url: string | null }

/** One line of the feed. `sortDate` is the single axis: a covered period when
 * the entry has one, its arrival date otherwise. */
type Entry =
  | { key: string; sortDate: number; type: 'report'; report: ReportRow }
  | { key: string; sortDate: number; type: 'vasco'; comm: VascoCommunication }

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

// ─── Rows ────────────────────────────────────────────────────────────────────

/** Shared shell of the two rows (report, VASCO): a square glyph, a title line
 * with badges, and a chevron — the whole row opens the detail. The glyph
 * square is tinted `info` and the glyph itself is the caller's, so a reporting
 * and a VASCO communication are told apart before the badge is read. */
function CommunicationRow({
  glyph,
  title,
  badges,
  preview,
  meta,
  attachments,
  onOpen,
  ariaLabel,
}: {
  glyph: ReactNode
  title: string
  badges: ReactNode
  preview: string | null
  meta: string
  attachments: ReactNode
  onOpen: () => void
  ariaLabel: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="hover:bg-accent/40 focus-visible:ring-ring flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="bg-info/10 text-info flex size-10 shrink-0 items-center justify-center rounded-lg">
        {glyph}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {badges}
        </div>
        {preview && (
          <p className="text-muted-foreground truncate text-sm">{preview}</p>
        )}
        <p className="text-muted-foreground mt-0.5 text-xs">{meta}</p>
      </div>

      {attachments}
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </div>
  )
}

/** A report's source files, folded into the row: they are the report, not
 * separate documents, so they never reach the documents card. */
function ReportDocsButton({ docs }: { docs: Array<ReportDoc> }) {
  const { t } = useTranslation('participations')
  const usable = docs.filter((d) => d.url)
  if (usable.length === 0) return null

  const label = t('timeline.files', { count: usable.length })

  if (usable.length === 1) {
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-7 shrink-0 rounded-full px-2.5 text-xs font-normal"
        title={usable[0].title}
      >
        <a
          href={usable[0].url!}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <Paperclip className="size-3.5" />
          {label}
        </a>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 rounded-full px-2.5 text-xs font-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <Paperclip className="size-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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

function ReportEntry({
  report,
  docs,
  isLatest,
  onOpen,
}: {
  report: ReportRow
  docs: Array<ReportDoc>
  isLatest: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const relAge = useRelativeAge()
  const received = report.processedAt ?? report.emailDate
  const title = report.reportPeriod ?? report.title ?? t('reports.untitled')

  return (
    <CommunicationRow
      glyph={<FileChartColumn className="size-4" />}
      title={title}
      ariaLabel={t('timeline.openReport', { title })}
      badges={
        <>
          <Badge variant="secondary" className="shrink-0">
            {t('timeline.badge.report')}
          </Badge>
          {isLatest && (
            <Badge variant="outline" className="shrink-0 font-normal">
              {t('reports.history.current')}
            </Badge>
          )}
        </>
      }
      preview={report.headline}
      meta={
        received == null
          ? t('reports.history.received', { date: '—' })
          : `${t('reports.history.received', { date: fmtDate(received) })} · ${relAge(received)}`
      }
      attachments={<ReportDocsButton docs={docs} />}
      onOpen={onOpen}
    />
  )
}

function VascoEntry({
  comm,
  onOpen,
}: {
  comm: VascoCommunication
  onOpen: () => void
}) {
  const { t } = useTranslation(['participations', 'vasco'])
  const fmtIso = useIsoDate()
  const title = comm.title ?? t('vasco:communications.untitled')

  return (
    <CommunicationRow
      glyph={<Megaphone className="size-4" />}
      title={title}
      ariaLabel={t('participations:timeline.openCommunication', { title })}
      badges={
        <Badge variant="outline" className="shrink-0 font-normal">
          {t('participations:timeline.badge.vasco')}
        </Badge>
      }
      preview={comm.bodyText ? comm.bodyText.replace(/\s+/g, ' ').trim() : null}
      meta={t('vasco:communications.publishedOn', {
        date: fmtIso(comm.publishDate ?? comm.period),
      })}
      attachments={
        comm.documents.length > 0 ? (
          <span className="text-muted-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs">
            <Paperclip className="size-3.5" />
            {t('participations:timeline.files', {
              count: comm.documents.length,
            })}
          </span>
        ) : null
      }
      onOpen={onOpen}
    />
  )
}

// ─── Report detail ───────────────────────────────────────────────────────────

function ReportDetailDialog({
  openId,
  onClose,
  onDetach,
  onDelete,
}: {
  openId: Id<'companyReports'> | null
  onClose: () => void
  onDetach: () => void
  onDelete: () => void
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
          <LoadingLine>{t('loading')}</LoadingLine>
        ) : (
          <div className="space-y-4 text-sm">
            {detail.headline && (
              <p className="font-medium">{detail.headline}</p>
            )}

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

        {/* Two ways out: detach leaves the files (and the mail replayable),
            delete takes them with it. */}
        <DialogFooter className="sm:justify-start">
          <Button variant="outline" size="sm" onClick={onDetach}>
            {t('timeline.detach.action')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            {t('timeline.deleteReport.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Progress line ───────────────────────────────────────────────────────────

/** One manual upload still in the pipeline, or stuck in the review queue. */
function UploadProgressLine({
  subject,
  status,
  statusReason,
}: {
  subject: string
  status: string
  statusReason: string | null
}) {
  const { t } = useTranslation(['participations', 'reports'])
  const failed = status === 'needs_review'

  return (
    <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
      {!failed && <Spinner className="mt-0.5 size-3.5 shrink-0" />}
      <span>
        <span className="text-foreground font-medium">{subject}</span>{' '}
        {failed
          ? t('participations:reports.add.progress.failed', {
              reason: t(`reports:reasons.${statusReason ?? 'unknown'}`, {
                defaultValue: statusReason ?? '',
              }),
            })
          : t('participations:reports.add.progress.running')}
      </span>
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function CompanyReportsSection({
  company,
}: {
  company: Doc<'companies'>
}) {
  const { t } = useTranslation(['participations', 'vasco', 'common'])

  const docs = useConvexQuery(api.documents.listByCompany, {
    companyId: company._id,
  })
  const reports = useConvexQuery(api.companyReports.listByCompany, {
    companyId: company._id,
  })
  const pending = useConvexQuery(api.reportInbox.listUploadsInProgress, {
    companyId: company._id,
  })
  const vasco = useVascoCommunications(company)
  const detachReport = useConvexMutation(api.reportInbox.detachCompany)
  const deleteReport = useConvexMutation(api.reportInbox.deleteReport)

  const [addOpen, setAddOpen] = useState(false)
  const [reportId, setReportId] = useState<Id<'companyReports'> | null>(null)
  const [commId, setCommId] = useState<string | null>(null)
  // Same confirmation dialog for both ways out — only the copy and the
  // mutation differ (detach keeps the files, delete takes them).
  const [confirm, setConfirm] = useState<{
    reportId: Id<'companyReports'>
    mode: 'detach' | 'deleteReport'
  } | null>(null)

  // A report's attachments are folded into their report's row. This is the
  // only reason the section reads the documents at all.
  const docsByReport = useMemo(() => {
    const map = new Map<string, Array<ReportDoc>>()
    for (const doc of docs ?? []) {
      if (!doc.reportId) continue
      const list = map.get(doc.reportId) ?? []
      list.push({ _id: doc._id, title: doc.title, url: doc.url })
      map.set(doc.reportId, list)
    }
    return map
  }, [docs])

  const entries: Array<Entry> | undefined = useMemo(() => {
    if (!reports) return undefined
    const rows: Array<Entry> = []
    for (const report of reports) {
      rows.push({
        key: report._id,
        type: 'report',
        report,
        sortDate:
          report.periodSortDate ?? report.processedAt ?? report.emailDate ?? 0,
      })
    }
    for (const comm of vasco.communications) {
      const raw = comm.publishDate ?? comm.period
      const parsed = raw ? Date.parse(raw) : NaN
      rows.push({
        key: comm.communicationId,
        type: 'vasco',
        comm,
        sortDate: Number.isNaN(parsed) ? 0 : parsed,
      })
    }
    return rows.sort((a, b) => b.sortDate - a.sortDate)
  }, [reports, vasco.communications])

  const latestReportId = entries?.find((e) => e.type === 'report')?.key ?? null
  const openComm =
    vasco.communications.find((c) => c.communicationId === commId) ?? null

  // The dialog stays mounted while it closes, so the copy falls back on the
  // detach wording rather than flipping mid-animation.
  const confirmMode = confirm?.mode ?? 'detach'

  async function handleConfirm() {
    if (!confirm) return
    const run = confirm.mode === 'detach' ? detachReport : deleteReport
    try {
      await run({ reportId: confirm.reportId })
      toast.success(t(`participations:timeline.${confirm.mode}.done`))
    } catch {
      toast.error(t('participations:documents.errors.default'))
    } finally {
      setConfirm(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold tracking-tight">
          {t('participations:timeline.title')}
        </h2>

        {vasco.linked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void vasco.doRefresh()}
            disabled={vasco.refreshing}
          >
            <RefreshCw
              className={vasco.refreshing ? 'size-4 animate-spin' : 'size-4'}
            />
            {t('participations:timeline.refreshVasco')}
          </Button>
        )}

        {/* The pipeline only analyses a portfolio company (`createFromUpload`
            refuses anything else), so the door is not offered elsewhere — a
            group entity files its documents in the identity panel. */}
        {company.kind === 'portfolio' && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            {t('participations:timeline.add.action')}
          </Button>
        )}
      </div>

      {pending?.map((row) => (
        <UploadProgressLine
          key={row._id}
          subject={row.subject}
          status={row.status}
          statusReason={row.statusReason}
        />
      ))}

      {!entries || vasco.loading ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t('participations:timeline.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) =>
            entry.type === 'report' ? (
              <ReportEntry
                key={entry.key}
                report={entry.report}
                docs={docsByReport.get(entry.report._id) ?? []}
                isLatest={entry.key === latestReportId}
                onOpen={() => setReportId(entry.report._id)}
              />
            ) : (
              <VascoEntry
                key={entry.key}
                comm={entry.comm}
                onOpen={() => setCommId(entry.comm.communicationId)}
              />
            ),
          )}
        </div>
      )}

      <AddReportDialog
        companyId={company._id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <ReportDetailDialog
        openId={reportId}
        onClose={() => setReportId(null)}
        onDetach={() => {
          if (reportId) setConfirm({ reportId, mode: 'detach' })
          setReportId(null)
        }}
        onDelete={() => {
          if (reportId) setConfirm({ reportId, mode: 'deleteReport' })
          setReportId(null)
        }}
      />

      <VascoCommunicationDialog
        communication={openComm}
        orgId={company.orgId}
        clientSlug={vasco.clientSlug}
        onClose={() => setCommId(null)}
      />

      {/* Detach / delete confirmation */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t(`participations:timeline.${confirmMode}.confirmTitle`)}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t(`participations:timeline.${confirmMode}.confirmBody`, {
              company: company.name,
            })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirm()}>
              {t(`participations:timeline.${confirmMode}.confirm`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
