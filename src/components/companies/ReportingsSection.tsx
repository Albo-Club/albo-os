import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  ScanText,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const MAX_BYTES = 20 * 1024 * 1024
const KINDS = ['reporting', 'bp', 'legal', 'other'] as const
type DocKind = (typeof KINDS)[number]

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Reading state of one document, from the same vocabulary as the report
 * recap email (`inboundEmails.sources[].detail`) so both surfaces name a
 * failure the same way. Rows predating extraction have no state at all —
 * they get the "analyse" action rather than a misleading verdict.
 */
function OcrStatus({
  state,
  detail,
  chars,
  onOpen,
  onRetry,
}: {
  state: 'pending' | 'extracted' | 'skipped' | 'failed' | null
  detail: string | null
  chars: number | null
  onOpen: () => void
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation('participations')
  const detailLabel = detail
    ? t(`reportings.ocr.detail.${detail}`, { defaultValue: detail })
    : null

  if (state === 'extracted') {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 font-normal"
        onClick={onOpen}
        title={t('reportings.ocr.open')}
      >
        <ScanText className="size-3.5" />
        {t('reportings.ocr.chars', {
          chars: (chars ?? 0).toLocaleString(i18n.language),
        })}
      </Button>
    )
  }

  if (state === 'pending') {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t('reportings.ocr.pending')}
      </span>
    )
  }

  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1">
        <span className="text-destructive flex items-center gap-1.5 text-xs">
          <AlertTriangle className="size-3.5" />
          {detailLabel ?? t('reportings.ocr.failed')}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onRetry}
          aria-label={t('reportings.ocr.retry')}
          title={t('reportings.ocr.retry')}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </span>
    )
  }

  if (state === 'skipped') {
    return (
      <span className="text-muted-foreground text-xs">
        {detailLabel ?? t('reportings.ocr.skipped')}
      </span>
    )
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground h-7 px-2 font-normal"
      onClick={onRetry}
    >
      <ScanText className="size-3.5" />
      {t('reportings.ocr.analyse')}
    </Button>
  )
}

/**
 * Reportings & documents of a company: manual upload (Convex storage,
 * 20 MB cap) + list with download/delete. KPI extraction from a reporting
 * goes through the assistant (createKpiSnapshot), not this component.
 */
export function ReportingsSection({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtDate } = useFormatters()
  const docs = useConvexQuery(api.documents.listByCompany, { companyId })
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)
  const removeDocument = useConvexMutation(api.documents.remove)
  const reextractDocument = useConvexMutation(api.documents.reextract)

  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)
  const extracted = useConvexQuery(
    api.documents.getExtractedText,
    textDocId ? { documentId: textDocId } : 'skip',
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DocKind>('reporting')
  const [periodMonth, setPeriodMonth] = useState('') // "YYYY-MM"
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)

  function handlePick(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(t('participations:reportings.errors.too_large'))
      return
    }
    setPendingFile(file)
    setTitle(file.name.replace(/\.[^.]+$/, ''))
    setKind('reporting')
    setPeriodMonth('')
  }

  async function handleSave() {
    if (!pendingFile || !title.trim()) return
    setSaving(true)
    try {
      const url = await generateUploadUrl({})
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': pendingFile.type || 'application/octet-stream' },
        body: pendingFile,
      })
      if (!res.ok) {
        toast.error(t('participations:reportings.errors.default'))
        return
      }
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
      // "YYYY-MM" → first of the month, UTC.
      const period = periodMonth
        ? Date.UTC(
            Number(periodMonth.slice(0, 4)),
            Number(periodMonth.slice(5, 7)) - 1,
            1,
          )
        : undefined
      await createDocument({ companyId, title, kind, period, storageId })
      toast.success(t('participations:reportings.added'))
      setPendingFile(null)
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('participations:reportings.errors.too_large')
          : t('participations:reportings.errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleReextract(documentId: Id<'documents'>) {
    try {
      await reextractDocument({ documentId })
      toast.success(t('participations:reportings.ocr.restarted'))
    } catch {
      toast.error(t('participations:reportings.errors.default'))
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeDocument({ documentId: deleteId })
      toast.success(t('participations:reportings.deleted'))
    } catch {
      toast.error(t('participations:reportings.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('participations:reportings.title')}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="size-4" />
          {t('participations:reportings.upload')}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handlePick(file)
          e.target.value = ''
        }}
      />

      {!docs ? (
        <div className="text-muted-foreground text-sm">
          {t('participations:loading')}
        </div>
      ) : docs.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('participations:reportings.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('participations:reportings.col.title')}</TableHead>
                <TableHead>{t('participations:reportings.col.kind')}</TableHead>
                <TableHead>{t('participations:reportings.col.period')}</TableHead>
                <TableHead>{t('participations:reportings.col.size')}</TableHead>
                <TableHead>{t('participations:reportings.col.date')}</TableHead>
                <TableHead>
                  {t('participations:reportings.col.reading')}
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc._id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>
                    {t(`participations:reportings.kind.${doc.kind}`)}
                  </TableCell>
                  <TableCell>
                    {doc.period ? fmtDate(doc.period) : '—'}
                  </TableCell>
                  <TableCell>{formatSize(doc.size)}</TableCell>
                  <TableCell>{fmtDate(doc.uploadedAt)}</TableCell>
                  <TableCell>
                    <OcrStatus
                      state={doc.ocrState}
                      detail={doc.ocrDetail}
                      chars={doc.ocrChars}
                      onOpen={() => setTextDocId(doc._id)}
                      onRetry={() => void handleReextract(doc._id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {doc.url && (
                        <Button
                          asChild
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={t('participations:reportings.download')}
                          title={t('participations:reportings.download')}
                        >
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            <Download className="size-4" />
                          </a>
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        onClick={() => setDeleteId(doc._id)}
                        aria-label={t('common:actions.delete')}
                        title={t('common:actions.delete')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Metadata dialog shown after the file is picked */}
      <Dialog
        open={pendingFile !== null}
        onOpenChange={(open) => !open && setPendingFile(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('participations:reportings.dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="doc-title">
                {t('participations:reportings.titleLabel')}
              </Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('participations:reportings.kindLabel')}</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as DocKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`participations:reportings.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-period">
                {t('participations:reportings.periodLabel')}
              </Label>
              <Input
                id="doc-period"
                type="month"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingFile(null)}
              disabled={saving}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !title.trim()}>
              {saving
                ? t('participations:reportings.uploading')
                : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('participations:reportings.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('participations:reportings.deleteConfirmBody')}
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

      {/* Extracted text — loaded only here, never with the documents list */}
      <Dialog
        open={textDocId !== null}
        onOpenChange={(open) => !open && setTextDocId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {docs?.find((d) => d._id === textDocId)?.title ??
                t('participations:reportings.ocr.dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          {extracted === undefined ? (
            <p className="text-muted-foreground text-sm">
              {t('participations:loading')}
            </p>
          ) : extracted === null ? (
            <p className="text-muted-foreground text-sm">
              {t('participations:reportings.ocr.noText')}
            </p>
          ) : (
            <div className="space-y-2">
              {extracted.truncated && (
                <p className="text-muted-foreground text-xs">
                  {t('participations:reportings.ocr.truncated')}
                </p>
              )}
              <pre className="bg-muted rounded-md p-3 text-xs break-words whitespace-pre-wrap">
                {extracted.text}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
