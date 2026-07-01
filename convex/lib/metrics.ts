/**
 * Portfolio metrics — the single source of truth for every performance ratio
 * shown across the app (MOIC, TVPI, DPI, annualized TRI, residual value / NAV).
 *
 * Pure module: no Convex `ctx`, no React. Importable both from `convex/*` and
 * from the front via a relative path (same pattern as `convex/lib/instruments`).
 * These formulas used to be copy-pasted across ~7 screens; centralizing them
 * here removes the risk of the numbers diverging between views.
 *
 * Conventions (locked here, formatting happens only at display time):
 *   - Amounts are integers in EUR cents.
 *   - Rates are basis points.
 *   - `capital` = Σ outgoing transactions, NEVER de-VAT'd.
 *   - `proceeds` (for the MOIC) = Σ incoming transactions, de-VAT'd ÷1.2 ONLY
 *     for `royalty` instruments (their incoming cash is stored TTC); gross for
 *     every other instrument.
 */

/** Milliseconds in a year — the single annualization basis (actual/365). */
export const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

/** Minimal cash-flow shape: a matched transaction with its direction. */
export type CashflowTx = { direction: 'in' | 'out'; amount: number }

/**
 * Split a deal's transactions into deployed capital and realized proceeds.
 * `capital` = Σ outgoing (never de-VAT'd). `proceeds` = Σ incoming, de-VAT'd
 * ÷1.2 only for `royalty` deals (gross otherwise).
 */
export function sumCashflows(
  txs: ReadonlyArray<CashflowTx>,
  instrumentKind: string,
): { capital: number; proceeds: number } {
  const deVat = instrumentKind === 'royalty'
  let capital = 0
  let proceeds = 0
  for (const tx of txs) {
    if (tx.direction === 'out') capital += tx.amount
    else proceeds += deVat ? tx.amount / 1.2 : tx.amount
  }
  return { capital, proceeds }
}

/**
 * De-VAT an already-aggregated incoming total (`received`) the same way
 * `sumCashflows` de-VATs per transaction: ÷1.2 only for `royalty`, gross
 * otherwise. Since division is linear, `Σ(tx/1.2) === (Σtx)/1.2`, so callers
 * that only hold the aggregate `received` get the exact same proceeds.
 */
export function proceedsFromReceived(
  receivedCents: number,
  instrumentKind: string,
): number {
  return instrumentKind === 'royalty' ? receivedCents / 1.2 : receivedCents
}

/**
 * Residual value of a deal for the TVPI / NAV: 0 once exited or written off,
 * otherwise the last known valuation, falling back to cost (amount paid).
 */
export function residualValueCents(args: {
  status: string
  lastValuationCents: number | null | undefined
  paidActual: number | null | undefined
}): number {
  if (args.status === 'fully_exited' || args.status === 'written_off') return 0
  return args.lastValuationCents ?? args.paidActual ?? 0
}

/**
 * Realized MOIC = proceeds / capital, or null when no capital was deployed
 * (the ratio is undefined). `proceeds` here is the de-VAT'd realized cash.
 */
export function moic(args: {
  capital: number
  proceeds: number
}): number | null {
  if (args.capital <= 0) return null
  return args.proceeds / args.capital
}

/**
 * TVPI = (received + residual) / capital, or null when capital <= 0.
 *
 * ⚠️ Here `proceeds` is the GROSS received amount (NOT de-VAT'd), unlike the
 * `proceeds` fed to `moic`. This preserves the historical TVPI formula
 * `(received + residual) / paid` exactly.
 */
export function tvpi(args: {
  capital: number
  proceeds: number
  residual: number
}): number | null {
  if (args.capital <= 0) return null
  return (args.proceeds + args.residual) / args.capital
}

/** DPI = distributed / called, or null when nothing was called. */
export function dpi(args: {
  called: number
  distributed: number
}): number | null {
  if (args.called <= 0) return null
  return args.distributed / args.called
}

/**
 * Annualized TRI from a two-point MOIC: MOIC^(1/years) − 1, with
 * years = (exitDate − entryDate) / MS_PER_YEAR. Null when the MOIC is unknown,
 * either date is missing, or the holding period isn't positive. A total loss
 * (MOIC = 0) yields −100 %.
 */
export function annualizedTri(args: {
  moic: number | null
  entryDate: number | null | undefined
  exitDate: number | null | undefined
}): number | null {
  if (args.moic == null) return null
  if (args.entryDate == null || args.exitDate == null) return null
  const years = (args.exitDate - args.entryDate) / MS_PER_YEAR
  if (years <= 0) return null
  return Math.pow(args.moic, 1 / years) - 1
}
