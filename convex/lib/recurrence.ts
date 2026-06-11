/**
 * Pure logic of the cash flow forecast layer (no Convex dependency, no Node
 * import): recurrence date-math + upsert decision for occurrences.
 * Everything is computed in UTC on ms epochs, per the schema conventions.
 * Tested by tests/recurrence.test.ts (node:test, deliberately outside
 * convex/ to stay out of the deployment bundle).
 */

export type ForecastFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type RecurrenceRule = {
  frequency: ForecastFrequency
  /** "Every N steps" — 1 = every week/month/quarter/year. */
  interval: number
  /** Day of month 1-31 (monthly/quarterly/yearly) or ISO day 1-7 (weekly). */
  anchorDay: number
  startDate: number
  /** Inclusive bound; absent = no end. */
  endDate?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Number of days in the month (month 0-based, normalized by Date.UTC), UTC. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** "YYYY-MM-DD" UTC. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** "YYYY-MM" UTC — bucket key for the monthly balance aggregation. */
export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/** Idempotency key of an occurrence derived from a rule. */
export function ruleDerivedKey(ruleId: string, occurrenceMs: number): string {
  return `rule:${ruleId}:${isoDay(occurrenceMs)}`
}

// ─── Monthly aggregation of the projected balance ───────────────────────────

export type ForecastConfidence = 'confirmed' | 'expected' | 'probable'

export type ForecastEntryStatus = 'pending' | 'realized' | 'cancelled'

/** Confidence rank: `minConfidence` includes any rank above or equal. */
export const CONFIDENCE_RANK: Record<ForecastConfidence, number> = {
  confirmed: 2,
  expected: 1,
  probable: 0,
}

/** Entry fields needed for the balance aggregation. */
export type BalanceEntry = {
  date: number
  amountCents: number
  direction: 'in' | 'out'
  confidence: ForecastConfidence
  status: ForecastEntryStatus
  currency: string
}

export type MonthlyBalance = {
  monthKey: string
  inflowCents: number
  outflowCents: number
  netCents: number
  projectedBalanceCents: number
}

/** Midnight UTC of the 1st of `ms`'s month. */
function startOfMonthUtc(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/**
 * Aggregates forecast entries into a cumulative monthly projected balance.
 *
 * - Only `pending` entries, in EUR, with confidence ≥ `minConfidence` count
 *   (absent = everything). Non-EUR entries are counted apart (visibility),
 *   never aggregated.
 * - The grid covers every month of [windowStart, windowEnd], including
 *   those without flows (net 0), for a continuous trajectory.
 * - Each month's projected balance = starting balance + cumulative nets.
 */
export function buildMonthlyBalance(params: {
  entries: Array<BalanceEntry>
  startingBalanceCents: number
  windowStart: number
  windowEnd: number
  minConfidence?: ForecastConfidence
}): { months: Array<MonthlyBalance>; ignoredNonEurEntries: number } {
  const minRank = params.minConfidence
    ? CONFIDENCE_RANK[params.minConfidence]
    : 0

  // Month grid (key → flows), in chronological order.
  const buckets = new Map<
    string,
    { inflowCents: number; outflowCents: number }
  >()
  for (
    let cursor = startOfMonthUtc(params.windowStart);
    cursor <= params.windowEnd;
    cursor = addMonthsUtc(cursor, 1)
  ) {
    buckets.set(monthKey(cursor), { inflowCents: 0, outflowCents: 0 })
  }

  let ignoredNonEurEntries = 0
  for (const entry of params.entries) {
    if (entry.status !== 'pending') continue
    if (entry.currency !== 'EUR') {
      ignoredNonEurEntries += 1
      continue
    }
    if (CONFIDENCE_RANK[entry.confidence] < minRank) continue
    const bucket = buckets.get(monthKey(entry.date))
    if (!bucket) continue // out of window
    if (entry.direction === 'in') bucket.inflowCents += entry.amountCents
    else bucket.outflowCents += entry.amountCents
  }

  let runningCents = params.startingBalanceCents
  const months: Array<MonthlyBalance> = []
  for (const [key, bucket] of buckets) {
    const netCents = bucket.inflowCents - bucket.outflowCents
    runningCents += netCents
    months.push({
      monthKey: key,
      inflowCents: bucket.inflowCents,
      outflowCents: bucket.outflowCents,
      netCents,
      projectedBalanceCents: runningCents,
    })
  }

  return { months, ignoredNonEurEntries }
}

// ─── Monthly history of the actual balance ──────────────────────────────────

/** Actual transaction fields needed for the balance history. */
export type HistoryTx = {
  transactionDate: number
  amountCents: number
  direction: 'in' | 'out'
}

export type MonthlyHistoryPoint = {
  monthKey: string
  /** End-of-month balance (current month: balance at `now`). */
  balanceCents: number
}

/**
 * Rebuilds the end-of-month balance of the last `monthsBack` months
 * BACKWARDS from the current balance: balance(end of M) = current balance −
 * sum of the net flows after M. The last point is the current month at the
 * current balance — it serves as the junction with the projected curve.
 *
 * Transactions outside the window (before `monthsBack` months ago or after
 * `now`) are ignored. Chronological output, `monthsBack + 1` points.
 */
export function buildMonthlyHistory(params: {
  transactions: Array<HistoryTx>
  currentBalanceCents: number
  monthsBack: number
  now: number
}): Array<MonthlyHistoryPoint> {
  const currentMonthStart = startOfMonthUtc(params.now)

  // Net flow per month of the window (months without flows count as 0).
  const netByMonth = new Map<string, number>()
  for (let k = 0; k <= params.monthsBack; k++) {
    netByMonth.set(monthKey(addMonthsUtc(currentMonthStart, -k)), 0)
  }
  for (const tx of params.transactions) {
    if (tx.transactionDate > params.now) continue
    const key = monthKey(tx.transactionDate)
    const net = netByMonth.get(key)
    if (net === undefined) continue // out of window
    netByMonth.set(
      key,
      net + (tx.direction === 'in' ? tx.amountCents : -tx.amountCents),
    )
  }

  // Backwards: subtract each month's net to get the previous month's
  // end-of-month balance.
  const points: Array<MonthlyHistoryPoint> = []
  let balance = params.currentBalanceCents
  for (let k = 0; k <= params.monthsBack; k++) {
    const key = monthKey(addMonthsUtc(currentMonthStart, -k))
    points.push({ monthKey: key, balanceCents: balance })
    balance -= netByMonth.get(key) ?? 0
  }
  points.reverse()
  return points
}

// ─── Upsert decision for generated occurrences ──────────────────────────────

/** Minimal state of an existing entry to decide the upsert. */
export type ExistingEntryState = {
  overridden: boolean
  status: ForecastEntryStatus
}

/**
 * Upsert decision for an occurrence generated by expandRules:
 * - `create`: no entry for this derivedKey.
 * - `skip`: the existing entry is protected — hand-edited (`overridden`),
 *   already realized or cancelled. Regeneration NEVER touches it.
 * - `update`: pristine derived entry → resync from the rule.
 */
export function entryUpsertAction(
  existing: ExistingEntryState | null,
): 'create' | 'update' | 'skip' {
  if (!existing) return 'create'
  if (existing.overridden || existing.status !== 'pending') return 'skip'
  return 'update'
}

/**
 * Adds n months (UTC) to a timestamp, clamping the day of month
 * (Jan 31 + 1 month = Feb 28/29). Used to bound the projection horizon.
 */
export function addMonthsUtc(ms: number, months: number): number {
  const d = new Date(ms)
  const targetMonth = d.getUTCMonth() + months
  const day = Math.min(
    d.getUTCDate(),
    daysInMonth(d.getUTCFullYear(), targetMonth),
  )
  return Date.UTC(
    d.getUTCFullYear(),
    targetMonth,
    day,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

/** Midnight UTC of `anchorDay` (clamped to the last day) of month year/month. */
function monthAnchor(year: number, month: number, anchorDay: number): number {
  const day = Math.min(anchorDay, daysInMonth(year, month))
  return Date.UTC(year, month, day)
}

/**
 * Expands a rule's occurrences within the [from, to] window (inclusive
 * bounds). Occurrences fall at midnight UTC, never before `startDate` nor
 * after `endDate`. The sequence is anchored on `startDate` (a quarterly
 * started in March falls in March/June/Sept/Dec, whatever `from` is).
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  from: number,
  to: number,
): Array<number> {
  const interval = Math.max(1, Math.floor(rule.interval))
  const windowStart = Math.max(from, rule.startDate)
  const windowEnd = rule.endDate === undefined ? to : Math.min(to, rule.endDate)
  if (windowEnd < windowStart) return []

  const out: Array<number> = []

  if (rule.frequency === 'weekly') {
    const start = new Date(rule.startDate)
    const startMidnight = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    )
    // getUTCDay(): 0 = Sunday … 6 = Saturday → ISO: 1 = Monday … 7 = Sunday.
    const startIsoDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay()
    // First occurrence: first ISO `anchorDay` ≥ startDate.
    const offsetDays = (rule.anchorDay - startIsoDay + 7) % 7
    const stepMs = 7 * interval * DAY_MS
    for (
      let occ = startMidnight + offsetDays * DAY_MS;
      occ <= windowEnd;
      occ += stepMs
    ) {
      if (occ >= windowStart) out.push(occ)
    }
    return out
  }

  // monthly / quarterly / yearly: step expressed in months.
  const monthsPerStep =
    rule.frequency === 'monthly'
      ? interval
      : rule.frequency === 'quarterly'
        ? 3 * interval
        : 12 * interval

  const start = new Date(rule.startDate)
  const year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  // First occurrence ≥ startDate: the anchorDay of startDate's month,
  // otherwise the next step's.
  if (monthAnchor(year, month, rule.anchorDay) < rule.startDate) {
    month += monthsPerStep
  }
  for (
    let occ = monthAnchor(year, month, rule.anchorDay);
    occ <= windowEnd;
    month += monthsPerStep, occ = monthAnchor(year, month, rule.anchorDay)
  ) {
    if (occ >= windowStart) out.push(occ)
  }
  return out
}
