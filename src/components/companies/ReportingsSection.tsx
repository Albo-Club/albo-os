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

const MAX_BYTES = 20 * 1024 * 1024
/** The kinds this surface offers. A row can carry another one (the schema's
 * union is wider), so the state is typed with the mutation's own kind. */
const KINDS = ['reporting', 'bp', 'legal', 'other'] as const
type DocKind = FunctionArgs<typeof api.documents.create>['kind']

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ms epoch → "YYYY-MM", the value shape of an `<input type="month">`. */
function toMonthInput(period: number): string {
  const date = new Date(period)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

type CompanyDoc = FunctionReturnType<typeof api.documents.listByCompany>[number]

/**
 * Reportings & documents of a company: manual upload (Convex storage, 20 MB
 * cap) + list of attachment cards with open / edit / delete, filterable by
 * kind. No section heading — the tab above already says "Documents", and the
 * kinds are not only reportings. KPI extraction from a reporting goes through
 * the assistant (createKpiSnapshot), not this component.
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
  const updateDocument = useConvexMutation(api.documents.update)
  const removeDocument = useConvexMutation(api.documents.remove)

  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('all')

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Exactly one of the two is set while the metadata dialog is open: a picked
  // file (creation) or the id of the document being edited.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [editingId, setEditingId] = useState<Id<'documents'> | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<string>('reporting')
  const [periodMonth, setPeriodMonth] = useState('') // "YYYY-MM"
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)

  const kindLabel = (value: string) =>
    t(`participations:reportings.kind.${value}`, { defaultValue: value })

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

  function handleEdit(doc: CompanyDoc) {
    setEditingId(doc._id)
    setTitle(doc.title)
    setKind(doc.kind)
    setPeriodMonth(doc.period ? toMonthInput(doc.period) : '')
  }

  function closeForm() {
    setPendingFile(null)
    setEditingId(null)
  }

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    try {
      // "YYYY-MM" → first of the month, UTC. Emptied: the period is cleared.
      const period = periodMonth
        ? Date.UTC(
            Number(periodMonth.slice(0, 4)),
            Number(periodMonth.slice(5, 7)) - 1,
            1,
          )
        : undefined

      if (editingId) {
        await updateDocument({
          documentId: editingId,
          title,
          kind: kind as DocKind,
          period,
        })
        toast.success(t('participations:reportings.updated'))
        closeForm()
        return
      }

      if (!pendingFile) return
      const url = await generateUploadUrl({})
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': pendingFile.type || 'application/octet-stream',
        },
        body: pendingFile,
      })
      if (!res.ok) {
        toast.error(t('participations:reportings.errors.default'))
        return
      }
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
      await createDocument({
        companyId,
        title,
        kind: kind as DocKind,
        period,
        storageId,
      })
      toast.success(t('participations:reportings.added'))
      closeForm()
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
        <Select value={activeFilter} onValueChange={setKindFilter}>
          <SelectTrigger size="sm" className="gap-1.5">
            <span className="text-muted-foreground">
              {t('participations:reportings.filter.label')}
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('participations:reportings.filter.all')}
            </SelectItem>
            {presentKinds.map((value) => (
              <SelectItem key={value} value={value}>
                {kindLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {!visible ? (
        <div className="text-muted-foreground text-sm">
          {t('participations:loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('participations:reportings.empty')}
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
                  : t('participations:reportings.addedOn', {
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
        open={pendingFile !== null || editingId !== null}
        onOpenChange={(open) => !open && closeForm()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('participations:reportings.editDialogTitle')
                : t('participations:reportings.dialogTitle')}
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
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !title.trim()}
            >
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

      <ExtractedTextDialog
        documentId={textDocId}
        title={docs?.find((d) => d._id === textDocId)?.title ?? ''}
        onClose={() => setTextDocId(null)}
      />
    </section>
  )
}
