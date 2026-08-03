/**
 * Pure tests for the Excel / CSV dump (convex/lib/excel.ts).
 *
 * Regression guard for ALB-114: a workbook whose first sheet is dense used to
 * spend the whole flat budget on that sheet, so every following sheet vanished
 * from the extracted text — the file read as if it had a single tab.
 *
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as XLSX from 'xlsx'
import { csvToText, excelToText } from '../convex/lib/excel'
import { MAX_DOCUMENT_CHARS } from '../convex/lib/fileText'

/** Builds a real .xlsx buffer from `[sheetName, rows]` pairs. */
function workbook(sheets: Array<[string, Array<Array<string>>]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** `rows` × `cols` cells of ~10 chars each. */
function grid(rows: number, cols: number, tag: string): Array<Array<string>> {
  return Array.from({ length: rows }, (_row, r) =>
    Array.from({ length: cols }, (_col, c) => `${tag}-${r}-${c}`),
  )
}

function hasSheet(text: string, name: string): boolean {
  return text.includes(`feuille "${name}"`)
}

describe('excelToText', () => {
  it('rend tous les onglets même quand le premier est volumineux (ALB-114)', () => {
    // ~90k chars on the first sheet: well past the old 40k flat cap, which
    // used to swallow the whole budget before the other sheets were written.
    const buf = workbook([
      ['P&L', grid(600, 15, 'pnl')],
      ['KPIs', [['ARR', '120000'], ['Churn', '2']]],
      ['Trésorerie', [['Compte', 'Solde'], ['Qonto', '50000']]],
    ])
    const text = excelToText(buf, 'reporting.xlsx')

    for (const name of ['P&L', 'KPIs', 'Trésorerie']) {
      assert.ok(hasSheet(text, name), `onglet "${name}" absent de l'extraction`)
    }
    // Small sheets are complete, and nothing was cut at this size.
    assert.ok(text.includes('Qonto | 50000'))
    assert.ok(!text.includes('tronquée'))
  })

  it('ignore les onglets vides sans consommer de budget', () => {
    const text = excelToText(
      workbook([
        ['Vide', []],
        ['Données', [['a', 'b']]],
      ]),
      'f.xlsx',
    )
    assert.ok(!hasSheet(text, 'Vide'))
    assert.ok(hasSheet(text, 'Données'))
  })

  it('annonce le nombre réel de lignes dans l\'en-tête de chaque onglet', () => {
    const text = excelToText(workbook([['Feuille 1', grid(12, 2, 'x')]]), 'f.xlsx')
    assert.ok(text.includes('feuille "Feuille 1" (12 lignes)'))
  })

  it('coupe le gros onglet, préserve les petits et signale la troncature', () => {
    // ~1.2M chars on the first sheet — over the per-document budget, so the
    // cut is unavoidable. What matters: it falls on the sheet that overflows,
    // the small ones stay whole, and the cut is stated.
    const fat = Array.from({ length: 1200 }, (_, r) => [`${r}`.padEnd(1000, 'x')])
    const text = excelToText(
      workbook([
        ['Transactions', fat],
        ['Synthèse', [['Total', '42']]],
      ]),
      'gros.xlsx',
    )

    assert.ok(hasSheet(text, 'Transactions'))
    assert.ok(hasSheet(text, 'Synthèse'))
    assert.match(text, /\[\.\.\.\d+ lignes tronquées\]/)
    // The small sheet is intact despite the neighbour blowing the budget.
    assert.ok(text.includes('Total | 42'))
    assert.ok(text.length <= MAX_DOCUMENT_CHARS)
  })

  it('rend un classeur vide comme une chaîne vide', () => {
    assert.equal(excelToText(workbook([['Vide', []]]), 'f.xlsx'), '')
  })
})

describe('csvToText', () => {
  it('ne coupe plus un CSV de plus de 300 lignes', () => {
    const csv = Array.from({ length: 900 }, (_, i) => `ligne${i};valeur${i}`).join('\n')
    const text = csvToText(new TextEncoder().encode(csv).buffer, 'export.csv')
    assert.ok(text.includes('ligne0;valeur0'))
    assert.ok(text.includes('ligne899;valeur899'))
    assert.ok(!text.includes('tronquée'))
  })
})
