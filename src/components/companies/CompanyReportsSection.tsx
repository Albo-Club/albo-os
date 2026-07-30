import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
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
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { LoadingLine, Spinner } from '~/components/ui/spinner'

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
    <>
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
    </>
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
          <LoadingLine>{t('loading')}</LoadingLine>
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

// ─── Manual upload ───────────────────────────────────────────────────────────

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. convex/files.ts)

/**
 * Adds a report by hand: the picked file(s) go to Convex storage, then
 * `reportInbox.createFromUpload` pushes them through the SAME pipeline as an
 * emailed report (extraction → analysis → report + metrics). Nothing appears
 * instantly — the progress line below the header tracks the run.
 */
function AddReportDialog({
  companyId,
  open,
  onClose,
}: {
  companyId: Id<'companies'>
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createFromUpload = useConvexMutation(api.reportInbox.createFromUpload)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Array<File>>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function close() {
    setFiles([])
    setNote('')
    onClose()
  }

  async function handleSubmit() {
    if (files.length === 0) return
    setSaving(true)
    try {
      const storageIds: Array<Id<'_storage'>> = []
      for (const file of files) {
        const url = await generateUploadUrl({})
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!res.ok) {
          toast.error(t('participations:reports.add.errors.default'))
          return
        }
        const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
        storageIds.push(storageId)
      }
      await createFromUpload({
        companyId,
        storageIds,
        filenames: files.map((f) => f.name),
        note: note.trim() || undefined,
      })
      toast.success(t('participations:reports.add.queued'))
      close()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('participations:reports.add.errors.too_large')
          : t('participations:reports.add.errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('participations:reports.add.dialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t('participations:reports.add.description')}
          </p>

          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="size-4" />
              {t('participations:reports.add.pick')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])]
                e.target.value = ''
                if (picked.some((f) => f.size > MAX_BYTES)) {
                  toast.error(t('participations:reports.add.errors.too_large'))
                  return
                }
                setFiles((prev) => [...prev, ...picked])
              }}
            />
            {files.length > 0 && (
              <ul className="text-muted-foreground space-y-1 text-sm">
                {files.map((f) => (
                  <li key={f.name} className="truncate">
                    {f.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-note">
              {t('participations:reports.add.noteLabel')}
            </Label>
            <Textarea
              id="report-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('participations:reports.add.notePlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={saving || files.length === 0}
          >
            {saving && <Spinner />}
            {saving
              ? t('participations:reports.add.uploading')
              : t('participations:reports.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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

/**
 * Reports tab: a clickable history of investor reports, plus the button that
 * adds one by hand. Reports themselves are always written by the pipeline —
 * from an email, or from a manual upload (AddReportDialog).
 * The company-level AI synthesis lives in its own full-width block above the
 * tabs (CompanyAiSynthesisBlock).
 */
export function CompanyReportsSection({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation('participations')
  const reports = useConvexQuery(api.companyReports.listByCompany, { companyId })
  const pending = useConvexQuery(api.reportInbox.listUploadsInProgress, {
    companyId,
  })
  const [addOpen, setAddOpen] = useState(false)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('reports.history.title')}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          {t('reports.add.action')}
        </Button>
      </div>

      {pending?.map((row) => (
        <UploadProgressLine
          key={row._id}
          subject={row.subject}
          status={row.status}
          statusReason={row.statusReason}
        />
      ))}

      {!reports ? (
        <LoadingLine>{t('loading')}</LoadingLine>
      ) : reports.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t('reports.empty')}
        </div>
      ) : (
        <ReportHistory companyId={companyId} reports={reports} />
      )}

      <AddReportDialog
        companyId={companyId}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </section>
  )
}
