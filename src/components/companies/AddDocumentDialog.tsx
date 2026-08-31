import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type { DealOption, DocKind } from '~/components/companies/documentFields'
import {
  DealSelect,
  KindSelect,
  MAX_BYTES,
  fromDateInput,
  isDealKind,
} from '~/components/companies/documentFields'
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
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

/**
 * The shared add door of a company fiche, opened from two places: the reports
 * section (which pre-selects "reporting") and the documents card (which
 * pre-selects a plain filing). Both keep the FULL kind selector — only the
 * default differs, so a file that turns out to be something else is still one
 * dropdown away, and the door you push says what you are dropping.
 *
 * The chosen type decides what happens to the file: a reporting goes through
 * the analysis pipeline (`reportInbox.createFromUpload`, same circuit as a
 * forwarded email — it names and dates the report itself, hence no
 * title/period field), anything else is stored as-is.
 *
 * The pipeline only knows how to analyse a portfolio company, so the reporting
 * option is hidden on group entities and the default falls back there.
 */
export function AddDocumentDialog({
  company,
  deals,
  defaultKind,
  open,
  onClose,
}: {
  company: Doc<'companies'>
  deals: Array<DealOption>
  /** Kind pre-selected when the dialog opens — the door's only difference. */
  defaultKind: DocKind
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)
  const createFromUpload = useConvexMutation(api.reportInbox.createFromUpload)

  const canAnalyse = company.kind === 'portfolio'
  const initialKind: DocKind =
    defaultKind === 'reporting' && !canAnalyse ? 'other' : defaultKind

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Array<File>>([])
  const [titles, setTitles] = useState<Array<string>>([])
  const [kind, setKind] = useState<string>(initialKind)
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
    setKind(initialKind)
    setDateValue('')
    setDealId('none')
    setNote('')
    onClose()
  }

  /** Whole selection or nothing: an oversized file in the batch rejects the
   * pick, so the user re-picks knowingly rather than silently losing one. */
  function handlePick(picked: Array<File>) {
    if (picked.some((file) => file.size > MAX_BYTES)) {
      toast.error(t('participations:documents.errors.too_large'))
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
        toast.success(t('participations:documents.queued'))
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
      toast.success(
        t('participations:documents.added', { count: files.length }),
      )
      close()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'too_large'
          ? t('participations:documents.errors.too_large')
          : t('participations:documents.errors.default'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          {/* The title follows the CURRENT kind, not the door: switching the
              type mid-form changes what is about to happen, and the header is
              where that reads. */}
          <DialogTitle>
            {analysing
              ? t('participations:documents.add.titleReport')
              : t('participations:documents.add.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="size-4" />
              {t('participations:documents.add.pick')}
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
            <Label>{t('participations:documents.kindLabel')}</Label>
            <KindSelect
              value={kind}
              onChange={setKind}
              canAnalyse={canAnalyse}
            />
          </div>

          {analysing ? (
            <>
              <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
                {t('participations:documents.add.analysisHint')}
              </p>
              <div className="space-y-2">
                <Label htmlFor="document-note">
                  {t('participations:documents.add.noteLabel')}
                </Label>
                <Textarea
                  id="document-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t(
                    'participations:documents.add.notePlaceholder',
                  )}
                />
              </div>
            </>
          ) : (
            <>
              {files.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="document-title">
                    {t('participations:documents.titleLabel', {
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
                        id={index === 0 ? 'document-title' : undefined}
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
                <Label htmlFor="document-date">
                  {isDealKind(kind)
                    ? t('participations:documents.dateLabel')
                    : t('participations:documents.periodLabel')}
                </Label>
                <Input
                  id="document-date"
                  type={isDealKind(kind) ? 'date' : 'month'}
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                />
              </div>

              {deals.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('participations:documents.dealLabel')}</Label>
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
              ? t('participations:documents.uploading')
              : analysing
                ? t('participations:documents.add.submitAnalyse')
                : t('participations:documents.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
