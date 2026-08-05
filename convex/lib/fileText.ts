/**
 * Shared rules for reading a file's text — classification thresholds and the
 * per-file text budget. Lives here so the two extraction paths (the report
 * pipeline in `reportExtract.ts` and the manual-upload path in
 * `documentsExtract.ts`) can never drift on what counts as an image, what is
 * too small to OCR, or how much text a document may hold.
 */

export const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm'])
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

/** Below this, images are logos / email signatures: kept, never OCR'd. */
export const MIN_OCR_IMAGE_BYTES = 15_000

/**
 * Per-file text budget (~350 dense A4 pages). A Convex document is capped at
 * 1 MB for ALL its fields combined, and French text costs ~1.05 bytes per
 * character in UTF-8 — this leaves comfortable headroom under that cap.
 */
export const MAX_DOCUMENT_CHARS = 900_000

export function ext(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export function isImage(filename: string, contentType?: string): boolean {
  return IMAGE_EXTS.has(ext(filename)) || Boolean(contentType?.startsWith('image/'))
}

/**
 * Tabular file — workbook or CSV — by the same rules the extraction paths use
 * to pick their parser (`documentsExtract.classify`). Kept here next to
 * `isImage` so the readers and the indexer can never drift on what counts as
 * a table.
 */
export function isSpreadsheet(filename: string, contentType?: string): boolean {
  const e = ext(filename)
  const ct = contentType ?? ''
  return (
    EXCEL_EXTS.has(e) ||
    ct.includes('spreadsheet') ||
    ct.includes('ms-excel') ||
    e === 'csv' ||
    ct === 'text/csv'
  )
}

/** Bounds a file's text to the budget, flagging the cut so the UI can say so. */
export function boundText(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_DOCUMENT_CHARS
    ? { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
    : { text, truncated: false }
}
