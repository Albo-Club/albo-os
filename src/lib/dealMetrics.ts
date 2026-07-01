/**
 * Deal-level realized metrics, computed from the actual cash flows attached to
 * a deal (never from stored reporting fields like `exitProceeds`).
 *
 * MOIC (multiple on invested capital) = realized proceeds / deployed capital,
 * both transaction-true:
 *   - proceeds  = Σ incoming transactions. De-VAT'd ÷1.2 ONLY for `royalty`
 *     deals (their incoming cash is stored TTC); gross for every other
 *     instrument.
 *   - capital   = Σ outgoing transactions (the cash actually deployed). Never
 *     de-VAT'd, whatever the instrument.
 *
 * Royalties keep their own CoC (built on the `capitalInvested` scalar) in
 * RoyaltiesPanel — this is a separate, deal-generic measure and is not meant to
 * match it.
 */

import { moic as moicRatio, sumCashflows } from '../../convex/lib/metrics'
import type { Doc } from '../../convex/_generated/dataModel'

/** Minimal cash-flow shape needed for the MOIC (subset of listByDeal rows). */
export type MoicTransaction = {
  direction: 'in' | 'out'
  amount: number
}

export type DealMoic = {
  /** Proceeds / capital, or null when no capital was deployed (Σ out = 0). */
  moic: number | null
  /** moic >= 1, or null when the MOIC can't be computed. */
  isWin: boolean | null
}

/**
 * Realized MOIC of a deal from its transactions. Returns `{ moic: null,
 * isWin: null }` when no outgoing cash was deployed (the ratio is undefined).
 */
export function dealMoic(
  deal: Doc<'deals'>,
  transactions: Array<MoicTransaction> | undefined,
): DealMoic {
  const { capital, proceeds } = sumCashflows(
    transactions ?? [],
    deal.instrumentKind,
  )
  const moic = moicRatio({ capital, proceeds })
  return { moic, isWin: moic == null ? null : moic >= 1 }
}
