import type { GenericMutationCtx } from 'convex/server'

import type { DataModel, Doc, Id } from '../_generated/dataModel'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Écrit une ligne dans `matchingDecisions` (append-only) — le dataset
 * d'apprentissage de l'agent de rattachement (phase 2). Appelé par les
 * mutations de pointage de convex/transactions.ts, jamais exposé en API.
 *
 * Le snapshot (label, montant, date, compte) est lu depuis l'objet
 * `transaction` déjà chargé par l'appelant, figé au moment de la décision.
 * Les deltas ne sont calculés que si le deal porte un `committedAmount` /
 * `signedDate` lisibles trivialement.
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
    decision: 'matched' | 'ignored' | 'unmatched' | 'charge' | 'tax'
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
    // FX (fxRate, amountInDealCurrency) : hors scope MVP 1, jamais écrits ici.
  })
}
