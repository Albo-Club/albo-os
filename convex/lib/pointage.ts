import { ConvexError } from 'convex/values'

import { recordDecision } from './matchingLog'
import { loanSideForOrg } from './liabilities'

import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { VatRateBps } from './vat'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Core of transaction → deal / liability matching (pointage), shared by the
 * public mutations (convex/transactions.ts, convex/liabilities.ts) and the
 * agent tools (convex/agentToolsPointage.ts) so they never diverge.
 *
 * Invariants (cf. KNOWN_ISSUES.md « Pointage » / « Passif »):
 * - `matchStatus === 'matched'` ⟺ matched to a deal (`dealId != null` +
 *   `allocation.kind === 'deal'`) OR allocated to liability (`dealId == null`
 *   + `allocation.kind === 'equity' | 'intercompany_loan'`).
 * - `reconciled` (+ by/at) is a mirror derived from DEAL matching only.
 * - Every deal decision writes an append-only row to `matchingDecisions`
 *   (`source: 'manual' | 'agent_suggested'`); liability matching never
 *   writes there.
 * - `vatRateBps` only lives on the `charge` / `product` statuses: any
 *   matching that leaves these statuses clears it (cf. KNOWN_ISSUES.md
 *   « TVA récupérable »).
 *
 * The caller has already loaded the transaction and checked org membership.
 */

export type PointageSource = 'manual' | 'agent_suggested'

export type CategorizeStatus =
  | 'ignored'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

/**
 * Guardrail: refuses to silently overwrite a liability allocation
 * (equity / C/C). Detach first via `applyDeallocate`.
 */
export function assertNotAllocatedToLiability(tx: Doc<'transactions'>) {
  if (tx.allocation && tx.allocation.kind !== 'deal') {
    throw new ConvexError('allocated_to_liability')
  }
}

/** Matches a transaction to a deal of the same org. */
export async function applyMatchToDeal(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  dealId: Id<'deals'>,
  decidedBy: Id<'users'>,
  source: PointageSource,
) {
  assertNotAllocatedToLiability(tx)

  const deal = await ctx.db.get('deals', dealId)
  if (!deal || deal.orgId !== tx.orgId) {
    throw new ConvexError('deal_wrong_org')
  }

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'matched',
    dealId,
    allocation: { kind: 'deal', targetId: dealId },
    vatRateBps: undefined,
    reconciled: true,
    reconciledBy: decidedBy,
    reconciledAt: Date.now(),
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: 'matched',
    dealId,
    source,
    decidedBy,
  })
}

/** Unmatches a deal transaction (back to `unmatched`), decision logged. */
export async function applyUnmatch(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  decidedBy: Id<'users'>,
  source: PointageSource,
) {
  // A tx allocated to liability is detached via applyDeallocate — a deal
  // unmatch here would leave its allocation orphaned.
  assertNotAllocatedToLiability(tx)

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'unmatched',
    dealId: undefined,
    allocation: undefined,
    vatRateBps: undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: 'unmatched',
    source,
    decidedBy,
  })
}

/**
 * Sets a transaction aside: ignored, charge, tax, product or internal
 * transfer. Same patch for every status — only the status differs so these
 * transactions can be looked up later. `vatRateBps` (VAT) only exists on
 * charge/product: set when provided (existing value kept otherwise),
 * cleared for any other status.
 */
export async function applyCategorization(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  status: CategorizeStatus,
  decidedBy: Id<'users'>,
  source: PointageSource,
  vatRateBps?: VatRateBps,
) {
  assertNotAllocatedToLiability(tx)
  const vatBearing = status === 'charge' || status === 'product'
  await ctx.db.patch('transactions', tx._id, {
    matchStatus: status,
    dealId: undefined,
    allocation: undefined,
    vatRateBps: vatBearing ? (vatRateBps ?? tx.vatRateBps) : undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: status,
    source,
    decidedBy,
  })
}

/**
 * Allocates a transaction to an equity position (`equity`) or an
 * inter-entity current account (`intercompany_loan`). The target must belong
 * to the same org as the transaction (for a C/C: the tx org must be one of
 * the two parties to the loan). NEVER writes to `matchingDecisions`, never
 * touches `reconciled` (mirror of deal matching only).
 */
export async function applyAllocateToLiability(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  kind: 'equity' | 'intercompany_loan',
  targetId: string,
) {
  // Guardrail: no silent double matching. A tx matched to a deal must be
  // unmatched (applyUnmatch) before going to liability.
  if (tx.dealId != null || tx.allocation?.kind === 'deal') {
    throw new ConvexError('already_matched_to_deal')
  }

  if (kind === 'equity') {
    const positionId = ctx.db.normalizeId('equityPositions', targetId)
    const position = positionId
      ? await ctx.db.get('equityPositions', positionId)
      : null
    if (!position) throw new ConvexError('not_found')
    if (position.orgId !== tx.orgId) throw new ConvexError('equity_wrong_org')
  } else {
    const loanId = ctx.db.normalizeId('intercompanyLoans', targetId)
    const loan = loanId ? await ctx.db.get('intercompanyLoans', loanId) : null
    if (!loan) throw new ConvexError('not_found')
    // The tx must belong to one of the two orgs of the C/C (creditor or
    // debtor) — otherwise it cannot carry a leg of this loan.
    if (loanSideForOrg(loan, tx.orgId) === null) {
      throw new ConvexError('loan_wrong_org')
    }
  }

  await ctx.db.patch('transactions', tx._id, {
    allocation: { kind, targetId },
    matchStatus: 'matched',
    vatRateBps: undefined,
  })
}

/**
 * Detaches a transaction from liability: back to the unmatched state
 * (`unmatched`). Idempotent — without a liability allocation, touches
 * nothing. A tx matched to a deal is not covered: go through `applyUnmatch`.
 */
export async function applyDeallocate(ctx: MutCtx, tx: Doc<'transactions'>) {
  if (tx.allocation?.kind === 'deal') {
    throw new ConvexError('already_matched_to_deal')
  }
  if (!tx.allocation) return

  await ctx.db.patch('transactions', tx._id, {
    allocation: undefined,
    matchStatus: 'unmatched',
    vatRateBps: undefined,
  })
}
