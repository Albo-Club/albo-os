import { AlertTriangle, Loader2, RefreshCw, ScanText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { LoadingLine } from '~/components/ui/spinner'

/**
 * Reading state of a document, shared by the company Documents tab and the
 * deal one — a document follows the same extraction pipeline whichever fiche
 * it hangs off, so both surfaces show the same verdict from the same keys.
 */

export type OcrState = 'pending' | 'extracted' | 'skipped' | 'failed' | null

export function OcrStatus({
  documentId,
  state,
  detail,
  chars,
  onOpen,
}: {
  documentId: Id<'documents'>
  state: OcrState
  detail: string | null
  chars: number | null
  onOpen: () => void
}) {
  const { t, i18n } = useTranslation('participations')
  const reextract = useConvexMutation(api.documents.reextract)

  // Machine codes come from `inboundEmails.sources[].detail` — an unknown one
  // falls back to the raw code rather than an empty cell.
  const detailLabel = detail
    ? t(`documentReading.detail.${detail}`, { defaultValue: detail })
    : null

  async function handleRetry() {
    try {
      await reextract({ documentId })
      toast.success(t('documentReading.restarted'))
    } catch {
      toast.error(t('documentReading.retryError'))
    }
  }

  if (state === 'extracted') {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 font-normal"
        onClick={onOpen}
        title={t('documentReading.open')}
      >
        <ScanText className="size-3.5" />
        {t('documentReading.chars', {
          chars: (chars ?? 0).toLocaleString(i18n.language),
        })}
      </Button>
    )
  }

  if (state === 'pending') {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t('documentReading.pending')}
      </span>
    )
  }

  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1">
        <span className="text-destructive flex items-center gap-1.5 text-xs">
          <AlertTriangle className="size-3.5" />
          {detailLabel ?? t('documentReading.failed')}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => void handleRetry()}
          aria-label={t('documentReading.retry')}
          title={t('documentReading.retry')}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </span>
    )
  }

  if (state === 'skipped') {
    return (
      <span className="text-muted-foreground text-xs">
        {detailLabel ?? t('documentReading.skipped')}
      </span>
    )
  }

  // No state at all: stored before extraction existed. Offer the reading
  // rather than a verdict we never computed.
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground h-7 px-2 font-normal"
      onClick={() => void handleRetry()}
    >
      <ScanText className="size-3.5" />
      {t('documentReading.analyse')}
    </Button>
  )
}

/**
 * The extracted text, fetched only while open — it is never carried by the
 * documents list (cf. the `documentTexts` table).
 */
export function ExtractedTextDialog({
  documentId,
  title,
  onClose,
}: {
  documentId: Id<'documents'> | null
  title: string
  onClose: () => void
}) {
  const { t } = useTranslation('participations')
  const extracted = useConvexQuery(
    api.documents.getExtractedText,
    documentId ? { documentId } : 'skip',
  )

  return (
    <Dialog open={documentId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title || t('documentReading.dialogTitle')}</DialogTitle>
        </DialogHeader>
        {extracted === undefined ? (
          <LoadingLine>{t('loading')}</LoadingLine>
        ) : extracted === null ? (
          <p className="text-muted-foreground text-sm">
            {t('documentReading.noText')}
          </p>
        ) : (
          <div className="space-y-2">
            {extracted.truncated && (
              <p className="text-muted-foreground text-xs">
                {t('documentReading.truncated')}
              </p>
            )}
            <pre className="bg-muted rounded-md p-3 text-xs break-words whitespace-pre-wrap">
              {extracted.text}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
