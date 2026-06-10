/**
 * Génération CSV côté client (logique pure, testée par tests/csv.test.ts).
 *
 * Séparateur `;` + BOM UTF-8 : c'est ce qu'Excel en locale française ouvre
 * correctement par double-clic (le `,` y est le séparateur décimal).
 */

const SEPARATOR = ';'
const BOM = '\uFEFF'

/** Échappe une cellule : guillemets si séparateur/guillemet/retour ligne. */
function escapeCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(SEPARATOR) || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`
  }
  return s
}

/** Sérialise entêtes + lignes en CSV (BOM inclus, lignes CRLF). */
export function toCsv(
  headers: Array<string>,
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCell).join(SEPARATOR),
  )
  return BOM + lines.join('\r\n')
}

/** Déclenche le téléchargement d'un CSV dans le navigateur. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
