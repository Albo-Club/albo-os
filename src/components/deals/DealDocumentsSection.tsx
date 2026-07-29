import { useRef, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  ExtractedTextDialog,
  OcrStatus,
} from '~/components/documents/DocumentReading'
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

/** Deal-specific kinds — the company's own set (reporting / BP / legal) lives
 * on the company fiche and isn't offered here. */
const KINDS = [
  'term_sheet',
  'pacte',
  'subscription',
  'attestation',
  'other',
] as const
type DealDocKind = (typeof KINDS)[number]

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Documents attached to a single deal (term sheet, pacte, subscription form):
 * manual upload to Convex storage (20 MB cap) + list with download/delete.
 * Mirrors the company's `ReportingsSection`, with the deal kinds and a plain
 * document date instead of a covered period. These rows carry `dealId`, which
 * is what keeps them off the company's Documents tab.
 */
export function DealDocumentsSection({
  dealId,
  companyId,
}: {
  dealId: Id<'deals'>
  companyId: Id<'companies'> | undefined
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtDate } = useFormatters()
  const docs = useConvexQuery(api.documents.listByDeal, { dealId })
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)
  const removeDocument = useConvexMutation(api.documents.remove)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DealDocKind>('term_sheet')
  const [docDate, setDocDate] = useState('') // "YYYY-MM-DD"
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)
  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)

  function handlePick(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(t('participations:dealDocuments.errors.too_large'))
      return
    }
    setPendingFile(file)
    setTitle(file.name.replace(/\.[^.]+$/, ''))
    setKind('term_sheet')
    setDocDate('')
  }

  async function handleSave() {
    if (!pendingFile || !title.trim() || !companyId) return
    setSaving(true)
    try {
      const url = await generateUploadUrl({})
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': pendingFile.type || 'application/octet-stream',
        },
        body: pendingFile,
      })
      if (!res.ok) {
        toast.error(t('participations:dealDocuments.errors.default'))
        return
      }
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
      // "YYYY-MM-DD" → midnight UTC (dates are stored as ms epoch, UTC).
      const period = docDate
        ? Date.UTC(
            Number(docDate.slice(0, 4)),
            Number(docDate.slice(5, 7)) - 1,
            Number(docDate.slice(8, 10)),
          )
        : undefined
      await createDocument({
        companyId,
        dealId,
        title,
        kind,
        period,
        storageId,
      })
      toast.success(t('participations:dealDocuments.added'))
      setPendingFile(null)
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('participations:dealDocuments.errors.too_large')
          : t('participations:dealDocuments.errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeDocument({ documentId: deleteId })
      toast.success(t('participations:dealDocuments.deleted'))
    } catch {
      toast.error(t('participations:dealDocuments.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('participations:dealDocuments.title')}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={!companyId}
        >
          <Plus className="size-4" />
          {t('participations:dealDocuments.upload')}
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
          {t('participations:dealDocuments.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('participations:dealDocuments.col.title')}
                </TableHead>
                <TableHead>
                  {t('participations:dealDocuments.col.kind')}
                </TableHead>
                <TableHead>
                  {t('participations:dealDocuments.col.date')}
                </TableHead>
                <TableHead>
                  {t('participations:dealDocuments.col.size')}
                </TableHead>
                <TableHead>
                  {t('participations:dealDocuments.col.added')}
                </TableHead>
                <TableHead>
                  {t('participations:documentReading.column')}
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc._id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>
                    {t(`participations:dealDocuments.kind.${doc.kind}`, {
                      defaultValue: doc.kind,
                    })}
                  </TableCell>
                  <TableCell>
                    {doc.period ? fmtDate(doc.period) : '—'}
                  </TableCell>
                  <TableCell>{formatSize(doc.size)}</TableCell>
                  <TableCell>{fmtDate(doc.uploadedAt)}</TableCell>
                  <TableCell>
                    <OcrStatus
                      documentId={doc._id}
                      state={doc.ocrState}
                      detail={doc.ocrDetail}
                      chars={doc.ocrChars}
                      onOpen={() => setTextDocId(doc._id)}
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
                          aria-label={t(
                            'participations:dealDocuments.download',
                          )}
                          title={t('participations:dealDocuments.download')}
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
              {t('participations:dealDocuments.dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deal-doc-title">
                {t('participations:dealDocuments.titleLabel')}
              </Label>
              <Input
                id="deal-doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('participations:dealDocuments.kindLabel')}</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as DealDocKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`participations:dealDocuments.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-doc-date">
                {t('participations:dealDocuments.dateLabel')}
              </Label>
              <Input
                id="deal-doc-date"
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
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
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !title.trim()}
            >
              {saving
                ? t('participations:dealDocuments.uploading')
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
              {t('participations:dealDocuments.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('participations:dealDocuments.deleteConfirmBody')}
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
      <ExtractedTextDialog
        documentId={textDocId}
        title={docs?.find((d) => d._id === textDocId)?.title ?? ''}
        onClose={() => setTextDocId(null)}
      />
    </section>
  )
}
