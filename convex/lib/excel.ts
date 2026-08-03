/**
 * Excel / CSV → text for the report content router (brick 4).
 *
 * Plain cell dump per sheet (CSV-style rows), bounded. No financial-structure
 * parsing: normalization happens at metric-extraction time (brick 5) with
 * the company's known metric keys — the "llmPrompt truthy but empty" trap
 * from Albo App is avoided by never pre-digesting here.
 *
 * Budgeting: the workbook's budget is the per-document one
 * (`MAX_DOCUMENT_CHARS`), and it is shared BETWEEN sheets, never spent by
 * the first one. A single flat cap applied after concatenation used to let a
 * dense first sheet eat everything, silently dropping every following sheet —
 * the workbook read as "only the first tab". Every non-empty sheet now always
 * gets its header (so it is at least named and counted), and the remaining
 * budget is spread max-min fair over the rows: sheets that need less than
 * their share release the rest to the bigger ones. Any cut is stated in the
 * text, never silent.
 */

import * as XLSX from 'xlsx'
import { MAX_DOCUMENT_CHARS } from './fileText'

const SEP = '\n\n'
/** Reserved per sheet so appending the cut marker cannot bust the budget. */
const MARKER_RESERVE = 40

function cutMarker(lines: number): string {
  return `\n[...${lines} ligne${lines > 1 ? 's' : ''} tronquée${lines > 1 ? 's' : ''}]`
}

/**
 * Max-min fair split of `budget` over `needs`: repeatedly hand out an equal
 * share, and redistribute what the sheets under their share do not use. A
 * workbook of one 500k-row sheet plus five small ones therefore spends nearly
 * everything on the big one instead of capping it at budget/6.
 */
function fairShares(needs: Array<number>, budget: number): Array<number> {
  const shares = needs.map(() => 0)
  let pending = needs.map((_, i) => i)
  let left = Math.max(budget, 0)
  while (pending.length > 0) {
    const share = Math.floor(left / pending.length)
    const fits = pending.filter((i) => needs[i] <= share)
    if (fits.length === 0) {
      for (const i of pending) shares[i] = share
      break
    }
    for (const i of fits) {
      shares[i] = needs[i]
      left -= needs[i]
    }
    pending = pending.filter((i) => needs[i] > share)
  }
  return shares
}

/** Renders the lines that fit in `budget`, flagging how many were dropped. */
function fitLines(lines: Array<string>, budget: number): string {
  let used = 0
  let kept = 0
  while (kept < lines.length && used + lines[kept].length + 1 <= budget) {
    used += lines[kept].length + 1
    kept += 1
  }
  const body = lines.slice(0, kept).join('\n')
  return kept === lines.length ? body : body + cutMarker(lines.length - kept)
}

export function excelToText(buf: ArrayBuffer, filename: string): string {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })

  const sheets: Array<{ header: string; lines: Array<string> }> = []
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Array<unknown>>(wb.Sheets[sheetName], {
      header: 1,
      raw: false,
      blankrows: false,
    })
    if (rows.length === 0) continue
    sheets.push({
      header: `## ${filename} — feuille "${sheetName}" (${rows.length} lignes)`,
      lines: rows.map((r) => r.map((c) => (c == null ? '' : String(c))).join(' | ')),
    })
  }
  if (sheets.length === 0) return ''

  // Headers and cut markers are paid first: a sheet always appears, so a
  // workbook can never look like it has fewer tabs than it does.
  const fixed = sheets.reduce(
    (sum, s) => sum + s.header.length + SEP.length + MARKER_RESERVE,
    0,
  )
  const shares = fairShares(
    sheets.map((s) => s.lines.reduce((sum, l) => sum + l.length + 1, 0)),
    MAX_DOCUMENT_CHARS - fixed,
  )

  return sheets
    .map((s, i) => `${s.header}\n${fitLines(s.lines, shares[i])}`)
    .join(SEP)
}

export function csvToText(buf: ArrayBuffer, filename: string): string {
  const lines = new TextDecoder('utf-8').decode(buf).split('\n')
  const header = `## ${filename}`
  return `${header}\n${fitLines(lines, MAX_DOCUMENT_CHARS - header.length - MARKER_RESERVE)}`
}
