/**
 * Capital & valuation position of a portfolio company — pure, no Convex.
 *
 * Three objects, never conflated (ALB-248):
 *   - the DEAL is what we bought, frozen: shares, price, post-money of the
 *     round we entered on. It IS the entry, and it is copied nowhere else.
 *   - a CAPITAL EVENT is an operation on the company's share capital after
 *     that: the next round, a BSA exercise, a conversion, a secondary… Rows
 *     of `capitalEvents`, hand-entered (lot 1) or proposed from the legal
 *     documents (lot 2).
 *   - the position below is DERIVED from the two at read time. Nothing here
 *     is stored (CLAUDE.md « ne pas stocker un chiffre dérivable »).
 *
 * The implied post-money of a point is `shares outstanding × price per
 * share`; our stake's value is `shares held × latest price`. A later round
 * at the same price leaves the value unchanged and only dilutes the
 * ownership — exactly ACT Running: 80 € both times, 0.83 % → 0.78 %.
 */
import { literals } from 'convex-helpers/validators'

export const CAPITAL_EVENT_KINDS = [
  'round',
  'bsa_exercise',
  'conversion',
  'secondary',
  'reduction',
  'other',
] as const
export type CapitalEventKind = (typeof CAPITAL_EVENT_KINDS)[number]
export const capitalEventKindValidator = literals(...CAPITAL_EVENT_KINDS)

/** One of our own share deals in the company — the entry round(s). */
export interface EntryDealInput {
  dealId: string
  /** Closing date, else signature date; null when the deal carries none. */
  asOf: number | null
  sharesAcquired: number | null
  pricePerShareCents: number | null
  postMoneyCents: number | null
  /** The stake recorded on the deal, in basis points. */
  ownershipBps: number | null
  /** What the line cost us: paid when known, else committed. */
  costCents: number
}

/** A stored capital event, already scoped to the company. */
export interface CapitalEventInput {
  eventId: string
  asOf: number
  kind: CapitalEventKind
  pricePerShareCents: number
  sharesIssued: number | null
  totalSharesAfter: number
}

export interface TimelinePoint {
  id: string
  source: 'deal' | 'event'
  kind: 'entry' | CapitalEventKind
  asOf: number | null
  pricePerShareCents: number | null
  sharesIssued: number | null
  totalSharesAfter: number | null
  postMoneyCents: number | null
}

export interface CapitalSnapshot {
  asOf: number | null
  pricePerShareCents: number | null
  totalShares: number | null
  postMoneyCents: number | null
  /** Shares held ÷ shares outstanding, in basis points. */
  ownershipBps: number | null
}

export interface CapitalPosition {
  sharesHeld: number
  costCents: number
  entry: CapitalSnapshot
  current: CapitalSnapshot
  /** Shares held × latest known price per share; null without a price. */
  valueCents: number | null
  /** The latest price is strictly below the entry price. */
  downRound: boolean
  /** No capital event after the entry: current is the entry. */
  unchanged: boolean
  timeline: Array<TimelinePoint>
}

const bps = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10_000) : null

/**
 * Shares outstanding right after our entry round: the deal stores the
 * post-money and the price, so the count is `post ÷ price` (ACT Running:
 * 3 000 000 € ÷ 80 € = 37 500). The company's own share count is the
 * fallback when the deal cannot say.
 */
function dealTotalShares(
  deal: EntryDealInput,
  fallbackTotalShares: number | null,
): number | null {
  if (
    deal.postMoneyCents != null &&
    deal.pricePerShareCents != null &&
    deal.pricePerShareCents > 0
  ) {
    return Math.round(deal.postMoneyCents / deal.pricePerShareCents)
  }
  return fallbackTotalShares
}

function dealPoint(
  deal: EntryDealInput,
  fallbackTotalShares: number | null,
): TimelinePoint {
  const total = dealTotalShares(deal, fallbackTotalShares)
  const post =
    deal.postMoneyCents ??
    (total != null && deal.pricePerShareCents != null
      ? total * deal.pricePerShareCents
      : null)
  return {
    id: deal.dealId,
    source: 'deal',
    kind: 'entry',
    asOf: deal.asOf,
    pricePerShareCents: deal.pricePerShareCents,
    sharesIssued: deal.sharesAcquired,
    totalSharesAfter: total,
    postMoneyCents: post,
  }
}

function eventPoint(event: CapitalEventInput): TimelinePoint {
  return {
    id: event.eventId,
    source: 'event',
    kind: event.kind,
    asOf: event.asOf,
    pricePerShareCents: event.pricePerShareCents,
    sharesIssued: event.sharesIssued,
    totalSharesAfter: event.totalSharesAfter,
    postMoneyCents: event.totalSharesAfter * event.pricePerShareCents,
  }
}

function snapshot(
  point: TimelinePoint | undefined,
  sharesHeld: number,
  ownershipOverrideBps: number | null = null,
): CapitalSnapshot {
  if (!point) {
    return {
      asOf: null,
      pricePerShareCents: null,
      totalShares: null,
      postMoneyCents: null,
      ownershipBps: null,
    }
  }
  return {
    asOf: point.asOf,
    pricePerShareCents: point.pricePerShareCents,
    totalShares: point.totalSharesAfter,
    postMoneyCents: point.postMoneyCents,
    ownershipBps:
      ownershipOverrideBps ??
      (point.totalSharesAfter != null
        ? bps(sharesHeld, point.totalSharesAfter)
        : null),
  }
}

/** Oldest first; a point without a date sorts first (it is our entry). */
const byDate = (a: TimelinePoint, b: TimelinePoint) =>
  (a.asOf ?? -Infinity) - (b.asOf ?? -Infinity)

/**
 * Entry vs current, from our share deals and the capital events recorded
 * on the company. `fallbackTotalShares` is `companies.totalShares`, used only
 * when a deal cannot derive the outstanding count itself.
 */
export function computeCapitalPosition(
  deals: Array<EntryDealInput>,
  events: Array<CapitalEventInput>,
  fallbackTotalShares: number | null,
): CapitalPosition {
  const sharesHeld = deals.reduce((s, d) => s + (d.sharesAcquired ?? 0), 0)
  const costCents = deals.reduce((s, d) => s + d.costCents, 0)

  const dealPoints = deals
    .map((d) => dealPoint(d, fallbackTotalShares))
    .sort(byDate)
  const timeline = [...dealPoints, ...events.map(eventPoint)].sort(byDate)

  // The entry is our FIRST deal: its recorded stake is the truth of the day,
  // a ratio on the outstanding count is only the fallback.
  const entryDeal = deals
    .slice()
    .sort((a, b) => (a.asOf ?? -Infinity) - (b.asOf ?? -Infinity))
    .at(0)
  const entry = snapshot(
    dealPoints.at(0),
    sharesHeld,
    entryDeal?.ownershipBps ?? null,
  )

  const unchanged = events.length === 0
  const latest = timeline.at(-1)
  const current = unchanged ? entry : snapshot(latest, sharesHeld)

  const valueCents =
    current.pricePerShareCents != null
      ? sharesHeld * current.pricePerShareCents
      : null
  const downRound =
    entry.pricePerShareCents != null &&
    current.pricePerShareCents != null &&
    current.pricePerShareCents < entry.pricePerShareCents

  return {
    sharesHeld,
    costCents,
    entry,
    current,
    valueCents,
    downRound,
    unchanged,
    timeline,
  }
}
