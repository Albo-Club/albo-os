/**
 * Parsers for the deal edit form (deals.$dealId.tsx). Inverse of the display
 * formatters in InstrumentBlock.tsx / useFormatters: a string typed in the UI
 * unit (€, %, YYYY-MM-DD) → the storage unit (cents, basis points, ms epoch).
 * Storage conventions: amounts in cents, rates in bps, dates in ms — see
 * CLAUDE.md § Conventions de données.
 */

/** Amount typed in euros → cents (null if not a finite number or negative). */
export function eurosToCents(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

/** Rate typed in percent → basis points (null if invalid or negative). */
export function pctToBps(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

/** Plain integer (shares, year, months, sqm) → number (null if invalid or negative). */
export function intToNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/**
 * Decimal (warrant parity, conversion ratio) → number (null if invalid or
 * negative). Unlike intToNumber, keeps the fractional part (e.g. 1.5 warrants
 * → 1 share, conversion ratio 1.25).
 */
export function decimalToNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/** `YYYY-MM-DD` (date input) → ms epoch (null if empty or invalid). */
export function dateInputToMs(value: string): number | null {
  if (value === '') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** ms epoch → `YYYY-MM-DD`, the value format of `<input type="date">`. */
export function msToDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** cents → euros string (for prefilling a `<input type="number">`). */
export function centsToEurosInput(cents: number): string {
  return String(cents / 100)
}

/** basis points → percent string (for prefilling a `<input type="number">`). */
export function bpsToPctInput(bps: number): string {
  return String(bps / 100)
}

/**
 * Display format of a `deals` column (and, by extension, any fiche field):
 * how a stored value is rendered and parsed back — cents→€, bps→%, ms→date,
 * enum literal, plain number/decimal/year, or free text. Shared by the
 * read-only panels (InstrumentBlock), the edit dialog and the inline editor.
 */
export type FieldFormat =
  | 'eur'
  | 'pct'
  | 'date'
  | 'enum'
  | 'number'
  | 'decimal'
  | 'year'
  | 'text'

/**
 * Input string → stored value. `undefined` = empty (the caller decides: leave
 * unchanged, or clear when the field supports it), `null` = invalid (blocks the
 * save), otherwise the parsed value in the storage unit (cents / bps / ms /
 * enum literal / text).
 */
export function parseField(
  format: FieldFormat,
  value: string,
): number | string | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  switch (format) {
    case 'eur':
      return eurosToCents(trimmed)
    case 'pct':
      return pctToBps(trimmed)
    case 'date':
      return dateInputToMs(value)
    case 'number':
    case 'year':
      return intToNumber(trimmed)
    case 'decimal':
      return decimalToNumber(trimmed)
    default:
      return trimmed
  }
}

/**
 * Stored value → input string, in the UI unit of the field's format. The
 * inverse of parseField, for seeding an editor (dialog or inline) from the
 * saved value.
 */
export function rawToInput(format: FieldFormat, raw: unknown): string {
  if (raw == null) return ''
  switch (format) {
    case 'eur':
      return centsToEurosInput(raw as number)
    case 'pct':
      return bpsToPctInput(raw as number)
    case 'date':
      return msToDateInput(raw as number)
    default:
      return String(raw)
  }
}
