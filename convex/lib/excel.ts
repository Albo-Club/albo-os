/**
 * Excel / CSV → text for the report content router (brick 4).
 *
 * Plain cell dump per sheet (CSV-style rows), bounded. No financial-structure
 * parsing: normalization happens at metric-extraction time (brick 5) with
 * the company's known metric keys — the "llmPrompt truthy but empty" trap
 * from Albo App is avoided by never pre-digesting here.
 */

import * as XLSX from 'xlsx'

const MAX_ROWS_PER_SHEET = 300
const MAX_CHARS = 40_000

export function excelToText(buf: ArrayBuffer, filename: string): string {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const parts: Array<string> = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    })
    if (rows.length === 0) continue
    const dump = rows
      .slice(0, MAX_ROWS_PER_SHEET)
      .map((r) => r.map((c) => (c == null ? '' : String(c))).join(' | '))
      .join('\n')
    parts.push(`## ${filename} — feuille "${sheetName}" (${rows.length} lignes)\n${dump}`)
  }
  const text = parts.join('\n\n')
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[...tronqué]` : text
}

export function csvToText(buf: ArrayBuffer, filename: string): string {
  const text = new TextDecoder('utf-8').decode(buf)
  const bounded = text.split('\n').slice(0, MAX_ROWS_PER_SHEET).join('\n')
  const out = `## ${filename}\n${bounded}`
  return out.length > MAX_CHARS ? `${out.slice(0, MAX_CHARS)}\n[...tronqué]` : out
}
