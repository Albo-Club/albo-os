/**
 * Pure real-estate logic (no Convex dependency, no Node import): the cost
 * basis of a property line item by line item, its operating result over the
 * trailing twelve months, its yield, its latent gain, and the dated flows of
 * a resold marchand de biens.
 *
 * Tested by tests/properties.test.ts (node:test, deliberately outside
 * convex/ to stay out of the deployment bundle — same reason as
 * lib/recurrence.ts, lib/amortization.ts and lib/guarantees.ts).
 *
 * NOTHING here is stored. A cost basis, an operating result, a yield and a
 * latent gain are all derived on every read, exactly like a loan's capital
 * outstanding and a current account's balance. A stored figure drifts out of
 * sync; a derived one cannot.
 */

export type CostPoste = 'acquisition' | 'frais_acquisition' | 'travaux'

export type CostSource = 'manual' | 'flows'

/** The six natures a flow on a property can carry (SPEC D42). */
export type FlowCategory =
  | CostPoste
  | 'charges'
  | 'loyer'
  | 'revente'

/** The three cost-basis line items, in display order. */
export const COST_POSTES: ReadonlyArray<CostPoste> = [
  'acquisition',
  'frais_acquisition',
  'travaux',
]

/** Twelve rolling months, the window the operating result is read over. */
export const TRAILING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000

/** A cost-basis line item as stored on the property. */
export type CostBasisEntry = {
  poste: CostPoste
  source: CostSource
  manualAmountCents?: number
}

/** A transaction allocated to the property, as read from `transactions`. */
export type PropertyFlow = {
  transactionDate: number
  direction: 'in' | 'out'
  /** Always positive, in cents (the schema convention). */
  amount: number
  category?: FlowCategory
}

/** One resolved line item: a single amount, and where it came from. */
export type ResolvedCostPoste = {
  poste: CostPoste
  source: CostSource
  amountCents: number
  /** Flows carrying this category — the « ● N flux » counter of the UI. */
  flowCount: number
  /**
   * Flows matched onto a line item left on `manual`. Their amount is NOT
   * counted (C14) — but they are surfaced, so the UI can say they exist
   * rather than hide data.
   */
  ignoredFlowCount: number
  ignoredFlowCents: number
}

/**
 * Sum of the flows of one category. A property's flows are tax-inclusive and
 * signed by direction: an outflow adds to a cost, an inflow (a refund, a
 * credit note) subtracts from it.
 */
function sumFlows(
  flows: ReadonlyArray<PropertyFlow>,
  category: FlowCategory,
): { cents: number; count: number } {
  let cents = 0
  let count = 0
  for (const flow of flows) {
    if (flow.category !== category) continue
    count += 1
    cents += flow.direction === 'out' ? flow.amount : -flow.amount
  }
  return { cents, count }
}

/**
 * Resolves the three cost-basis line items: for each, ONE amount from ONE
 * source (SPEC D43, C14).
 *
 * A line item absent from `costBasis` is treated as `manual` at zero — a
 * property that has only ever been entered has no reason to carry three
 * empty rows.
 *
 * ⚠️ The `manual` amount and the flows are NEVER added together. That
 * addition is a bug, not a feature: the whole point of the per-item switch
 * is that one of the two is the truth and the other is not.
 */
export function resolveCostBasis(
  costBasis: ReadonlyArray<CostBasisEntry>,
  flows: ReadonlyArray<PropertyFlow>,
): Array<ResolvedCostPoste> {
  return COST_POSTES.map((poste) => {
    const entry = costBasis.find((row) => row.poste === poste)
    const source: CostSource = entry?.source ?? 'manual'
    const fromFlows = sumFlows(flows, poste)
    if (source === 'flows') {
      return {
        poste,
        source,
        amountCents: fromFlows.cents,
        flowCount: fromFlows.count,
        ignoredFlowCount: 0,
        ignoredFlowCents: 0,
      }
    }
    return {
      poste,
      source,
      amountCents: Math.round(entry?.manualAmountCents ?? 0),
      flowCount: 0,
      // Flows exist but the entered amount stands. Say so rather than
      // silently swallow them.
      ignoredFlowCount: fromFlows.count,
      ignoredFlowCents: fromFlows.cents,
    }
  })
}

/** Cost price = the three line items, each taken at its own source. */
export function costBasisTotalCents(
  postes: ReadonlyArray<ResolvedCostPoste>,
): number {
  return postes.reduce((sum, poste) => sum + poste.amountCents, 0)
}

export type Operating = {
  /** Rents received over the window (`in`, category `loyer`). */
  revenueCents: number
  /** Charges paid over the window (`out`, category `charges`). */
  chargesCents: number
  /** Revenue − charges. */
  netCents: number
  /** Number of flows behind the two figures — nothing is theoretical. */
  flowCount: number
  /** Start of the window, so the UI can name the period it read. */
  fromDate: number
  toDate: number
}

/**
 * Operating result over the trailing twelve months, from MATCHED flows only
 * (SPEC D25). A property with no matched flow reads zero, not an estimate.
 *
 * Loan instalments are never charges of the property: they are allocated to
 * the loan, not to the property, so they cannot reach this function.
 */
export function operatingResult(
  flows: ReadonlyArray<PropertyFlow>,
  now: number,
  windowMs: number = TRAILING_WINDOW_MS,
): Operating {
  const fromDate = now - windowMs
  let revenueCents = 0
  let chargesCents = 0
  let flowCount = 0
  for (const flow of flows) {
    if (flow.transactionDate < fromDate || flow.transactionDate > now) continue
    if (flow.category === 'loyer') {
      // A rent is an inflow; a refunded rent goes back out of the total.
      revenueCents += flow.direction === 'in' ? flow.amount : -flow.amount
      flowCount += 1
    } else if (flow.category === 'charges') {
      chargesCents += flow.direction === 'out' ? flow.amount : -flow.amount
      flowCount += 1
    }
  }
  return {
    revenueCents,
    chargesCents,
    netCents: revenueCents - chargesCents,
    flowCount,
    fromDate,
    toDate: now,
  }
}

/**
 * Net yield = operating result / cost price. `null` when the cost price is
 * zero or negative — a yield on nothing is not a small number, it is no
 * number at all.
 */
export function netYield(
  netCents: number,
  costBasisCents: number,
): number | null {
  if (costBasisCents <= 0) return null
  return netCents / costBasisCents
}

/**
 * Latent gain = last known valuation − cost price. `null` when the property
 * has never been valued: an unvalued property has no gain of zero, it has an
 * unknown one.
 */
export function latentGainCents(
  currentValueCents: number | null,
  costBasisCents: number,
): number | null {
  if (currentValueCents === null) return null
  return currentValueCents - costBasisCents
}

/**
 * Dated signed flows of a property, for the exit IRR of a resold marchand de
 * biens. Feed the result to `xirr()` — there is ONE XIRR implementation in
 * the repo (convex/lib/xirr.ts), shared with the deals.
 *
 * Sign convention of `xirr`: money out is negative, money in is positive.
 * So costs are negative and rents, resale and the sale price are positive.
 *
 * Line items left on `manual` are injected at `acquiredDate` — their flow
 * never existed in the app (C13: a bank connection does not reach back to
 * 2019), and leaving them out would overstate the return. A line item on
 * `flows` contributes through its transactions, never twice.
 */
export function exitCashflows(
  postes: ReadonlyArray<ResolvedCostPoste>,
  flows: ReadonlyArray<PropertyFlow>,
  property: {
    acquiredDate?: number
    saleDate?: number
    salePriceCents?: number
  },
): Array<{ date: number; amount: number }> {
  const out: Array<{ date: number; amount: number }> = []

  for (const poste of postes) {
    if (poste.source !== 'manual') continue
    if (poste.amountCents === 0) continue
    if (property.acquiredDate == null) continue
    out.push({ date: property.acquiredDate, amount: -poste.amountCents })
  }

  for (const flow of flows) {
    // `revente` is carried by `salePriceCents` below when it is entered;
    // counting both would book the sale twice.
    if (flow.category === undefined) continue
    if (flow.category === 'revente' && property.salePriceCents != null) continue
    const signed = flow.direction === 'in' ? flow.amount : -flow.amount
    // A line item on `manual` ignores its flows for the cost basis (C14);
    // the IRR follows the same reading, or the two would disagree.
    if (
      flow.category === 'acquisition' ||
      flow.category === 'frais_acquisition' ||
      flow.category === 'travaux'
    ) {
      const poste = postes.find((row) => row.poste === flow.category)
      if (poste?.source !== 'flows') continue
    }
    out.push({ date: flow.transactionDate, amount: signed })
  }

  if (property.salePriceCents != null && property.saleDate != null) {
    out.push({ date: property.saleDate, amount: property.salePriceCents })
  }

  return out.sort((a, b) => a.date - b.date)
}
