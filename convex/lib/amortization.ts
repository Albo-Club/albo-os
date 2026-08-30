/**
 * Pure amortization engine for bank loans (no Convex dependency, no Node
 * import): given a loan's terms and its dated rate series, it returns the
 * whole schedule. Everything is computed in UTC on ms epochs, in integer
 * cents, per the schema conventions.
 *
 * Tested by tests/amortization.test.ts (node:test, deliberately outside
 * convex/ to stay out of the deployment bundle — same reason as
 * lib/recurrence.ts, whose UTC date-math this module reuses).
 *
 * NOTHING here is stored. The capital outstanding of a loan is derived from
 * this schedule on every read; the single exception in the module is the
 * outstanding of a revolving credit, which no schedule can deduce.
 */

import { addMonthsUtc } from './recurrence'

// ─── Terms ──────────────────────────────────────────────────────────────────

export type AmortizationKind =
  | 'constant_annuity'
  | 'constant_capital'
  | 'bullet'
  | 'revolving'

/** `partial` = interest is paid during the deferral; `total` = it capitalizes. */
export type DeferralKind = 'partial' | 'total'

export type PaymentFrequency = 'monthly' | 'quarterly'

export type RateKind = 'fixed' | 'variable'

/** One step of the dated rate series (`loanRates`). */
export type RateStep = {
  /** Effective date, ms epoch UTC. */
  fromDate: number
  rateBps: number
  /** `actual` = a revision that happened; `forecast` = a steering assumption. */
  kind: 'actual' | 'forecast'
}

export type LoanTerms = {
  principalCents: number
  /** Date of the first instalment, ms epoch UTC — anchors the whole series. */
  firstPaymentDate: number
  /**
   * TOTAL duration in months, deferral included. Absent for a revolving,
   * required by every other kind.
   */
  durationMonths?: number
  amortizationKind: AmortizationKind
  /** Rate at signature — the fallback when no rate step covers a date. */
  rateBps: number
  rateKind: RateKind
  paymentFrequency: PaymentFrequency
  /** Months of deferred amortization at the head of the schedule. */
  deferralMonths?: number
  deferralKind?: DeferralKind
  /** Borrower insurance, cents per MONTH — outside the instalment (§ 5.1). */
  insuranceMonthlyCents?: number
  /** Revolving only: bound of the interest projection when known. */
  endDate?: number
}

export type ScheduleOptions = {
  /**
   * Upper bound of a revolving projection when the loan has no `endDate`.
   * Required to keep an open-ended credit from generating forever.
   */
  horizonDate?: number
}

// ─── Schedule ───────────────────────────────────────────────────────────────

export type ScheduleRow = {
  /** 1-based position in the schedule. */
  index: number
  /** Instalment date, midnight UTC. */
  date: number
  /** Rate applied to THIS period (a variable loan changes step to step). */
  rateBps: number
  /** Capital + interest actually paid. Excludes insurance (§ 5.1). */
  paymentCents: number
  capitalCents: number
  /** Interest of the period — accrued but unpaid when `capitalized`. */
  interestCents: number
  /** Insurance due alongside the instalment, 0 when the loan has none. */
  insuranceCents: number
  /** Capital outstanding AFTER this instalment. */
  remainingCents: number
  /** In fine: the last row, which carries the whole principal. */
  isBalloon: boolean
  /** Inside the deferral window. */
  isDeferred: boolean
  /** Total deferral: nothing paid, the interest joined the capital. */
  capitalized: boolean
  /** Beyond the last `actual` revision — the app does not know this rate. */
  projected: boolean
}

const BPS_PER_UNIT = 10_000

/** Hard stop so a bad duration cannot generate an unbounded array. */
const MAX_PERIODS = 1200

/** Months covered by one instalment. */
export function monthsPerPeriod(frequency: PaymentFrequency): number {
  return frequency === 'quarterly' ? 3 : 1
}

/**
 * Rate applied to a date: the last step whose `fromDate <= date`, falling
 * back to the signature rate. A fixed-rate loan has no step at all — nothing
 * to enter, nothing to maintain (§ 4.1 bis).
 *
 * `steps` need not be sorted.
 */
export function applicableRateBps(
  steps: ReadonlyArray<RateStep>,
  date: number,
  fallbackBps: number,
): number {
  let best: RateStep | null = null
  for (const step of steps) {
    if (step.fromDate > date) continue
    if (!best || step.fromDate > best.fromDate) best = step
  }
  return best ? best.rateBps : fallbackBps
}

/**
 * Periodic rate for `months` of coverage, e.g. 1100 bps monthly → 0.009166…
 *
 * One division rather than two: `(bps / 10000) * (months / 12)` returns
 * 0.009999999999999998 for a 12 % monthly rate, and that artefact then
 * travels through every instalment of a twenty-year schedule.
 */
export function periodicRate(rateBps: number, months: number): number {
  return (rateBps * months) / (BPS_PER_UNIT * 12)
}

/**
 * Constant instalment repaying `capital` over `periods` at periodic rate `i`.
 * `i === 0` degrades to a straight division (a zero-rate loan is legal, and
 * the closed form divides by zero there).
 */
export function annuityCents(
  capital: number,
  i: number,
  periods: number,
): number {
  if (periods <= 0) return 0
  if (i <= 0) return Math.round(capital / periods)
  return Math.round((capital * i) / (1 - Math.pow(1 + i, -periods)))
}

/**
 * Date of instalment `k` (0-based), always recomputed from the anchor so the
 * day of month never drifts: a 31st anchor gives 28 Feb then 31 Mar, not 28
 * Mar (which is what stepping month by month would produce).
 */
function instalmentDate(
  firstPaymentDate: number,
  k: number,
  stepMonths: number,
): number {
  return addMonthsUtc(firstPaymentDate, k * stepMonths)
}

/**
 * Date beyond which the rates are unknown: the last `actual` revision.
 * `+Infinity` when the series holds no revision at all — the signature rate
 * then stands until further notice, and only `forecast` steps project.
 */
function lastActualFrom(steps: ReadonlyArray<RateStep>): number {
  let last = Number.NEGATIVE_INFINITY
  for (const step of steps) {
    if (step.kind === 'actual' && step.fromDate > last) last = step.fromDate
  }
  return last === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : last
}

/** Whether the rate applied at `date` comes from a `forecast` step. */
function appliedStepIsForecast(
  steps: ReadonlyArray<RateStep>,
  date: number,
): boolean {
  let best: RateStep | null = null
  for (const step of steps) {
    if (step.fromDate > date) continue
    if (!best || step.fromDate > best.fromDate) best = step
  }
  return best?.kind === 'forecast'
}

/**
 * Builds the full schedule of a loan.
 *
 * Rounding: every row is rounded to the cent and the LAST instalment absorbs
 * the accumulated drift (its capital is whatever remains), which is what a
 * bank's own table does — that is how the outstanding stays within a euro of
 * the lender's.
 *
 * Returns `[]` when the terms cannot produce a schedule (a non-revolving
 * loan without `durationMonths`, a revolving with no bound). Callers
 * validate at the mutation; a query must never throw on stored data.
 */
export function buildSchedule(
  loan: LoanTerms,
  rates: ReadonlyArray<RateStep> = [],
  opts: ScheduleOptions = {},
): Array<ScheduleRow> {
  const stepMonths = monthsPerPeriod(loan.paymentFrequency)
  const insurance = Math.max(
    0,
    Math.round((loan.insuranceMonthlyCents ?? 0) * stepMonths),
  )
  const isVariable = loan.rateKind === 'variable'
  const actualUntil = lastActualFrom(rates)

  const decorate = (
    row: Omit<ScheduleRow, 'projected' | 'insuranceCents'>,
  ): ScheduleRow => ({
    ...row,
    insuranceCents: insurance,
    projected:
      isVariable &&
      (row.date > actualUntil || appliedStepIsForecast(rates, row.date)),
  })

  if (loan.amortizationKind === 'revolving') {
    return buildRevolving(loan, rates, opts, stepMonths, decorate)
  }

  if (!loan.durationMonths || loan.durationMonths <= 0) return []

  const totalPeriods = Math.min(
    MAX_PERIODS,
    Math.max(1, Math.round(loan.durationMonths / stepMonths)),
  )
  const deferralPeriods = Math.min(
    totalPeriods - (loan.amortizationKind === 'bullet' ? 0 : 1),
    Math.max(0, Math.round((loan.deferralMonths ?? 0) / stepMonths)),
  )
  const deferralKind: DeferralKind = loan.deferralKind ?? 'partial'

  const rows: Array<ScheduleRow> = []
  let remaining = Math.max(0, Math.round(loan.principalCents))

  // ── Deferral ──────────────────────────────────────────────────────────────
  // `partial`: interest only, the capital stays at P.
  // `total`: nothing is paid, the interest joins the capital — amortization
  //   then starts ABOVE the amount borrowed (C18).
  for (let k = 0; k < deferralPeriods; k++) {
    const date = instalmentDate(loan.firstPaymentDate, k, stepMonths)
    const rateBps = applicableRateBps(rates, date, loan.rateBps)
    const interest = Math.round(remaining * periodicRate(rateBps, stepMonths))
    const capitalizing = deferralKind === 'total'
    if (capitalizing) remaining += interest
    rows.push(
      decorate({
        index: k + 1,
        date,
        rateBps,
        paymentCents: capitalizing ? 0 : interest,
        capitalCents: 0,
        interestCents: interest,
        remainingCents: remaining,
        isBalloon: false,
        isDeferred: true,
        capitalized: capitalizing,
      }),
    )
  }

  // ── Amortization ─────────────────────────────────────────────────────────
  const amortPeriods = totalPeriods - deferralPeriods
  if (amortPeriods <= 0) return rows

  // Constant capital: the fixed slice is computed on the capital entering the
  // amortization phase (grown by a total deferral, if any).
  const capitalSlice =
    loan.amortizationKind === 'constant_capital'
      ? Math.round(remaining / amortPeriods)
      : 0

  // Constant annuity: the instalment is recomputed whenever the applicable
  // rate moves — that is exactly what a variable-rate loan does in real life.
  let annuity = 0
  let annuityRateBps: number | null = null

  for (let k = 0; k < amortPeriods; k++) {
    const index = deferralPeriods + k
    const date = instalmentDate(loan.firstPaymentDate, index, stepMonths)
    const rateBps = applicableRateBps(rates, date, loan.rateBps)
    const i = periodicRate(rateBps, stepMonths)
    const interest = Math.round(remaining * i)
    const isLast = k === amortPeriods - 1

    let capital: number
    if (loan.amortizationKind === 'bullet') {
      capital = isLast ? remaining : 0
    } else if (loan.amortizationKind === 'constant_capital') {
      capital = isLast ? remaining : Math.min(capitalSlice, remaining)
    } else {
      if (annuityRateBps !== rateBps) {
        annuity = annuityCents(remaining, i, amortPeriods - k)
        annuityRateBps = rateBps
      }
      capital = isLast ? remaining : Math.min(annuity - interest, remaining)
      // A rate spike can push the interest above the instalment; never
      // amortize backwards — the schedule would grow a phantom capital.
      if (capital < 0) capital = 0
    }

    remaining -= capital
    rows.push(
      decorate({
        index: index + 1,
        date,
        rateBps,
        paymentCents: capital + interest,
        capitalCents: capital,
        interestCents: interest,
        remainingCents: remaining,
        isBalloon: loan.amortizationKind === 'bullet' && isLast,
        isDeferred: false,
        capitalized: false,
      }),
    )
  }

  return rows
}

/**
 * Revolving (lombard): no schedule of capital, only interest on the
 * outstanding, projected up to `endDate` or the caller's horizon. The
 * outstanding is the stored `principalCents` — the module's one assumed
 * exception to "nothing derivable is stored" (§ 4.1).
 */
function buildRevolving(
  loan: LoanTerms,
  rates: ReadonlyArray<RateStep>,
  opts: ScheduleOptions,
  stepMonths: number,
  decorate: (row: Omit<ScheduleRow, 'projected' | 'insuranceCents'>) => ScheduleRow,
): Array<ScheduleRow> {
  const bound = loan.endDate ?? opts.horizonDate
  if (bound === undefined) return []

  const outstanding = Math.max(0, Math.round(loan.principalCents))
  const rows: Array<ScheduleRow> = []
  for (let k = 0; k < MAX_PERIODS; k++) {
    const date = instalmentDate(loan.firstPaymentDate, k, stepMonths)
    if (date > bound) break
    const rateBps = applicableRateBps(rates, date, loan.rateBps)
    const interest = Math.round(
      outstanding * periodicRate(rateBps, stepMonths),
    )
    rows.push(
      decorate({
        index: k + 1,
        date,
        rateBps,
        paymentCents: interest,
        capitalCents: 0,
        interestCents: interest,
        remainingCents: outstanding,
        isBalloon: false,
        isDeferred: false,
        capitalized: false,
      }),
    )
  }
  return rows
}

// ─── Reading the schedule ───────────────────────────────────────────────────

/**
 * Capital outstanding at `date`: what remains once every instalment up to and
 * including that date has been paid. Before the first one, the principal
 * itself. A revolving always answers its stored outstanding.
 */
export function outstandingAt(
  loan: Pick<LoanTerms, 'principalCents' | 'amortizationKind'>,
  schedule: ReadonlyArray<ScheduleRow>,
  date: number,
): number {
  if (loan.amortizationKind === 'revolving') {
    return Math.max(0, Math.round(loan.principalCents))
  }
  let outstanding = Math.max(0, Math.round(loan.principalCents))
  for (const row of schedule) {
    if (row.date > date) break
    outstanding = row.remainingCents
  }
  return outstanding
}

/** An actual outflow matched to the loan, as read from `transactions`. */
export type ActualPayment = {
  transactionDate: number
  amountCents: number
}

/**
 * Attributes each actual payment to the instalment whose PERIOD contains its
 * date, and returns the total per instalment (`null` = nothing landed there).
 *
 * ⚠️ This is a CALENDAR attribution, not a match. It answers « what went out
 * of the bank between this instalment and the next », which is deterministic
 * and explainable from the dates alone. It is NOT a likelihood ranking, it
 * proposes nothing and pre-selects nothing: the human decides which
 * transaction belongs to the loan, in the matching queue, and this only
 * places the consequence on the right line (repo rule, cf. CLAUDE.md).
 *
 * A payment made before the first instalment is attributed to the first; one
 * made after the last, to the last. So a late payment shows up on the period
 * it actually landed in — which is the honest reading, and the one that makes
 * a missed instalment visible rather than papering over it.
 */
export function attributeActuals(
  schedule: ReadonlyArray<ScheduleRow>,
  payments: ReadonlyArray<ActualPayment>,
): Array<number | null> {
  const totals = new Array<number | null>(schedule.length).fill(null)
  if (schedule.length === 0) return totals

  for (const payment of payments) {
    // Last instalment whose date is <= the payment; the first one when the
    // payment predates the whole schedule.
    let index = 0
    for (let k = 0; k < schedule.length; k++) {
      if (schedule[k].date <= payment.transactionDate) index = k
      else break
    }
    totals[index] = (totals[index] ?? 0) + payment.amountCents
  }
  return totals
}

export type ScheduleSummary = {
  /** Capital outstanding today. */
  outstandingCents: number
  /** Instalment of the period covering `at` — the plan, insurance excluded. */
  currentPaymentCents: number
  /** Rate applied at `at`. */
  currentRateBps: number
  /** Date of the last instalment, null for a revolving without a bound. */
  lastPaymentDate: number | null
  /** Interest still to be paid after `at`. */
  remainingInterestCents: number
  /** Instalments already due at `at`. */
  elapsedPeriods: number
  totalPeriods: number
}

/** Headline figures of a loan sheet, all derived from the schedule. */
export function summarize(
  loan: Pick<
    LoanTerms,
    'principalCents' | 'amortizationKind' | 'rateBps'
  >,
  schedule: ReadonlyArray<ScheduleRow>,
  at: number,
): ScheduleSummary {
  const outstandingCents = outstandingAt(loan, schedule, at)
  let elapsedPeriods = 0
  let remainingInterestCents = 0
  let currentPaymentCents = 0
  let currentRateBps = loan.rateBps
  for (const row of schedule) {
    if (row.date <= at) {
      elapsedPeriods += 1
      currentRateBps = row.rateBps
    } else {
      remainingInterestCents += row.interestCents
      if (currentPaymentCents === 0) {
        currentPaymentCents = row.paymentCents
        currentRateBps = row.rateBps
      }
    }
  }
  // Fully repaid schedule: the last instalment is the meaningful one.
  if (currentPaymentCents === 0 && schedule.length > 0) {
    currentPaymentCents = schedule[schedule.length - 1].paymentCents
  }
  return {
    outstandingCents,
    currentPaymentCents,
    currentRateBps,
    lastPaymentDate:
      schedule.length > 0 ? schedule[schedule.length - 1].date : null,
    remainingInterestCents,
    elapsedPeriods,
    totalPeriods: schedule.length,
  }
}
