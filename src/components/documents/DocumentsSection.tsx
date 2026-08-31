import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { DocumentAttachment } from '~/components/documents/DocumentAttachment'
import { ExtractedTextDialog } from '~/components/documents/DocumentReading'
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

type DocKind = FunctionArgs<typeof api.documents.create>['kind']

/**
 * What the document hangs off. `documents:create` resolves the org from
 * whichever anchor is present and refuses a row with none, so the anchor is
 * the ONLY thing the caller has to supply — never an `orgId`, which would be
 * a tenancy hole (cf. `CLAUDE.md`).
 */
export type DocumentAnchor =
  | { kind: 'loan'; loanId: Id<'loans'> }
  | { kind: 'property'; propertyId: Id<'properties'> }
  | { kind: 'guarantee'; guaranteeId: Id<'guarantees'> }

/** Rows of `documents:listByLoan` — `listByProperty` / `listByGuarantee` return the same shape. */
type AnchoredDoc = FunctionReturnType<typeof api.documents.listByLoan>[number]

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ms epoch → "YYYY-MM-DD", the value shape of an `<input type="date">`. */
function toDateInput(period: number): string {
  return new Date(period).toISOString().slice(0, 10)
}

/**
 * Documents attached to a loan, a property or a guarantee: upload to Convex
 * storage (20 MB cap), list, retitle, delete.
 *
 * Deliberately LEANER than the company fiche's own documents surface
 * (`CompanyDocumentsCard` + `AddDocumentDialog`), which it does not extend.
 * That one carries search, grouping by kind and multi-file picking because a
 * portfolio company accumulates dozens of pieces; a loan carries an offer
 * letter and an amortization table, a property a deed and a couple of quotes.
 * A filter over four rows is furniture, not a feature.
 *
 * ⚠️ If a loan or a property ever starts accumulating documents the way a
 * company does, the right move is to adopt that surface rather than grow
 * this one into a second copy of it.
 *
 * The caller owns the query and passes `docs` — the three anchors have three
 * different queries, and a hook cannot be called per row of a list (the
 * guarantee case renders one of these per guarantee, inside a dialog).
 *
 * ⚠️ These rows usually carry NO `companyId`, which is exactly why the
 * schema was relaxed for this module: a loan deed has no portfolio company
 * and no honest value to give the field. They are therefore invisible to the
 * `by_company` index and never show on a company sheet — intended, and
 * documented at the schema.
 */
export function DocumentsSection({
  anchor,
  docs,
  kinds,
  title,
}: {
  anchor: DocumentAnchor
  /** `undefined` while the caller's query is still loading. */
  docs: Array<AnchoredDoc> | undefined
  /** Kinds offered for THIS surface, most likely first — it is the default. */
  kinds: ReadonlyArray<DocKind>
  title: string
}) {
  const { t, i18n } = useTranslation(['documents', 'common'])
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)
  const updateDocument = useConvexMutation(api.documents.update)
  const removeDocument = useConvexMutation(api.documents.remove)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Exactly one of the two is set while the metadata dialog is open: the
  // picked file (creation) or the id of the document being retitled.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [editingId, setEditingId] = useState<Id<'documents'> | null>(null)
  const [docTitle, setDocTitle] = useState('')
  const [kind, setKind] = useState<DocKind>(kinds[0])
  const [docDate, setDocDate] = useState('') // "YYYY-MM-DD"
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)
  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)

  const kindLabel = (value: string) =>
    t(`documents:kind.${value}`, { defaultValue: value })

  function closeForm() {
    setPendingFile(null)
    setEditingId(null)
    setDocTitle('')
    setDocDate('')
  }

  function handlePick(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(t('documents:errors.too_large'))
      return
    }
    setPendingFile(file)
    setDocTitle(file.name.replace(/\.[^.]+$/, ''))
    setKind(kinds[0])
    setDocDate('')
  }

  function handleEdit(doc: AnchoredDoc) {
    setEditingId(doc._id)
    setDocTitle(doc.title)
    // A row may carry a kind this surface does not offer (the schema's union
    // is wider than any one list); keep it rather than silently rewriting it.
    setKind(doc.kind)
    setDocDate(doc.period ? toDateInput(doc.period) : '')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const period = docDate ? Date.parse(`${docDate}T00:00:00Z`) : undefined

      if (editingId) {
        await updateDocument({
          documentId: editingId,
          title: docTitle.trim(),
          kind,
          period,
        })
        toast.success(t('documents:updated'))
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
        toast.error(t('documents:errors.default'))
        return
      }
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
      await createDocument({
        ...anchorArgs(anchor),
        title: docTitle.trim(),
        kind,
        period,
        storageId,
      })
      toast.success(t('documents:added'))
      closeForm()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('documents:errors.too_large')
          : t('documents:errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeDocument({ documentId: deleteId })
      toast.success(t('documents:deleted'))
    } catch {
      toast.error(t('documents:errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="size-4" />
          {t('documents:upload')}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) handlePick(picked)
        }}
      />

      {!docs ? (
        <LoadingLine>{t('documents:loading')}</LoadingLine>
      ) : docs.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('documents:empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocumentAttachment
              key={doc._id}
              doc={doc}
              kindLabel={kindLabel(doc.kind)}
              description={[
                // The document's own date when it has one; otherwise when it
                // was filed — labelled, so the two never read as the same fact.
                doc.period
                  ? fmtDate(doc.period)
                  : t('documents:addedOn', { date: fmtDate(doc.uploadedAt) }),
                formatSize(doc.size),
              ].join(' · ')}
              onEdit={() => handleEdit(doc)}
              onDelete={() => setDeleteId(doc._id)}
              onOpenText={() => setTextDocId(doc._id)}
            />
          ))}
        </div>
      )}

      {/* Metadata dialog: after a file is picked, or on the edit pencil. */}
      <Dialog
        open={pendingFile !== null || editingId !== null}
        onOpenChange={(open) => !open && closeForm()}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('documents:editDialogTitle')
                : t('documents:dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="anchored-doc-title">
                {t('documents:titleLabel')}
              </Label>
              <Input
                id="anchored-doc-title"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('documents:kindLabel')}</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as DocKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* The row's own kind is kept even when this surface does
                      not offer it, so editing a title never rewrites it. */}
                  {[...new Set([...kinds, kind])].map((value) => (
                    <SelectItem key={value} value={value}>
                      {kindLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="anchored-doc-date">
                {t('documents:dateLabel')}
              </Label>
              <Input
                id="anchored-doc-date"
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
              disabled={saving || !docTitle.trim()}
            >
              {saving && <Spinner />}
              {saving ? t('documents:uploading') : t('common:actions.save')}
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
            <DialogTitle>{t('documents:deleteConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('documents:deleteConfirmBody')}
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

/** The anchor as `documents:create` expects it — exactly one id. */
function anchorArgs(anchor: DocumentAnchor) {
  switch (anchor.kind) {
    case 'loan':
      return { loanId: anchor.loanId }
    case 'property':
      return { propertyId: anchor.propertyId }
    case 'guarantee':
      return { guaranteeId: anchor.guaranteeId }
  }
}
