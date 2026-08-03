import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ChevronRight, FileText, Paperclip, Plus, RefreshCw } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { ReactNode } from 'react'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type { VascoCommunication } from '../../../convex/vasco'
import {
  VascoCommunicationDialog,
  useIsoDate,
  useVascoCommunications,
} from '~/components/vasco/VascoCommunications'
import { DocumentAttachment } from '~/components/documents/DocumentAttachment'
import { ExtractedTextDialog } from '~/components/documents/DocumentReading'
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { LoadingLine, Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

/**
 * The single timeline of a company fiche: investor reports (analysed by the
 * pipeline), VASCO communications, and the documents filed on the entity —
 * deal documents included. One list, sorted by date, because the split between
 * "reports" and "documents" was a filing decision the reader had to make
 * BEFORE knowing what the file was: a reporting dropped in the documents tab
 * silently stayed a mute PDF, and a pacte lived only on its deal sheet while
 * it binds the legal entity.
 *
 * Two ingestion doors remain, but the choice is now explicit and its
 * consequence is written next to it: a "reporting" runs the analysis pipeline
 * (period, key points, KPIs, synthesis), anything else is a plain deposit.
 */

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. convex/files.ts)

/** Kinds offered on an entity, then the deal-specific ones. `other` sits in
 * the first group only — it is the same value in the schema. */
const COMPANY_KINDS = ['reporting', 'bp', 'legal', 'other'] as const
const DEAL_KINDS = [
  'term_sheet',
  'pacte',
  'subscription',
  'attestation',
] as const
type DocKind = FunctionArgs<typeof api.documents.create>['kind']

/** Deal kinds carry a document date, entity kinds a covered period. */
function isDealKind(kind: string): boolean {
  return (DEAL_KINDS as ReadonlyArray<string>).includes(kind)
}

type CompanyDoc = FunctionReturnType<typeof api.documents.listByCompany>[number]
type ReportRow = FunctionReturnType<
  typeof api.companyReports.listByCompany
>[number]
type ReportDoc = { _id: Id<'documents'>; title: string; url: string | null }
/** A deal, reduced to what the picker and the badge need. `name` is optional:
 * the enriched deal rows leave it undefined, the document query nulls it. */
type DealOption = {
  _id: Id<'deals'>
  name?: string | null
  instrumentKind: string
}

/** One line of the timeline, whatever it is made of. `sortDate` is the single
 * axis: a covered period when the entry has one, its arrival date otherwise. */
type Entry =
  | { key: string; sortDate: number; type: 'report'; report: ReportRow }
  | { key: string; sortDate: number; type: 'vasco'; comm: VascoCommunication }
  | { key: string; sortDate: number; type: 'doc'; doc: CompanyDoc }

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ms epoch → the value shape of an `<input type="month">` / `"date"`. */
function toDateInput(period: number, dealKind: boolean): string {
  const date = new Date(period)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  if (!dealKind) return `${date.getUTCFullYear()}-${month}`
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

/** "YYYY-MM" or "YYYY-MM-DD" → ms epoch UTC. Empty clears the field. */
function fromDateInput(value: string): number | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-')
  return Date.UTC(Number(year), Number(month) - 1, day ? Number(day) : 1)
}

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

/** Shared shell of the two "communication" rows (report, VASCO): a square
 * glyph, a title line with badges, and a chevron — the whole row opens the
 * detail. Documents keep their own attachment card (they open a file). */
function CommunicationRow({
  title,
  badges,
  preview,
  meta,
  attachments,
  onOpen,
  ariaLabel,
}: {
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
      <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
        <FileText className="size-4" />
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
 * separate documents, so they never get their own line in the timeline. */
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

// ─── Add ─────────────────────────────────────────────────────────────────────

/**
 * The single "Add" door. The chosen type decides what happens to the file:
 * a reporting goes through the analysis pipeline (`reportInbox.createFromUpload`,
 * same circuit as a forwarded email — it names and dates the report itself,
 * hence no title/period field), anything else is stored as-is.
 *
 * The pipeline only knows how to analyse a portfolio company, so the reporting
 * option is hidden on group entities.
 */
function AddDialog({
  company,
  deals,
  open,
  onClose,
}: {
  company: Doc<'companies'>
  deals: Array<DealOption>
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)
  const createFromUpload = useConvexMutation(api.reportInbox.createFromUpload)

  const canAnalyse = company.kind === 'portfolio'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Array<File>>([])
  const [titles, setTitles] = useState<Array<string>>([])
  const [kind, setKind] = useState<string>(canAnalyse ? 'reporting' : 'other')
  const [dateValue, setDateValue] = useState('')
  const [dealId, setDealId] = useState<string>('none')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // The reporting flow owns the metadata (the analysis extracts the period and
  // titles the report), so the form collapses to files + a context note.
  const analysing = canAnalyse && kind === 'reporting'

  function close() {
    setFiles([])
    setTitles([])
    setKind(canAnalyse ? 'reporting' : 'other')
    setDateValue('')
    setDealId('none')
    setNote('')
    onClose()
  }

  /** Whole selection or nothing: an oversized file in the batch rejects the
   * pick, so the user re-picks knowingly rather than silently losing one. */
  function handlePick(picked: Array<File>) {
    if (picked.some((file) => file.size > MAX_BYTES)) {
      toast.error(t('participations:timeline.errors.too_large'))
      return
    }
    setFiles((prev) => [...prev, ...picked])
    setTitles((prev) => [
      ...prev,
      ...picked.map((file) => file.name.replace(/\.[^.]+$/, '')),
    ])
  }

  /** Uploads one file to Convex storage, returns its storage id. */
  async function upload(file: File): Promise<Id<'_storage'>> {
    const url = await generateUploadUrl({})
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) throw new Error('upload_failed')
    const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
    return storageId
  }

  async function handleSubmit() {
    if (files.length === 0) return
    if (!analysing && titles.some((value) => !value.trim())) return
    setSaving(true)
    try {
      if (analysing) {
        const storageIds: Array<Id<'_storage'>> = []
        for (const file of files) storageIds.push(await upload(file))
        await createFromUpload({
          companyId: company._id,
          storageIds,
          filenames: files.map((f) => f.name),
          note: note.trim() || undefined,
        })
        toast.success(t('participations:timeline.queued'))
        close()
        return
      }

      // One upload + one create per file, in series. A failure stops the
      // batch: the documents already created stay (the list refreshes on
      // its own), the rest never left the browser.
      const period = fromDateInput(dateValue)
      for (const [index, file] of files.entries()) {
        const storageId = await upload(file)
        await createDocument({
          companyId: company._id,
          dealId: dealId === 'none' ? undefined : (dealId as Id<'deals'>),
          title: titles[index],
          kind: kind as DocKind,
          period,
          storageId,
        })
      }
      toast.success(t('participations:timeline.added', { count: files.length }))
      close()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('participations:timeline.errors.too_large')
          : t('participations:timeline.errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('participations:timeline.add.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="size-4" />
              {t('participations:timeline.add.pick')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])]
                e.target.value = ''
                if (picked.length > 0) handlePick(picked)
              }}
            />
            {analysing && files.length > 0 && (
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
            <Label>{t('participations:timeline.kindLabel')}</Label>
            <KindSelect value={kind} onChange={setKind} canAnalyse={canAnalyse} />
          </div>

          {analysing ? (
            <>
              <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
                {t('participations:timeline.add.analysisHint')}
              </p>
              <div className="space-y-2">
                <Label htmlFor="timeline-note">
                  {t('participations:timeline.add.noteLabel')}
                </Label>
                <Textarea
                  id="timeline-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t(
                    'participations:timeline.add.notePlaceholder',
                  )}
                />
              </div>
            </>
          ) : (
            <>
              {files.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="timeline-title">
                    {t('participations:timeline.titleLabel', {
                      count: titles.length,
                    })}
                  </Label>
                  {titles.map((value, index) => (
                    <div key={index} className="space-y-1">
                      {/* The file name only earns its place when several
                          titles are stacked and one input no longer says
                          which is which. */}
                      {files.length > 1 && (
                        <p className="text-muted-foreground truncate text-xs">
                          {files[index].name}
                        </p>
                      )}
                      <Input
                        id={index === 0 ? 'timeline-title' : undefined}
                        value={value}
                        onChange={(e) =>
                          setTitles((prev) =>
                            prev.map((prevTitle, i) =>
                              i === index ? e.target.value : prevTitle,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="timeline-date">
                  {isDealKind(kind)
                    ? t('participations:timeline.dateLabel')
                    : t('participations:timeline.periodLabel')}
                </Label>
                <Input
                  id="timeline-date"
                  type={isDealKind(kind) ? 'date' : 'month'}
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                />
              </div>

              {deals.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('participations:timeline.dealLabel')}</Label>
                  <DealSelect
                    deals={deals}
                    value={dealId}
                    onChange={setDealId}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              saving ||
              files.length === 0 ||
              (!analysing && titles.some((value) => !value.trim()))
            }
          >
            {saving && <Spinner />}
            {saving
              ? t('participations:timeline.uploading')
              : analysing
                ? t('participations:timeline.add.submitAnalyse')
                : t('participations:timeline.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The 8 kinds, grouped by what they describe: the entity, or one of its
 * deals. Same list on the add and the edit dialog. */
function KindSelect({
  value,
  onChange,
  canAnalyse,
}: {
  value: string
  onChange: (value: string) => void
  canAnalyse: boolean
}) {
  const { t } = useTranslation('participations')
  const companyKinds = COMPANY_KINDS.filter(
    (k) => k !== 'reporting' || canAnalyse,
  )

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t('timeline.group.company')}</SelectLabel>
          {companyKinds.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`timeline.kind.${k}`)}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{t('timeline.group.deal')}</SelectLabel>
          {DEAL_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`timeline.kind.${k}`)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DealSelect({
  deals,
  value,
  onChange,
}: {
  deals: Array<DealOption>
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('participations')
  const label = useDealLabel()

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t('timeline.dealNone')}</SelectItem>
        {deals.map((deal) => (
          <SelectItem key={deal._id} value={deal._id}>
            {label(deal)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A deal's own name, or its instrument when it was never named — same
 * fallback as the deals table, so a deal reads the same everywhere. */
function useDealLabel() {
  const { t } = useTranslation('participations')
  return (deal: { name?: string | null; instrumentKind: string }) =>
    deal.name ??
    t(`instrument.${deal.instrumentKind}`, { defaultValue: deal.instrumentKind })
}

// ─── Edit / delete ───────────────────────────────────────────────────────────

/** Metadata of a stored document (title, kind, date). The file itself is
 * immutable, and the deal it hangs off is set once, at upload. */
function EditDialog({
  doc,
  canAnalyse,
  onClose,
}: {
  doc: CompanyDoc | null
  canAnalyse: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateDocument = useConvexMutation(api.documents.update)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('other')
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)
  // Re-seed the form each time a different document is opened.
  const [seeded, setSeeded] = useState<Id<'documents'> | null>(null)
  if (doc && seeded !== doc._id) {
    setSeeded(doc._id)
    setTitle(doc.title)
    setKind(doc.kind)
    setDateValue(doc.period ? toDateInput(doc.period, isDealKind(doc.kind)) : '')
  }

  async function handleSave() {
    if (!doc || !title.trim()) return
    setSaving(true)
    try {
      await updateDocument({
        documentId: doc._id,
        title,
        kind: kind as DocKind,
        period: fromDateInput(dateValue),
      })
      toast.success(t('participations:timeline.updated'))
      onClose()
    } catch {
      toast.error(t('participations:timeline.errors.default'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('participations:timeline.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">
              {t('participations:timeline.titleLabel', { count: 1 })}
            </Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('participations:timeline.kindLabel')}</Label>
            <KindSelect value={kind} onChange={setKind} canAnalyse={canAnalyse} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">
              {isDealKind(kind)
                ? t('participations:timeline.dateLabel')
                : t('participations:timeline.periodLabel')}
            </Label>
            <Input
              id="edit-date"
              type={isDealKind(kind) ? 'date' : 'month'}
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !title.trim()}
          >
            {saving && <Spinner />}
            {t('common:actions.save')}
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

export function CompanyTimelineSection({
  company,
  orgSlug,
  deals,
}: {
  company: Doc<'companies'>
  orgSlug: string
  deals: Array<DealOption>
}) {
  const { t } = useTranslation(['participations', 'vasco', 'common'])
  const { fmtDate } = useFormatters()
  const dealLabel = useDealLabel()

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
  const removeDocument = useConvexMutation(api.documents.remove)

  const [filter, setFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [reportId, setReportId] = useState<Id<'companyReports'> | null>(null)
  const [commId, setCommId] = useState<string | null>(null)
  const [editDoc, setEditDoc] = useState<CompanyDoc | null>(null)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)
  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)

  // A report's attachments are folded into their report's row, so they never
  // stand as their own entry (they used to show twice: once here, once there).
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
    if (!docs || !reports) return undefined
    const rows: Array<Entry> = []
    for (const report of reports) {
      rows.push({
        key: report._id,
        type: 'report',
        report,
        sortDate:
          report.periodSortDate ??
          report.processedAt ??
          report.emailDate ??
          0,
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
    for (const doc of docs) {
      if (doc.reportId) continue
      rows.push({
        key: doc._id,
        type: 'doc',
        doc,
        sortDate: doc.period ?? doc.uploadedAt,
      })
    }
    return rows.sort((a, b) => b.sortDate - a.sortDate)
  }, [docs, reports, vasco.communications])

  // Only the filters that match something are offered — the list mirrors what
  // is actually on this fiche.
  const KIND_ORDER = [...COMPANY_KINDS, ...DEAL_KINDS] as ReadonlyArray<string>
  const presentKinds = entries
    ? [
        ...new Set(
          entries.flatMap((e) => (e.type === 'doc' ? [e.doc.kind] : [])),
        ),
      ].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
    : []
  const hasReports = entries?.some((e) => e.type === 'report') ?? false
  const hasVasco = entries?.some((e) => e.type === 'vasco') ?? false
  const available = [
    ...(hasReports ? ['report'] : []),
    ...(hasVasco ? ['vasco'] : []),
    ...presentKinds,
  ]
  // Deleting the last entry of the filtered kind falls back to "all" rather
  // than leaving the list stuck on an empty filter.
  const activeFilter = available.includes(filter) ? filter : 'all'
  const visible = entries?.filter((entry) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'report') return entry.type === 'report'
    if (activeFilter === 'vasco') return entry.type === 'vasco'
    return entry.type === 'doc' && entry.doc.kind === activeFilter
  })

  const latestReportId = entries?.find((e) => e.type === 'report')?.key ?? null
  const openComm =
    vasco.communications.find((c) => c.communicationId === commId) ?? null

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeDocument({ documentId: deleteId })
      toast.success(t('participations:timeline.deleted'))
    } catch {
      toast.error(t('participations:timeline.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold tracking-tight">
          {t('participations:timeline.title')}
        </h2>

        <Select value={activeFilter} onValueChange={setFilter}>
          <SelectTrigger size="sm" className="gap-1.5">
            <span className="text-muted-foreground">
              {t('participations:timeline.filter.label')}
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('participations:timeline.filter.all')}
            </SelectItem>
            {(hasReports || hasVasco) && (
              <SelectGroup>
                <SelectLabel>
                  {t('participations:timeline.group.communications')}
                </SelectLabel>
                {hasReports && (
                  <SelectItem value="report">
                    {t('participations:timeline.badge.report')}
                  </SelectItem>
                )}
                {hasVasco && (
                  <SelectItem value="vasco">
                    {t('participations:timeline.badge.vasco')}
                  </SelectItem>
                )}
              </SelectGroup>
            )}
            {presentKinds.length > 0 && (
              <SelectGroup>
                <SelectLabel>
                  {t('participations:timeline.group.documents')}
                </SelectLabel>
                {presentKinds.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`participations:timeline.kind.${value}`, {
                      defaultValue: value,
                    })}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>

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

        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          {t('participations:timeline.add.action')}
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

      {!visible || vasco.loading ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : visible.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t('participations:timeline.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) =>
            entry.type === 'report' ? (
              <ReportEntry
                key={entry.key}
                report={entry.report}
                docs={docsByReport.get(entry.report._id) ?? []}
                isLatest={entry.key === latestReportId}
                onOpen={() => setReportId(entry.report._id)}
              />
            ) : entry.type === 'vasco' ? (
              <VascoEntry
                key={entry.key}
                comm={entry.comm}
                onOpen={() => setCommId(entry.comm.communicationId)}
              />
            ) : (
              <DocumentAttachment
                key={entry.key}
                doc={entry.doc}
                kindLabel={t(`participations:timeline.kind.${entry.doc.kind}`, {
                  defaultValue: entry.doc.kind,
                })}
                extraBadge={
                  entry.doc.deal && (
                    <Badge
                      asChild
                      variant="outline"
                      // Above the card's full-surface open-the-file overlay
                      // (`AttachmentTrigger`, z-10), otherwise the link to the
                      // deal would be unclickable.
                      className="text-info border-info/50 relative z-20 shrink-0 font-normal"
                    >
                      <Link
                        to="/app/$orgSlug/deals/$dealId"
                        params={{ orgSlug, dealId: entry.doc.deal._id }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('participations:timeline.dealBadge', {
                          deal: dealLabel(entry.doc.deal),
                        })}
                      </Link>
                    </Badge>
                  )
                }
                description={[
                  entry.doc.period
                    ? fmtDate(entry.doc.period)
                    : t('participations:timeline.addedOn', {
                        date: fmtDate(entry.doc.uploadedAt),
                      }),
                  formatSize(entry.doc.size),
                ].join(' · ')}
                onEdit={() => setEditDoc(entry.doc)}
                onDelete={() => setDeleteId(entry.doc._id)}
                onOpenText={() => setTextDocId(entry.doc._id)}
              />
            ),
          )}
        </div>
      )}

      <AddDialog
        company={company}
        deals={deals}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <EditDialog
        doc={editDoc}
        canAnalyse={company.kind === 'portfolio'}
        onClose={() => setEditDoc(null)}
      />

      <ReportDetailDialog openId={reportId} onClose={() => setReportId(null)} />

      <VascoCommunicationDialog
        communication={openComm}
        orgId={company.orgId}
        clientSlug={vasco.clientSlug}
        onClose={() => setCommId(null)}
      />

      <ExtractedTextDialog
        documentId={textDocId}
        title={docs?.find((d) => d._id === textDocId)?.title ?? ''}
        onClose={() => setTextDocId(null)}
      />

      {/* Delete confirmation */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('participations:timeline.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('participations:timeline.deleteConfirmBody')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
