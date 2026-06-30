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
  const txs = transactions ?? []
  const capital = txs.reduce(
    (sum, tx) => (tx.direction === 'out' ? sum + tx.amount : sum),
    0,
  )
  if (capital <= 0) return { moic: null, isWin: null }

  const deVat = deal.instrumentKind === 'royalty'
  const proceeds = txs.reduce(
    (sum, tx) =>
      tx.direction === 'in' ? sum + (deVat ? tx.amount / 1.2 : tx.amount) : sum,
    0,
  )

  const moic = proceeds / capital
  return { moic, isWin: moic >= 1 }
}
