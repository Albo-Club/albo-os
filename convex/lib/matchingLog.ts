import type { GenericMutationCtx } from 'convex/server'

import type { DataModel, Doc, Id } from '../_generated/dataModel'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Writes a row to `matchingDecisions` (append-only) — the learning dataset
 * of the matching agent (phase 2). Called by the pointage mutations in
 * convex/transactions.ts, never exposed as an API.
 *
 * The snapshot (label, amount, date, account) is read from the `transaction`
 * object already loaded by the caller, frozen at decision time. Deltas are
 * only computed when the deal carries a trivially readable
 * `committedAmount` / `signedDate`.
 */
export async function recordDecision(
  ctx: MutCtx,
  {
    transaction,
    decision,
    dealId,
    source,
    decidedBy,
  }: {
    transaction: Doc<'transactions'>
    decision:
      | 'matched'
      | 'ignored'
      | 'unmatched'
      | 'charge'
      | 'tax'
      | 'product'
      | 'internal_transfer'
    dealId?: Id<'deals'>
    source: 'manual' | 'agent_suggested'
    decidedBy: Id<'users'>
  },
): Promise<void> {
  let dealAmountExpected: number | undefined
  let amountDelta: number | undefined
  let dateDelta: number | undefined
  if (decision === 'matched' && dealId) {
    const deal = await ctx.db.get('deals', dealId)
    if (deal) {
      if (deal.committedAmount != null) {
        dealAmountExpected = deal.committedAmount
        amountDelta = transaction.amount - deal.committedAmount
      }
      if (deal.signedDate != null) {
        dateDelta = transaction.transactionDate - deal.signedDate
      }
    }
  }

  await ctx.db.insert('matchingDecisions', {
    orgId: transaction.orgId,
    transactionId: transaction._id,
    decision,
    dealId: decision === 'matched' ? dealId : undefined,
    source,
    decidedBy,
    decidedAt: Date.now(),
    txLabel: transaction.rawLabel,
    txAmount: transaction.amount,
    txDate: transaction.transactionDate,
    txBankAccountId: transaction.bankAccountId,
    dealAmountExpected,
    amountDelta,
    dateDelta,
    // FX (fxRate, amountInDealCurrency): out of MVP 1 scope, never written here.
  })
}
