import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { FolderClosed, Plus } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type { DocKind } from '~/components/companies/documentFields'
import {
  KIND_ORDER,
  KindSelect,
  formatSize,
  fromDateInput,
  isDealKind,
  toDateInput,
  useDealLabel,
} from '~/components/companies/documentFields'
import { IdentitySection } from '~/components/companies/EntityFiche'
import {
  DocumentAttachment,
  FileGlyph,
} from '~/components/documents/DocumentAttachment'
import { AddFilesDialog } from '~/components/documents/AddFilesDialog'
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { LoadingLine, Spinner } from '~/components/ui/spinner'

/**
 * The documents of a company, as a card in the identity panel — the vault,
 * next to the reports feed which is the journal.
 *
 * They were one chronological list until the volumes diverged: a fiche holds
 * two documents here and thirty-six there, all filed the same day, and a date
 * axis sorts nothing when everything arrived together. A journal is read in
 * order, once, when it lands; a vault is searched by nature, long after,
 * because something has to be signed or voted. So the card is a SHORTCUT
 * (count, five most recent, one door to add) and the full library lives in a
 * sheet where a 50-character file name still reads, and where the documents
 * are grouped by kind rather than by date.
 *
 * A report's own attachments never show up here: they are the report, folded
 * into its row in the reports section (`reportId`), and listing them again
 * would double every file.
 */

type CompanyDoc = FunctionReturnType<typeof api.documents.listByCompany>[number]

/** How many documents the panel card shows before deferring to the sheet. */
const PREVIEW_COUNT = 5

export function CompanyDocumentsCard({
  company,
  orgSlug,
}: {
  company: Doc<'companies'>
  orgSlug: string
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtDate } = useFormatters()

  const rows = useConvexQuery(api.documents.listByCompany, {
    companyId: company._id,
  })
  const removeDocument = useConvexMutation(api.documents.remove)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editDoc, setEditDoc] = useState<CompanyDoc | null>(null)
  const [deleteId, setDeleteId] = useState<Id<'documents'> | null>(null)
  const [textDocId, setTextDocId] = useState<Id<'documents'> | null>(null)

  // Report attachments belong to their report, not to the vault.
  const docs = useMemo(
    () => (rows ?? []).filter((doc) => !doc.reportId),
    [rows],
  )

  const kindLabel = (kind: string) =>
    t(`participations:documents.kind.${kind}`, { defaultValue: kind })

  /** Same axis as the reports feed: the covered period when there is one, the
   * upload date otherwise — and the line says which of the two it shows. */
  const dateLine = (doc: CompanyDoc) =>
    doc.period
      ? fmtDate(doc.period)
      : t('participations:documents.addedOn', {
          date: fmtDate(doc.uploadedAt),
        })

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeDocument({ documentId: deleteId })
      toast.success(t('participations:documents.deleted'))
    } catch {
      toast.error(t('participations:documents.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="bg-card rounded-xl border p-4">
      <IdentitySection
        title={t('participations:documents.card.title')}
        icon={<FolderClosed className="size-3.5" />}
        count={docs.length}
        action={
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setAddOpen(true)}
            aria-label={t('participations:documents.add.title')}
            title={t('participations:documents.add.title')}
          >
            <Plus className="size-4" />
          </Button>
        }
      >
        {!rows ? (
          <LoadingLine>{t('participations:loading')}</LoadingLine>
        ) : docs.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('participations:documents.card.empty')}
          </p>
        ) : (
          <div className="flex flex-col">
            {docs.slice(0, PREVIEW_COUNT).map((doc) => (
              <a
                key={doc._id}
                href={doc.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-accent/40 focus-visible:ring-ring -mx-1.5 flex items-center gap-2 rounded-md border-b px-1.5 py-1.5 transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="text-muted-foreground shrink-0 [&>svg]:size-4">
                  <FileGlyph contentType={doc.contentType} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {doc.title}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {kindLabel(doc.kind)} · {dateLine(doc)}
                  </span>
                </span>
              </a>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setSheetOpen(true)}
            >
              {t('participations:documents.card.viewAll', {
                count: docs.length,
              })}
            </Button>
          </div>
        )}
      </IdentitySection>

      <DocumentsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        companyName={company.name}
        orgSlug={orgSlug}
        docs={docs}
        kindLabel={kindLabel}
        dateLine={dateLine}
        onAdd={() => setAddOpen(true)}
        onEdit={setEditDoc}
        onDelete={setDeleteId}
        onOpenText={setTextDocId}
      />

      <AddFilesDialog
        anchor={{ kind: 'company', companyId: company._id }}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <EditDocumentDialog
        doc={editDoc}
        canAnalyse={company.kind === 'portfolio'}
        onClose={() => setEditDoc(null)}
      />

      <ExtractedTextDialog
        documentId={textDocId}
        title={docs.find((d) => d._id === textDocId)?.title ?? ''}
        onClose={() => setTextDocId(null)}
      />

      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('participations:documents.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('participations:documents.deleteConfirmBody')}
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
    </div>
  )
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

/**
 * The full library. Free-text search on the title and a kind filter, both
 * client-side over the list the card already holds — no second query — then
 * the documents GROUPED BY KIND. The grouping is the point of the sheet: the
 * thirty-six documents of a company landed on the same day, so ordering them
 * by date answers nothing, where "where is the pacte?" is the actual question.
 */
function DocumentsSheet({
  open,
  onClose,
  companyName,
  orgSlug,
  docs,
  kindLabel,
  dateLine,
  onAdd,
  onEdit,
  onDelete,
  onOpenText,
}: {
  open: boolean
  onClose: () => void
  companyName: string
  orgSlug: string
  docs: Array<CompanyDoc>
  kindLabel: (kind: string) => string
  dateLine: (doc: CompanyDoc) => string
  onAdd: () => void
  onEdit: (doc: CompanyDoc) => void
  onDelete: (id: Id<'documents'>) => void
  onOpenText: (id: Id<'documents'>) => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const dealLabel = useDealLabel()
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')

  // Only the kinds actually filed are offered — the filter mirrors the vault.
  // Widened to string: the filter state holds "all" alongside the kinds.
  const presentKinds: Array<string> = useMemo(
    () =>
      [...new Set<string>(docs.map((doc) => doc.kind))].sort(
        (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
      ),
    [docs],
  )
  // Deleting the last document of the filtered kind falls back to "all"
  // rather than leaving the sheet stuck on an empty filter.
  const activeFilter = presentKinds.includes(kindFilter) ? kindFilter : 'all'

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const visible = docs.filter(
      (doc) =>
        (activeFilter === 'all' || doc.kind === activeFilter) &&
        (!needle || doc.title.toLowerCase().includes(needle)),
    )
    return presentKinds
      .map((kind) => ({
        kind,
        rows: visible.filter((doc) => doc.kind === kind),
      }))
      .filter((group) => group.rows.length > 0)
  }, [docs, presentKinds, activeFilter, search])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {t('participations:documents.sheet.title', {
              company: companyName,
            })}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t('participations:documents.sheet.description')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('participations:documents.sheet.search')}
              aria-label={t('participations:documents.sheet.search')}
            />
            <Button size="sm" className="shrink-0" onClick={onAdd}>
              <Plus className="size-4" />
              {t('participations:documents.add.action')}
            </Button>
          </div>

          {presentKinds.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label={t('participations:documents.filter.all')}
                count={docs.length}
                active={activeFilter === 'all'}
                onClick={() => setKindFilter('all')}
              />
              {presentKinds.map((kind) => (
                <FilterChip
                  key={kind}
                  label={kindLabel(kind)}
                  count={docs.filter((doc) => doc.kind === kind).length}
                  active={activeFilter === kind}
                  onClick={() => setKindFilter(kind)}
                />
              ))}
            </div>
          )}

          {groups.length === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              {t('participations:documents.sheet.noMatch')}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.kind} className="flex flex-col gap-2">
                <h3 className="text-muted-foreground mt-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
                  {kindLabel(group.kind)}
                  <span className="bg-border h-px flex-1" />
                </h3>
                {group.rows.map((doc) => (
                  <DocumentAttachment
                    key={doc._id}
                    doc={doc}
                    kindLabel={kindLabel(doc.kind)}
                    extraBadge={
                      doc.deal && (
                        <Badge
                          asChild
                          variant="outline"
                          // Above the card's full-surface open-the-file overlay
                          // (`AttachmentTrigger`, z-10), otherwise the link to
                          // the deal would be unclickable.
                          // A deal name is free text. `max-w-full` (not a fixed
                          // cap) is what holds in the narrow documents sheet:
                          // the badge takes at most the row, wraps under it,
                          // and ellipsizes — it never runs over the actions.
                          className="text-info border-info/50 relative z-20 max-w-full shrink-0 font-normal"
                          title={t('participations:documents.dealBadge', {
                            deal: dealLabel(doc.deal),
                          })}
                        >
                          <Link
                            to="/app/$orgSlug/deals/$dealId"
                            params={{ orgSlug, dealId: doc.deal._id }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="truncate">
                              {t('participations:documents.dealBadge', {
                                deal: dealLabel(doc.deal),
                              })}
                            </span>
                          </Link>
                        </Badge>
                      )
                    }
                    description={[dateLine(doc), formatSize(doc.size)].join(
                      ' · ',
                    )}
                    onEdit={() => onEdit(doc)}
                    onDelete={() => onDelete(doc._id)}
                    onOpenText={() => onOpenText(doc._id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      className="h-7 rounded-full px-2.5 text-xs font-normal"
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </Button>
  )
}

// ─── Edit ────────────────────────────────────────────────────────────────────

/** Metadata of a stored document (title, kind, date). The file itself is
 * immutable, and the deal it hangs off is set once, at upload. */
function EditDocumentDialog({
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
    setDateValue(
      doc.period ? toDateInput(doc.period, isDealKind(doc.kind)) : '',
    )
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
      toast.success(t('participations:documents.updated'))
      onClose()
    } catch {
      toast.error(t('participations:documents.errors.default'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('participations:documents.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">
              {t('participations:documents.titleLabel', { count: 1 })}
            </Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('participations:documents.kindLabel')}</Label>
            <KindSelect
              value={kind}
              onChange={setKind}
              canAnalyse={canAnalyse}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">
              {isDealKind(kind)
                ? t('participations:documents.dateLabel')
                : t('participations:documents.periodLabel')}
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
