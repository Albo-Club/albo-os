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
