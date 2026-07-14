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

// ─── Forecast entry shape ────────────────────────────────────────────────────

export type ForecastConfidence = 'confirmed' | 'expected' | 'probable'

export type ForecastEntryStatus = 'pending' | 'realized' | 'cancelled'

/** Entry fields needed for the monthly aggregations. */
export type BalanceEntry = {
  date: number
  amountCents: number
  direction: 'in' | 'out'
  confidence: ForecastConfidence
  status: ForecastEntryStatus
  currency: string
}

/** Midnight UTC of the 1st of `ms`'s month. */
function startOfMonthUtc(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
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

// ─── Forecast grid (category × month, realized/committed/planned) ───────────

/** Realized flow already resolved to its analysis bucket (effectiveCategory). */
export type GridTx = {
  transactionDate: number
  amountCents: number
  direction: 'in' | 'out'
  /** Analysis bucket — null = excluded (ignored / internal transfer). */
  category: string | null
}

/** Pending forecast entry fields needed for the grid. */
export type GridEntry = BalanceEntry & { category?: string | null }

export type ForecastGridCell = {
  realizedCents: number
  /** Confirmed pending flows (current month: AFTER consumption). */
  committedCents: number
  /** Expected/probable pending flows (current month: AFTER consumption). */
  plannedCents: number
}

export type ForecastGridRow = {
  direction: 'in' | 'out'
  category: string
  /** Sparse: a month with no flow has no key. */
  byMonth: Record<string, ForecastGridCell | undefined>
  totals: ForecastGridCell
}

export type ForecastProjectionPoint = {
  monthKey: string
  /** Starting balance + cumulated confirmed nets only. */
  committedBalanceCents: number
  /** Starting balance + cumulated confirmed AND expected/probable nets. */
  plannedBalanceCents: number
}

function emptyCell(): ForecastGridCell {
  return { realizedCents: 0, committedCents: 0, plannedCents: 0 }
}

/**
 * Builds the category × month forecast grid and the consumption-aware
 * projected balance, merging the realized and pending layers:
 *
 * - Past months ([now − historyMonths, current month[): realized only.
 * - Current month: realized so far + the REMAINDER of the pending flows,
 *   consumed per (direction, category) cell — the Float "largest value"
 *   pattern: an expected flow that already happened must not count twice on
 *   top of the (already moved) bank balance. Confirmed flows are consumed
 *   first, then expected/probable with the leftover.
 * - OVERDUE pending entries (dated before the current month) roll INTO the
 *   current month: they are still expected, just late — dropping them would
 *   silently improve/worsen the trajectory.
 * - Future months (]current, now + horizonMonths]): pending flows as-is,
 *   split confirmed (committed) vs expected/probable (planned).
 *
 * Only `pending` EUR entries count (`ignoredNonEurEntries` for visibility).
 * The projection = startingBalance + cumulated nets from the current month
 * on, in two scenarios (committed-only / committed + planned).
 */
export function buildForecastGrid(params: {
  realized: Array<GridTx>
  entries: Array<GridEntry>
  startingBalanceCents: number
  now: number
  historyMonths: number
  horizonMonths: number
}): {
  months: Array<string>
  currentMonthKey: string
  rows: Array<ForecastGridRow>
  projection: Array<ForecastProjectionPoint>
  ignoredNonEurEntries: number
} {
  const currentMonthStart = startOfMonthUtc(params.now)
  const currentKey = monthKey(currentMonthStart)
  const horizonEnd = addMonthsUtc(params.now, params.horizonMonths)

  // Month axis: history … current … horizon.
  const months: Array<string> = []
  for (let k = params.historyMonths; k >= 1; k--) {
    months.push(monthKey(addMonthsUtc(currentMonthStart, -k)))
  }
  for (
    let cursor = currentMonthStart;
    cursor <= horizonEnd;
    cursor = addMonthsUtc(cursor, 1)
  ) {
    months.push(monthKey(cursor))
  }
  const monthSet = new Set(months)

  const rows = new Map<string, ForecastGridRow>()
  function cellOf(
    direction: 'in' | 'out',
    category: string,
    key: string,
  ): ForecastGridCell {
    const rowKey = `${direction}:${category}`
    let row = rows.get(rowKey)
    if (!row) {
      row = { direction, category, byMonth: {}, totals: emptyCell() }
      rows.set(rowKey, row)
    }
    let cell = row.byMonth[key]
    if (!cell) {
      cell = emptyCell()
      row.byMonth[key] = cell
    }
    return cell
  }

  // 1. Realized flows (history + current month-to-date).
  for (const tx of params.realized) {
    if (tx.category === null) continue
    if (tx.transactionDate > params.now) continue
    const key = monthKey(tx.transactionDate)
    if (!monthSet.has(key)) continue
    cellOf(tx.direction, tx.category, key).realizedCents += tx.amountCents
  }

  // 2. Pending entries — overdue ones roll into the current month.
  let ignoredNonEurEntries = 0
  for (const entry of params.entries) {
    if (entry.status !== 'pending') continue
    if (entry.currency !== 'EUR') {
      ignoredNonEurEntries += 1
      continue
    }
    if (entry.date > horizonEnd) continue
    const key =
      entry.date < currentMonthStart ? currentKey : monthKey(entry.date)
    const cell = cellOf(entry.direction, entry.category ?? 'uncategorized', key)
    if (entry.confidence === 'confirmed') cell.committedCents += entry.amountCents
    else cell.plannedCents += entry.amountCents
  }

  // 3. Current-month consumption, per cell: confirmed first, then planned
  // with the realized leftover.
  for (const row of rows.values()) {
    const cell = row.byMonth[currentKey]
    if (!cell) continue
    const remainingCommitted = Math.max(
      0,
      cell.committedCents - cell.realizedCents,
    )
    const leftover = Math.max(0, cell.realizedCents - cell.committedCents)
    cell.committedCents = remainingCommitted
    cell.plannedCents = Math.max(0, cell.plannedCents - leftover)
  }

  // 4. Row totals.
  for (const row of rows.values()) {
    for (const cell of Object.values(row.byMonth)) {
      if (!cell) continue
      row.totals.realizedCents += cell.realizedCents
      row.totals.committedCents += cell.committedCents
      row.totals.plannedCents += cell.plannedCents
    }
  }

  // 5. Projection from the current month on: the bank balance already holds
  // the realized flows, so only the REMAINING pending nets accumulate.
  const projection: Array<ForecastProjectionPoint> = []
  let committedRunning = params.startingBalanceCents
  let plannedRunning = params.startingBalanceCents
  for (const key of months) {
    if (key < currentKey) continue
    let committedNet = 0
    let plannedNet = 0
    for (const row of rows.values()) {
      const cell = row.byMonth[key]
      if (!cell) continue
      const sign = row.direction === 'in' ? 1 : -1
      committedNet += sign * cell.committedCents
      plannedNet += sign * (cell.committedCents + cell.plannedCents)
    }
    committedRunning += committedNet
    plannedRunning += plannedNet
    projection.push({
      monthKey: key,
      committedBalanceCents: committedRunning,
      plannedBalanceCents: plannedRunning,
    })
  }

  // Stable order: biggest rows first (all layers included).
  const sortedRows = [...rows.values()].sort(
    (a, b) =>
      b.totals.realizedCents +
      b.totals.committedCents +
      b.totals.plannedCents -
      (a.totals.realizedCents + a.totals.committedCents + a.totals.plannedCents),
  )

  return {
    months,
    currentMonthKey: currentKey,
    rows: sortedRows,
    projection,
    ignoredNonEurEntries,
  }
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
