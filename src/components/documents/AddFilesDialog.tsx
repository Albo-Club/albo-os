import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
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
import { Spinner } from '~/components/ui/spinner'

/**
 * The one door every document goes through — a company's, a loan's, a
 * guarantee's, a property's. Pick files, drop them. Nothing else is asked.
 *
 * The type and the covered period used to be typed in here, on a file the
 * uploader had just picked and the app was about to read anyway: each
 * document is OCR'd seconds later and classified from its own text
 * (`convex/documentsClassify.ts`). So the row is created with the file name
 * as title and the `other` kind, and settles on its own — a wrong guess is
 * one edit away, on a surface that kept its full form.
 *
 * A REPORT is not filed here: it goes through `AddReportDialog`, whose
 * analysis pipeline is a different circuit altogether.
 */

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. convex/files.ts)

/** What the document hangs off. `documents:create` resolves the org from
 * whichever anchor is present and refuses a row with none, so the anchor is
 * the ONLY thing the caller has to supply — never an `orgId`, which would be
 * a tenancy hole (cf. `CLAUDE.md`). */
export type DocumentAnchor =
  | { kind: 'company'; companyId: Id<'companies'> }
  | { kind: 'loan'; loanId: Id<'loans'> }
  | { kind: 'property'; propertyId: Id<'properties'> }
  | { kind: 'guarantee'; guaranteeId: Id<'guarantees'> }

/** The anchor as `documents:create` expects it — exactly one id. */
function anchorArgs(anchor: DocumentAnchor) {
  switch (anchor.kind) {
    case 'company':
      return { companyId: anchor.companyId }
    case 'loan':
      return { loanId: anchor.loanId }
    case 'property':
      return { propertyId: anchor.propertyId }
    case 'guarantee':
      return { guaranteeId: anchor.guaranteeId }
  }
}

/** A file name without its extension — the title until the reading gives a
 * better one, and what the picker shows in the list. */
function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '')
}

export function AddFilesDialog({
  anchor,
  open,
  onClose,
}: {
  anchor: DocumentAnchor
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation(['documents', 'common'])
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const createDocument = useConvexMutation(api.documents.create)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Array<File>>([])
  const [saving, setSaving] = useState(false)

  function close() {
    setFiles([])
    onClose()
  }

  /** Whole selection or nothing: an oversized file in the batch rejects the
   * pick, so the user re-picks knowingly rather than silently losing one. */
  function handlePick(picked: Array<File>) {
    if (picked.some((file) => file.size > MAX_BYTES)) {
      toast.error(t('documents:errors.too_large'))
      return
    }
    setFiles((prev) => [...prev, ...picked])
  }

  async function handleSubmit() {
    if (files.length === 0) return
    setSaving(true)
    try {
      // One upload + one create per file, in series. A failure stops the
      // batch: the documents already created stay (the list refreshes on
      // its own), the rest never left the browser.
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
        await createDocument({
          ...anchorArgs(anchor),
          title: baseName(file),
          // The reading classifies it; until then it is filed under the kind
          // that claims nothing.
          kind: 'other',
          storageId,
        })
      }
      toast.success(t('documents:added', { count: files.length }))
      close()
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('documents:add.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
          >
            <Plus className="size-4" />
            {t('documents:add.pick')}
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
            <ul className="space-y-1 text-sm">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2"
                >
                  <span className="truncate">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6 shrink-0"
                    disabled={saving}
                    aria-label={t('common:actions.remove')}
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted-foreground text-sm">
            {t('documents:add.classifyHint')}
          </p>
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
            {saving ? t('documents:uploading') : t('documents:add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
