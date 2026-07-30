import { FileSpreadsheet, FileText, Image, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Id } from '../../../convex/_generated/dataModel'
import type { OcrState } from '~/components/documents/DocumentReading'
import { OcrStatus } from '~/components/documents/DocumentReading'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '~/components/ui/attachment'
import { Badge } from '~/components/ui/badge'

/**
 * One document as an attachment card, shared by the company Documents tab and
 * the deal one. Deliberately not a table row: a document is a file you open,
 * not a line of data to compare — the tables on these fiches carry deals and
 * amounts, so documents get their own shape.
 *
 * The whole card opens the file (`AttachmentTrigger` over the download URL);
 * the reading state, the edit pencil and the delete bin sit above it. The
 * caller owns the wording of the description line, since a company document
 * carries a covered period and a deal document its own date.
 */

/** The subset of `documents.listByCompany` / `listByDeal` a card needs. */
export type DocumentCard = {
  _id: Id<'documents'>
  title: string
  contentType: string | null
  ocrState: OcrState
  ocrDetail: string | null
  ocrChars: number | null
  url: string | null
}

function FileGlyph({ contentType }: { contentType: string | null }) {
  if (contentType?.startsWith('image/')) return <Image />
  if (
    contentType === 'text/csv' ||
    contentType?.includes('spreadsheet') ||
    contentType?.includes('excel')
  ) {
    return <FileSpreadsheet />
  }
  return <FileText />
}

export function DocumentAttachment({
  doc,
  kindLabel,
  description,
  onEdit,
  onDelete,
  onOpenText,
}: {
  doc: DocumentCard
  kindLabel: string
  description: string
  onEdit: () => void
  onDelete: () => void
  onOpenText: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])

  return (
    <Attachment className="w-full">
      {doc.url && (
        <AttachmentTrigger asChild>
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t('participations:documentAttachment.open', {
              title: doc.title,
            })}
          />
        </AttachmentTrigger>
      )}
      <AttachmentMedia
        className={
          doc.ocrState === 'failed'
            ? 'bg-destructive/10 text-destructive'
            : undefined
        }
      >
        <FileGlyph contentType={doc.contentType} />
      </AttachmentMedia>
      <AttachmentContent>
        <div className="flex min-w-0 items-center gap-2">
          <AttachmentTitle>{doc.title}</AttachmentTitle>
          <Badge variant="outline" className="shrink-0 font-normal">
            {kindLabel}
          </Badge>
        </div>
        <AttachmentDescription>{description}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions className="gap-0.5">
        <OcrStatus
          documentId={doc._id}
          state={doc.ocrState}
          detail={doc.ocrDetail}
          chars={doc.ocrChars}
          onOpen={onOpenText}
        />
        <AttachmentAction
          onClick={onEdit}
          aria-label={t('participations:documentAttachment.edit')}
          title={t('participations:documentAttachment.edit')}
        >
          <Pencil />
        </AttachmentAction>
        <AttachmentAction
          className="text-destructive"
          onClick={onDelete}
          aria-label={t('common:actions.delete')}
          title={t('common:actions.delete')}
        >
          <Trash2 />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}
