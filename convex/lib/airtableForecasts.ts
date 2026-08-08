/**
 * Pure planning of the one-shot port of the two Airtable forecast tables
 * (« Prévision de rentrée » / « Prévision de sortie ») into `forecastEntries`.
 *
 * Everything decidable without the database is decided here — direction,
 * amount, exclusions — and tested by tests/airtableForecasts.test.ts. The DB
 * glue (org resolution, deal linking, upsert) lives in
 * convex/migrations/airtableForecastsToEntries.ts.
 */

/** A row as pulled from Airtable (convex/airtableImport.ts). */
export type ForecastSourceRow = {
  airtableId: string
  companyRecId?: string
  /** From the table of origin — NOT from the sign of the amount. */
  direction: 'in' | 'out'
  /** Absolute value in cents; absent when the Airtable cell is empty. */
  amountCents?: number
  dateMs?: number
  label: string
}

/** A row that survived planning and is ready to become a forecast entry. */
export type PlannedEntry = {
  airtableId: string
  companyRecId?: string
  direction: 'in' | 'out'
  amountCents: number
  dateMs: number
  label: string
}

export type SkipReason = 'duplicate_of_rule' | 'no_amount' | 'no_date'

export type SkippedRow = {
  airtableId: string
  label: string
  reason: SkipReason
}

/**
 * Airtable rows already covered by a recurring rule of the `calte` org.
 * Importing them would count the same money a second (and third) time:
 *
 * - the six monthly « Iroko » rows (11 500 €) and the three « IROKO
 *   prévisionel annuel » rows (138 000 € = 12 × 11 500 €) both restate the
 *   `IROKO loyer` rule — 11 475 €/month, no end date, so it already covers
 *   2027-2029;
 * - « Wormser prévisionel » (192 000 €) is the remaining principal of the
 *   loan the `Wormser Prêt pour Iroko` rule already pays down at
 *   4 000 €/month — the very same 48 instalments.
 *
 * Anchored by record id AND guarded by the exact (trimmed) label: should
 * Airtable hand a known id back with different content, the row is imported
 * rather than silently dropped.
 */
export const RULE_DUPLICATE_ROWS: Readonly<Record<string, string>> = {
  rec2rTewky7euJAhF: 'Iroko',
  recBFianKMF6S79VU: 'Iroko',
  recHQ7bADgSKXLR4V: 'Iroko',
  recMlfxMbALuNSo90: 'Iroko',
  recd4VbK3jUIpK7Mn: 'Iroko',
  rectLbg0jvyK6NDZ2: 'Iroko',
  recoesLOtFN8ZybTQ: 'IROKO prévisionel annuel 27',
  recZ9loepjqoEvr17: 'IROKO prévisionel annuel 28',
  rectyWPLII86kM3TQ: 'IROKO prévisionel annuel 29',
  rec66NtasXI871wGk: 'Wormser prévisionel',
}

/** Label of a row whose Airtable name cell is empty. */
const FALLBACK_LABEL = '(prévisionnel)'

/** Idempotency key of an entry ported from Airtable. */
export function airtableDerivedKey(airtableId: string): string {
  return `airtable:${airtableId}`
}

/** Range bounds of the `airtable:` keys, for a `by_derivedKey` index scan. */
export const AIRTABLE_KEY_RANGE = { start: 'airtable:', end: 'airtable;' }

/**
 * Splits the pulled rows into what becomes an entry and what is left behind.
 * A row is dropped when it restates a recurring rule, when it carries no
 * usable amount, or when it has no date — an undated forecast cannot sit on
 * a cash curve, and inventing a date would be worse than reporting the gap.
 */
export function planForecastImport(rows: ReadonlyArray<ForecastSourceRow>): {
  entries: Array<PlannedEntry>
  skipped: Array<SkippedRow>
} {
  const entries: Array<PlannedEntry> = []
  const skipped: Array<SkippedRow> = []

  for (const row of rows) {
    const label = row.label.trim() || FALLBACK_LABEL

    if (RULE_DUPLICATE_ROWS[row.airtableId] === label) {
      skipped.push({
        airtableId: row.airtableId,
        label,
        reason: 'duplicate_of_rule',
      })
      continue
    }
    if (row.amountCents === undefined || row.amountCents <= 0) {
      skipped.push({ airtableId: row.airtableId, label, reason: 'no_amount' })
      continue
    }
    if (row.dateMs === undefined) {
      skipped.push({ airtableId: row.airtableId, label, reason: 'no_date' })
      continue
    }

    entries.push({
      airtableId: row.airtableId,
      companyRecId: row.companyRecId,
      direction: row.direction,
      amountCents: row.amountCents,
      dateMs: row.dateMs,
      label,
    })
  }

  return { entries, skipped }
}

/**
 * Rows that restate one another inside Airtable itself: same direction, same
 * day, same amount to the euro. They are NOT dropped — only surfaced, so the
 * arbitration stays a human gesture in the app.
 */
export function findInternalDuplicates(
  entries: ReadonlyArray<PlannedEntry>,
): Array<Array<PlannedEntry>> {
  const groups = new Map<string, Array<PlannedEntry>>()
  for (const entry of entries) {
    const day = new Date(entry.dateMs).toISOString().slice(0, 10)
    const euros = Math.round(entry.amountCents / 100)
    const key = `${entry.direction}:${day}:${euros}`
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
