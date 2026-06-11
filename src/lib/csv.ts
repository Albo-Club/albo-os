/**
 * Client-side CSV generation (pure logic, tested by tests/csv.test.ts).
 *
 * `;` separator + UTF-8 BOM: that's what Excel in French locale opens
 * correctly on double-click (`,` is the decimal separator there).
 */

const SEPARATOR = ';'
const BOM = '\uFEFF'

/** Escape a cell: quote it if it contains a separator/quote/newline. */
function escapeCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(SEPARATOR) || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`
  }
  return s
}

/** Serialize headers + rows to CSV (BOM included, CRLF line endings). */
export function toCsv(
  headers: Array<string>,
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCell).join(SEPARATOR),
  )
  return BOM + lines.join('\r\n')
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
