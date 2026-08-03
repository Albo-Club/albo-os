import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { DocumentAttachment } from '~/components/documents/DocumentAttachment'
import { ExtractedTextDialog } from '~/components/documents/DocumentReading'
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
import { LoadingLine, Spinner } from '~/components/ui/spinner'

const MAX_BYTES = 20 * 1024 * 1024

/** Deal-specific kinds — the company's own set (reporting / BP / legal) lives
 * on the company fiche and isn't offered here. A row can carry another one
 * (the schema's union is wider), so the state is typed with the mutation's
 * own kind. */
const KINDS = [
  'term_sheet',
  'pacte',
  'subscription',
  'attestation',
  'other',
] as const
type DealDocKind = FunctionArgs<typeof api.documents.create>['kind']

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ms epoch → "YYYY-MM-DD", the value shape of an `<input type="date">`. */
function toDateInput(period: number): string {
  return new Date(period).toISOString().slice(0, 10)
}

type DealDoc = FunctionReturnType<typeof api.documents.listByDeal>[number]

/**
 * Documents attached to a single deal (term sheet, pacte, subscription form):
 * manual upload to Convex storage (20 MB cap) + list of attachment cards with
 * open / edit / delete, filterable by kind. Mirrors the company's
 * `ReportingsSection`, with the deal kinds and a plain document date instead
 * of a covered period. These rows carry `dealId`, which is what keeps them off
 * the company's Documents tab.
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
  const updateDocument = useConvexMutation(api.documents.update)
  const removeDocument = useConvexMutation(api.documents.remove)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [kindFilter, setKindFilter] = useState<string>('all')
  // Exactly one of the two is set while the metadata dialog is open: the
  // picked files (creation, one or many) or the id of the document being
  // edited. `titles` is parallel to `pendingFiles`, and holds the single
  // title when editing — one code path for both.
  const [pendingFiles, setPendingFiles] = useState<Array<File>>([])
  const [editingId, setEditingId] = useState<Id<'documents'> | null>(null)
  const [titles, setTitles] = useState<Array<string>>([])
  const [kind, setKind] = useState<string>('term_sheet')
  const [docDate, setDocDate] = useState('') // "YYYY-MM-DD"
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)
  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)

  const kindLabel = (value: string) =>
    t(`participations:dealDocuments.kind.${value}`, { defaultValue: value })

  // Only the kinds actually present are offered — the filter mirrors the list.
  const rank = (value: string) => {
    const index = (KINDS as ReadonlyArray<string>).indexOf(value)
    return index === -1 ? KINDS.length : index
  }
  const presentKinds: Array<string> = docs
    ? [...new Set(docs.map((doc) => doc.kind))].sort(
        (a, b) => rank(a) - rank(b),
      )
    : []
  // Deleting the last document of the filtered kind falls back to "all"
  // rather than leaving the list stuck on an empty filter.
  const activeFilter = presentKinds.includes(kindFilter) ? kindFilter : 'all'
  const visible = docs?.filter(
    (doc) => activeFilter === 'all' || doc.kind === activeFilter,
  )

  /** Whole selection or nothing: an oversized file in the batch rejects the
   * pick, so the user re-picks knowingly rather than silently losing one. */
  function handlePick(files: Array<File>) {
    if (files.some((file) => file.size > MAX_BYTES)) {
      toast.error(t('participations:dealDocuments.errors.too_large'))
      return
    }
    setPendingFiles(files)
    setTitles(files.map((file) => file.name.replace(/\.[^.]+$/, '')))
    setKind('term_sheet')
    setDocDate('')
  }

  function handleEdit(doc: DealDoc) {
    setEditingId(doc._id)
    setTitles([doc.title])
    setKind(doc.kind)
    setDocDate(doc.period ? toDateInput(doc.period) : '')
  }

  function closeForm() {
    setPendingFiles([])
    setEditingId(null)
  }

  async function handleSave() {
    if (titles.some((value) => !value.trim())) return
    setSaving(true)
    try {
      // "YYYY-MM-DD" → midnight UTC (dates are stored as ms epoch, UTC).
      // Emptied: the date is cleared.
      const period = docDate
        ? Date.UTC(
            Number(docDate.slice(0, 4)),
            Number(docDate.slice(5, 7)) - 1,
            Number(docDate.slice(8, 10)),
          )
        : undefined

      if (editingId) {
        await updateDocument({
          documentId: editingId,
          title: titles[0],
          kind: kind as DealDocKind,
          period,
        })
        toast.success(t('participations:dealDocuments.updated'))
        closeForm()
        return
      }

      if (pendingFiles.length === 0 || !companyId) return
      // One upload + one create per file, in series. A failure stops the
      // batch: the documents already created stay (the list refreshes on
      // its own), the rest never left the browser.
      for (const [index, file] of pendingFiles.entries()) {
        const url = await generateUploadUrl({})
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        })
        if (!res.ok) {
          toast.error(t('participations:dealDocuments.errors.default'))
          return
        }
        const { storageId } = (await res.json()) as {
          storageId: Id<'_storage'>
        }
        await createDocument({
          companyId,
          dealId,
          title: titles[index],
          kind: kind as DealDocKind,
          period,
          storageId,
        })
      }
      toast.success(
        t('participations:dealDocuments.added', { count: pendingFiles.length }),
      )
      closeForm()
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
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('participations:dealDocuments.title')}
          </h2>
          <Select value={activeFilter} onValueChange={setKindFilter}>
            <SelectTrigger size="sm" className="gap-1.5">
              <span className="text-muted-foreground">
                {t('participations:dealDocuments.filter.label')}
              </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('participations:dealDocuments.filter.all')}
              </SelectItem>
              {presentKinds.map((value) => (
                <SelectItem key={value} value={value}>
                  {kindLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])]
          e.target.value = ''
          if (picked.length > 0) handlePick(picked)
        }}
      />

      {!visible ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : visible.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('participations:dealDocuments.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((doc) => (
            <DocumentAttachment
              key={doc._id}
              doc={doc}
              kindLabel={kindLabel(doc.kind)}
              description={[
                doc.period
                  ? fmtDate(doc.period)
                  : t('participations:dealDocuments.addedOn', {
                      date: fmtDate(doc.uploadedAt),
                    }),
                formatSize(doc.size),
              ].join(' · ')}
              onEdit={() => handleEdit(doc)}
              onDelete={() => setDeleteId(doc._id)}
              onOpenText={() => setTextDocId(doc._id)}
            />
          ))}
        </div>
      )}

      {/* Metadata dialog: after a file is picked, or on the edit pencil */}
      <Dialog
        open={pendingFiles.length > 0 || editingId !== null}
        onOpenChange={(open) => !open && closeForm()}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('participations:dealDocuments.editDialogTitle')
                : t('participations:dealDocuments.dialogTitle', {
                    count: pendingFiles.length,
                  })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deal-doc-title">
                {t('participations:dealDocuments.titleLabel', {
                  count: titles.length,
                })}
              </Label>
              {titles.map((value, index) => (
                <div key={index} className="space-y-1">
                  {/* The file name only earns its place when several titles
                      are stacked and one input no longer says which is which. */}
                  {pendingFiles.length > 1 && (
                    <p className="text-muted-foreground truncate text-xs">
                      {pendingFiles[index].name}
                    </p>
                  )}
                  <Input
                    id={index === 0 ? 'deal-doc-title' : undefined}
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
            <div className="space-y-2">
              <Label>{t('participations:dealDocuments.kindLabel')}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)}
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
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || titles.some((value) => !value.trim())}
            >
              {saving && <Spinner />}
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
