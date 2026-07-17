/**
 * Pure detection of recurring flows in the transaction history → forecast
 * rule suggestions (phase 4a). No Convex/Node import — tested by
 * tests/recurrenceDetection.test.ts (same pattern as recurrence.ts).
 *
 * Groups transactions by (direction, stable label pattern) — the SAME key
 * as the learned categorization rules (lib/categories.ts
 * deriveCategoryPattern) — then keeps the groups that look like a real
 * recurring cause: enough occurrences, regular spacing, stable amounts.
 * Detection only SUGGESTS: turning a suggestion into a forecastRule is
 * always a human gesture.
 */

import { deriveCategoryPattern, isValidForecastCategory } from './categories'

/** Transaction fields needed for detection (already org-scoped, EUR). */
export type DetectionTx = {
  transactionDate: number
  amountCents: number
  direction: 'in' | 'out'
  rawLabel: string
  counterparty: string | null
  /** Analysis bucket (effectiveCategory) — null = ignored/internal. */
  category: string | null
}

/** Existing rule fields needed for the covered-group dedup. */
export type ExistingRule = {
  direction: 'in' | 'out'
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  amountCents: number
  active: boolean
}

export type RuleSuggestion = {
  pattern: string
  direction: 'in' | 'out'
  /** Prefill label: most frequent counterparty, else last raw label. */
  label: string
  /** Median amount of the group. */
  amountCents: number
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  anchorDay: number
  /** Last occurrence date — keeps the quarterly/yearly phase anchored. */
  startDate: number
  /** Majority bucket of the group when it is a valid forecast category. */
  category: string | null
  occurrences: number
  minAmountCents: number
  maxAmountCents: number
  /** Up to 3 most recent occurrence dates, descending. */
  lastDates: Array<number>
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Minimum occurrences for the short frequencies (weekly/monthly): two
 * transactions ~30 days apart are not a rent yet. */
export const DETECTION_MIN_OCCURRENCES = 3
/** Long frequencies (quarterly/yearly) fire from 2 occurrences: a single
 * clean ~91-day or ~365-day interval is already a strong signal, and
 * waiting for a 3rd yearly occurrence would need 2+ years of history. */
export const DETECTION_MIN_OCCURRENCES_LONG = 2
/** Amount-stability window around the group median. */
export const DETECTION_AMOUNT_TOLERANCE = 0.4
/** Share of the group's amounts that must sit inside the tolerance window —
 * a majority rule, so one exceptional occurrence (catch-up invoice,
 * variable utility bill) no longer kills an otherwise clean group. The
 * suggested amount stays the median; the min→max range is shown in the UI. */
export const DETECTION_AMOUNT_MAJORITY = 0.6
/** An active rule with the same frequency/direction and an amount within
 * ±15 % of the group median marks the group as already covered. */
export const DETECTION_COVERED_TOLERANCE = 0.15

// Interval → frequency mapping (median spacing in days, with tolerance).
// Yearly needs the 24-month detection window (2 occurrences minimum).
const FREQUENCY_STEPS = [
  { frequency: 'weekly', days: 7, tolerance: 2 },
  { frequency: 'monthly', days: 30.44, tolerance: 7 },
  { frequency: 'quarterly', days: 91.3, tolerance: 14 },
  { frequency: 'yearly', days: 365.25, tolerance: 31 },
] as const

/** Lower median — deterministic and integer-safe. */
function median(sorted: Array<number>): number {
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/** ISO day (1 = Monday … 7 = Sunday), UTC. */
function isoDayUtc(ms: number): number {
  const day = new Date(ms).getUTCDay()
  return day === 0 ? 7 : day
}

/**
 * Frequency of a sorted date series, or null when the spacing is not
 * regular enough: the median interval must sit inside one frequency step's
 * tolerance, and at least 60 % of the individual intervals too (one missed
 * or doubled occurrence must not kill an otherwise clean series).
 */
export function detectFrequency(
  sortedDates: Array<number>,
): (typeof FREQUENCY_STEPS)[number]['frequency'] | null {
  if (sortedDates.length < 2) return null
  const intervals: Array<number> = []
  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push((sortedDates[i] - sortedDates[i - 1]) / DAY_MS)
  }
  const med = median([...intervals].sort((a, b) => a - b))
  for (const step of FREQUENCY_STEPS) {
    if (Math.abs(med - step.days) > step.tolerance) continue
    const within = intervals.filter(
      (days) => Math.abs(days - step.days) <= step.tolerance,
    ).length
    if (within / intervals.length >= 0.6) return step.frequency
  }
  return null
}

/**
 * Detects recurring flows and suggests forecast rules, biggest amounts
 * first. Amount stability is a MAJORITY rule (60 % of amounts within ±40 %
 * of the median) rather than an all-amounts gate — variable-amount
 * recurrings (utilities, interest) are suggested with their median, and
 * the human validates from the displayed min→max range.
 */
export function detectRecurringFlows(params: {
  transactions: Array<DetectionTx>
  existingRules: Array<ExistingRule>
  dismissed: Array<{ pattern: string; direction: 'in' | 'out' }>
}): Array<RuleSuggestion> {
  const dismissedKeys = new Set(
    params.dismissed.map((d) => `${d.direction}:${d.pattern}`),
  )

  // 1. Group by (direction, stable pattern).
  const groups = new Map<string, Array<DetectionTx>>()
  for (const tx of params.transactions) {
    if (tx.category === null) continue // ignored / internal transfer
    const pattern = deriveCategoryPattern(tx.rawLabel, tx.counterparty)
    if (!pattern) continue
    const key = `${tx.direction}:${pattern}`
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const suggestions: Array<RuleSuggestion> = []
  for (const [key, group] of groups) {
    if (dismissedKeys.has(key)) continue
    if (group.length < DETECTION_MIN_OCCURRENCES_LONG) continue
    group.sort((a, b) => a.transactionDate - b.transactionDate)

    // 2. Regular spacing — the minimum occurrences depend on the detected
    // frequency (short ones need 3, long ones fire from 2).
    const frequency = detectFrequency(group.map((tx) => tx.transactionDate))
    if (!frequency) continue
    const minOccurrences =
      frequency === 'quarterly' || frequency === 'yearly'
        ? DETECTION_MIN_OCCURRENCES_LONG
        : DETECTION_MIN_OCCURRENCES
    if (group.length < minOccurrences) continue

    // 3. Majority-stable amounts around the median.
    const amounts = group.map((tx) => tx.amountCents).sort((a, b) => a - b)
    const amountCents = median(amounts)
    const minAmountCents = amounts[0]
    const maxAmountCents = amounts[amounts.length - 1]
    const withinTolerance = amounts.filter(
      (cents) =>
        cents >= amountCents * (1 - DETECTION_AMOUNT_TOLERANCE) &&
        cents <= amountCents * (1 + DETECTION_AMOUNT_TOLERANCE),
    ).length
    if (withinTolerance / amounts.length < DETECTION_AMOUNT_MAJORITY) continue

    const direction = group[0].direction
    const pattern = key.slice(key.indexOf(':') + 1)

    // 4. Already covered by an active rule?
    const covered = params.existingRules.some(
      (rule) =>
        rule.active &&
        rule.direction === direction &&
        rule.frequency === frequency &&
        Math.abs(rule.amountCents - amountCents) <=
          amountCents * DETECTION_COVERED_TOLERANCE,
    )
    if (covered) continue

    // 5. Prefill values.
    const anchorDay =
      frequency === 'weekly'
        ? median(group.map((tx) => isoDayUtc(tx.transactionDate)).sort((a, b) => a - b))
        : median(
            group
              .map((tx) => new Date(tx.transactionDate).getUTCDate())
              .sort((a, b) => a - b),
          )
    const counterpartyCounts = new Map<string, number>()
    for (const tx of group) {
      if (!tx.counterparty?.trim()) continue
      counterpartyCounts.set(
        tx.counterparty,
        (counterpartyCounts.get(tx.counterparty) ?? 0) + 1,
      )
    }
    const label =
      [...counterpartyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      group[group.length - 1].rawLabel
    const categoryCounts = new Map<string, number>()
    for (const tx of group) {
      if (tx.category === null) continue
      categoryCounts.set(tx.category, (categoryCounts.get(tx.category) ?? 0) + 1)
    }
    // Never empty: nulls (ignored/internal) were dropped at grouping time.
    const majorityCategory =
      [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const category = isValidForecastCategory(direction, majorityCategory)
      ? majorityCategory
      : null

    suggestions.push({
      pattern,
      direction,
      label,
      amountCents,
      frequency,
      anchorDay,
      startDate: group[group.length - 1].transactionDate,
      category,
      occurrences: group.length,
      minAmountCents,
      maxAmountCents,
      lastDates: group
        .slice(-3)
        .map((tx) => tx.transactionDate)
        .reverse(),
    })
  }

  suggestions.sort((a, b) => b.amountCents - a.amountCents)
  return suggestions
}
