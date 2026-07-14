/**
 * Pure suggestion engine for the forecast-entry ↔ real-transaction
 * reconciliation (phase 2b). No Convex/Node import — tested by
 * tests/entryMatching.test.ts (same pattern as recurrence.ts).
 *
 * A candidate pair must share the direction and sit inside a date window
 * and an amount window; the score blends amount closeness (dominant),
 * date proximity and label-token overlap. Assignment is greedy by score:
 * one transaction realizes at most one entry and vice versa.
 */

import { normalizeSearch } from './searchText'

/** |tx date − entry date| tolerance. */
export const MATCH_DATE_WINDOW_DAYS = 10
/** tx amount must fall within [50 %, 150 %] of the entry amount. */
export const MATCH_AMOUNT_RATIO_MIN = 0.5
export const MATCH_AMOUNT_RATIO_MAX = 1.5
/**
 * Minimum blended score. Calibrated so an exact amount passes on date
 * proximity alone (≤ ~6 days), while a distant date or a partial payment
 * (amount ratio near the bounds) needs label support to surface.
 */
export const MATCH_MIN_SCORE = 0.6

const DAY_MS = 24 * 60 * 60 * 1000

/** Pending entry fields needed for matching (ids stay opaque strings). */
export type MatchableEntry = {
  id: string
  date: number
  amountCents: number
  direction: 'in' | 'out'
  label: string
}

/** Candidate transaction fields needed for matching. */
export type MatchableTx = {
  id: string
  transactionDate: number
  amountCents: number
  direction: 'in' | 'out'
  /** Normalized label+counterparty (searchText); fallback text if absent. */
  searchText: string
}

export type EntryMatchSuggestion = {
  entryId: string
  transactionId: string
  score: number
}

/**
 * Label tokens for the overlap signal: normalized, ≥ 3 chars, non-numeric
 * (dates and references carry no counterparty identity — same intuition as
 * categories.ts deriveCategoryPattern).
 */
export function matchTokens(text: string): Array<string> {
  return normalizeSearch(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
}

/** Share of the entry's tokens found in the transaction text (0 → 1). */
function labelOverlap(entryLabel: string, txSearchText: string): number {
  const entryTokens = matchTokens(entryLabel)
  if (entryTokens.length === 0) return 0
  const txTokens = new Set(matchTokens(txSearchText))
  let hits = 0
  for (const token of entryTokens) {
    if (txTokens.has(token)) hits += 1
  }
  return hits / entryTokens.length
}

/**
 * Blended score of a (entry, tx) pair, or null when the pair is out of the
 * hard windows (direction, date, amount ratio) or below MATCH_MIN_SCORE.
 */
export function scoreEntryMatch(
  entry: MatchableEntry,
  tx: MatchableTx,
): number | null {
  if (entry.direction !== tx.direction) return null
  if (entry.amountCents <= 0) return null

  const deltaDays = Math.abs(tx.transactionDate - entry.date) / DAY_MS
  if (deltaDays > MATCH_DATE_WINDOW_DAYS) return null

  const ratio = tx.amountCents / entry.amountCents
  if (ratio < MATCH_AMOUNT_RATIO_MIN || ratio > MATCH_AMOUNT_RATIO_MAX) {
    return null
  }

  const amountScore =
    1 - Math.min(1, Math.abs(tx.amountCents - entry.amountCents) / entry.amountCents)
  const dateScore = 1 - deltaDays / MATCH_DATE_WINDOW_DAYS
  const labelScore = labelOverlap(entry.label, tx.searchText)

  const score = 0.5 * amountScore + 0.25 * dateScore + 0.25 * labelScore
  return score >= MATCH_MIN_SCORE ? score : null
}

/**
 * Best pairing over the whole candidate sets, greedy by descending score:
 * each entry gets at most one transaction and each transaction is suggested
 * at most once. Output ordered by entry date ascending (stable to display).
 */
export function suggestEntryMatches(params: {
  entries: Array<MatchableEntry>
  transactions: Array<MatchableTx>
}): Array<EntryMatchSuggestion> {
  const pairs: Array<EntryMatchSuggestion & { entryDate: number }> = []
  for (const entry of params.entries) {
    for (const tx of params.transactions) {
      const score = scoreEntryMatch(entry, tx)
      if (score === null) continue
      pairs.push({
        entryId: entry.id,
        transactionId: tx.id,
        score,
        entryDate: entry.date,
      })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const usedEntries = new Set<string>()
  const usedTxs = new Set<string>()
  const picked: Array<EntryMatchSuggestion & { entryDate: number }> = []
  for (const pair of pairs) {
    if (usedEntries.has(pair.entryId) || usedTxs.has(pair.transactionId)) {
      continue
    }
    usedEntries.add(pair.entryId)
    usedTxs.add(pair.transactionId)
    picked.push(pair)
  }

  picked.sort((a, b) => a.entryDate - b.entryDate)
  return picked.map(({ entryDate: _entryDate, ...suggestion }) => suggestion)
}
