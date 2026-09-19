/**
 * Pure arbitration of the capital operations an LLM read in ONE legal
 * document (convex/capitalEventsExtract.ts), before they become PROPOSED
 * rows of `capitalEvents`. Same split as the deal backfill
 * (convex/lib/docBackfill.ts): the model reads and quotes, this file
 * decides — and everything here is testable without a network call.
 *
 * Three rules, all learned on ACT Running (ALB-248):
 *   1. a value without a verbatim quote found in the text is dropped — the
 *      quote is asked for precisely so that it can be checked;
 *   2. our ENTRY round is never proposed: an operation at the closing date of
 *      one of our share deals (±60 days) and at its price IS the deal;
 *   3. an operation already known on the company (confirmed, proposed or
 *      rejected — same date ±7 days, same price) is never proposed again:
 *      a refusal is a memory, and three documents describe the same round.
 */
import { LATER_DOCUMENT_TOLERANCE_DAYS, isoToMs } from './docBackfill'
import { CAPITAL_EVENT_KINDS } from './capitalPosition'
import type { CapitalEventKind } from './capitalPosition'

/** Document kinds that describe an operation on the capital. */
export const CAPITAL_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'legal',
  'pacte',
  'subscription',
])

export interface Cited<T> {
  value: T
  quote: string
}

/** One operation as the model returned it: values AS WRITTEN, each quoted. */
export interface ExtractedOperation {
  kind: string
  dateISO: Cited<string> | null
  pricePerShareEur: Cited<number> | null
  sharesIssued: Cited<number> | null
  totalSharesAfter: Cited<number> | null
  roundSizeEur: Cited<number> | null
}

/** A dated price already known on the company: our deals, existing rows. */
export interface KnownPoint {
  asOf: number
  pricePerShareCents: number
}

export interface ProposalInput {
  asOf: number
  kind: CapitalEventKind
  pricePerShare: number // cents
  sharesIssued?: number
  totalSharesAfter: number
  roundSize?: number // cents
  /** The quotes that back the date, the price and the count. */
  evidence: string
}

export interface ProposalPlan {
  proposals: Array<ProposalInput>
  skipped: Array<{ index: number; reason: string }>
}

/** Two operations closer than this, at the same price, are the same one. */
export const DUPLICATE_TOLERANCE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Whitespace-insensitive containment — OCR reflows lines. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function quoted<T>(c: Cited<T> | null, haystack: string): Cited<T> | null {
  if (!c || c.quote.trim() === '') return null
  return haystack.includes(flat(c.quote)) ? c : null
}

const eurToCents = (eur: number) => Math.round(eur * 100)

function sameOperation(a: KnownPoint, b: KnownPoint, toleranceDays: number) {
  return (
    a.pricePerShareCents === b.pricePerShareCents &&
    Math.abs(a.asOf - b.asOf) <= toleranceDays * DAY_MS
  )
}

/**
 * Sorts the model's operations into proposals and skips. `text` is the
 * document the model read; `entryPoints` our share deals in the company
 * (closing or signature date + price); `existingPoints` every capital event
 * already on the company, whatever its status.
 */
export function planProposals(input: {
  text: string
  operations: Array<ExtractedOperation>
  entryPoints: Array<KnownPoint>
  existingPoints: Array<KnownPoint>
}): ProposalPlan {
  const haystack = flat(input.text)
  const proposals: Array<ProposalInput> = []
  const skipped: Array<{ index: number; reason: string }> = []
  const seen: Array<KnownPoint> = [...input.existingPoints]

  input.operations.forEach((raw, index) => {
    const date = quoted(raw.dateISO, haystack)
    const price = quoted(raw.pricePerShareEur, haystack)
    const total = quoted(raw.totalSharesAfter, haystack)
    if (!date || !ISO_DATE.test(date.value.trim())) {
      skipped.push({ index, reason: 'date_manquante' })
      return
    }
    if (!price || !(price.value > 0)) {
      skipped.push({ index, reason: 'prix_manquant' })
      return
    }
    if (!total || !Number.isInteger(total.value) || total.value <= 0) {
      skipped.push({ index, reason: 'actions_totales_manquantes' })
      return
    }
    const point: KnownPoint = {
      asOf: isoToMs(date.value.trim()),
      pricePerShareCents: eurToCents(price.value),
    }
    if (
      input.entryPoints.some((e) =>
        sameOperation(e, point, LATER_DOCUMENT_TOLERANCE_DAYS),
      )
    ) {
      skipped.push({ index, reason: 'tour_d_entree' })
      return
    }
    if (seen.some((e) => sameOperation(e, point, DUPLICATE_TOLERANCE_DAYS))) {
      skipped.push({ index, reason: 'deja_connue' })
      return
    }
    seen.push(point)

    const issued = quoted(raw.sharesIssued, haystack)
    const roundSize = quoted(raw.roundSizeEur, haystack)
    const kind = (CAPITAL_EVENT_KINDS as ReadonlyArray<string>).includes(
      raw.kind,
    )
      ? (raw.kind as CapitalEventKind)
      : 'other'
    proposals.push({
      asOf: point.asOf,
      kind,
      pricePerShare: point.pricePerShareCents,
      ...(issued && Number.isInteger(issued.value) && issued.value >= 0
        ? { sharesIssued: issued.value }
        : {}),
      totalSharesAfter: total.value,
      ...(roundSize && roundSize.value > 0
        ? { roundSize: eurToCents(roundSize.value) }
        : {}),
      evidence: [date.quote, price.quote, total.quote]
        .map((q) => q.trim())
        .join(' — '),
    })
  })

  return { proposals, skipped }
}
