import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

/**
 * The reports door of a company fiche — the manual twin of a forwarded email.
 * The files go through the analysis pipeline (`reportInbox.createFromUpload`),
 * which names and dates the report itself and refreshes the company's
 * synthesis: there is no title, no period and no type to give here.
 *
 * The optional note is the only thing the analysis cannot read from the
 * files — what the covering email would have said.
 *
 * The pipeline only knows how to analyse a PORTFOLIO company and refuses
 * anything else, so the caller hides this door on a group entity. A plain
 * filing goes through `AddFilesDialog` instead.
 */

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. convex/files.ts)

export function AddReportDialog({
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

  /** Whole selection or nothing: an oversized file in the batch rejects the
   * pick, so the user re-picks knowingly rather than silently losing one. */
  function handlePick(picked: Array<File>) {
    if (picked.some((file) => file.size > MAX_BYTES)) {
      toast.error(t('participations:documents.errors.too_large'))
      return
    }
    setFiles((prev) => [...prev, ...picked])
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
        if (!res.ok) throw new Error('upload_failed')
        const { storageId } = (await res.json()) as {
          storageId: Id<'_storage'>
        }
        storageIds.push(storageId)
      }
      // The whole batch is ONE report: an investor update and its annexes
      // reach the pipeline together, exactly as an email would.
      await createFromUpload({
        companyId,
        storageIds,
        filenames: files.map((file) => file.name),
        note: note.trim() || undefined,
      })
      toast.success(t('participations:documents.queued'))
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
          <DialogTitle>
            {t('participations:documents.add.titleReport')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
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
            {files.length > 0 && (
              <ul className="text-muted-foreground space-y-1 text-sm">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="truncate">
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
            {t('participations:documents.add.analysisHint')}
          </p>

          <div className="space-y-2">
            <Label htmlFor="report-note">
              {t('participations:documents.add.noteLabel')}
            </Label>
            <Textarea
              id="report-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('participations:documents.add.notePlaceholder')}
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
              ? t('participations:documents.uploading')
              : t('participations:documents.add.submitAnalyse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
