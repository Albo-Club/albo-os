import { ConvexError } from 'convex/values'

import { recordDecision } from './matchingLog'
import { loanSideForOrg } from './liabilities'
import { transferLegs } from './transfers'

import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { VatRateBps } from './vat'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Core of transaction → deal / liability matching (pointage), shared by the
 * public mutations (convex/transactions.ts, convex/liabilities.ts) and the
 * agent tools (convex/agentToolsPointage.ts) so they never diverge.
 *
 * Invariants (cf. KNOWN_ISSUES.md « Pointage » / « Passif » / « Virements
 * internes »):
 * - `matchStatus === 'matched'` ⟺ matched to a deal (`dealId != null` +
 *   `allocation.kind === 'deal'`) OR allocated to liability (`dealId == null`
 *   + `allocation.kind === 'equity' | 'intercompany_loan' | 'loan' |
 *   'property'`).
 * - `allocation.kind === 'transfer'` is the ONE allocation that keeps
 *   `matchStatus: 'internal_transfer'` instead of 'matched': both legs stay
 *   « écarté » (excluded from the analysis), the allocation only records
 *   which transfer they belong to.
 * - `reconciled` (+ by/at) is a mirror derived from DEAL matching only.
 * - Every deal decision writes an append-only row to `matchingDecisions`
 *   (`source: 'manual' | 'agent_suggested'`); liability matching never
 *   writes there.
 * - `vatRateBps` AND `category` only live on the `charge` / `product`
 *   statuses: any matching that leaves these statuses clears them
 *   (cf. KNOWN_ISSUES.md « TVA récupérable »).
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
 * Nature of a flow on a property (SPEC D42). One per transaction, never two:
 * a notary transfer covering the price AND the duties goes whole into
 * `acquisition` — it is never split.
 *
 * The direction is NOT constrained here. The picker offers the outgoing
 * natures on a debit and the incoming ones on a credit (SPEC § 6.7), but a
 * refund is a real movement: works reimbursed come back `in` under
 * `travaux`, and the engine subtracts them from the line item. Forbidding
 * that at the mutation would leave such a transaction impossible to match.
 */
export type AllocationCategory =
  | 'acquisition'
  | 'frais_acquisition'
  | 'travaux'
  | 'charges'
  | 'loyer'
  | 'revente'

/**
 * Guardrail: refuses to silently overwrite an allocation that this operation
 * would leave orphaned — a liability (equity / C/C, detach via
 * `applyDeallocate`) or an internal-transfer leg (detach via
 * `applyUnpairTransfer`, otherwise the counter-leg keeps pointing at a
 * transfer this one has left).
 */
export function assertNotAllocatedElsewhere(tx: Doc<'transactions'>) {
  if (!tx.allocation || tx.allocation.kind === 'deal') return
  throw new ConvexError(
    tx.allocation.kind === 'transfer'
      ? 'allocated_to_transfer'
      : 'allocated_to_liability',
  )
}

/** Matches a transaction to a deal of the same org. */
export async function applyMatchToDeal(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  dealId: Id<'deals'>,
  decidedBy: Id<'users'>,
  source: PointageSource,
) {
  assertNotAllocatedElsewhere(tx)

  const deal = await ctx.db.get('deals', dealId)
  if (!deal || deal.orgId !== tx.orgId) {
    throw new ConvexError('deal_wrong_org')
  }

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'matched',
    dealId,
    allocation: { kind: 'deal', targetId: dealId },
    vatRateBps: undefined,
    category: undefined,
    reconciled: true,
    reconciledBy: decidedBy,
    reconciledAt: Date.now(),
  })
  // A deal still in Term Sheet (`pending`) becomes `active` as soon as real
  // money leaves for it: the pointed outflow IS the signal that the wire
  // happened, so the deal no longer belongs to the anticipated bucket. The
  // FIRST outflow is enough — a fund is live from its first capital call, long
  // before the calls add up to the commitment. Forward-only, like the Attio
  // 'Invested' path (convex/attioSync.ts): no other status is touched, and
  // unmatching never demotes the deal back to `pending`.
  if (deal.status === 'pending' && tx.direction === 'out') {
    await ctx.db.patch('deals', dealId, { status: 'active' })
  }

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
  assertNotAllocatedElsewhere(tx)

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'unmatched',
    dealId: undefined,
    allocation: undefined,
    vatRateBps: undefined,
    category: undefined,
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
 * transactions can be looked up later. `vatRateBps` (VAT) and `category`
 * only exist on charge/product: set when provided (existing value kept
 * otherwise), cleared for any other status.
 */
export async function applyCategorization(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  status: CategorizeStatus,
  decidedBy: Id<'users'>,
  source: PointageSource,
  vatRateBps?: VatRateBps,
  category?: string,
) {
  assertNotAllocatedElsewhere(tx)
  const vatBearing = status === 'charge' || status === 'product'
  await ctx.db.patch('transactions', tx._id, {
    matchStatus: status,
    dealId: undefined,
    allocation: undefined,
    vatRateBps: vatBearing ? (vatRateBps ?? tx.vatRateBps) : undefined,
    category: vatBearing ? (category ?? tx.category) : undefined,
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
 * Allocates a transaction to an equity position (`equity`), an inter-entity
 * current account (`intercompany_loan`), a BANK loan (`loan`) or a PROPERTY
 * (`property`). The target must belong to the same org as the transaction
 * (for a C/C: the tx org must be one of the two parties to the loan). NEVER
 * writes to `matchingDecisions`, never touches `reconciled` (mirror of deal
 * matching only).
 */
export async function applyAllocateToLiability(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  kind: 'equity' | 'intercompany_loan' | 'loan' | 'property',
  targetId: string,
  /**
   * Nature of the flow on its target — `property` only, where it decides
   * whether the amount enters the cost basis, the operating result or the
   * capital gain. Required there, refused everywhere else: a category on an
   * equity position would mean nothing and nothing would read it.
   */
  category?: AllocationCategory,
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
  } else if (kind === 'loan') {
    // A bank loan belongs to exactly ONE org (the borrowing company), so a
    // plain org comparison is enough — no two-sided case as for a C/C.
    const bankLoanId = ctx.db.normalizeId('loans', targetId)
    const bankLoan = bankLoanId ? await ctx.db.get('loans', bankLoanId) : null
    if (!bankLoan) throw new ConvexError('not_found')
    if (bankLoan.orgId !== tx.orgId) {
      throw new ConvexError('bank_loan_wrong_org')
    }
  } else if (kind === 'property') {
    // A property belongs to exactly ONE org (the holding company) — same
    // single-sided check as a bank loan.
    const propertyId = ctx.db.normalizeId('properties', targetId)
    const property = propertyId
      ? await ctx.db.get('properties', propertyId)
      : null
    if (!property) throw new ConvexError('not_found')
    if (property.orgId !== tx.orgId) {
      throw new ConvexError('property_wrong_org')
    }
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

  // A property flow without its nature could not be read: the app would not
  // know whether it is a cost, a charge or a rent. Everywhere else a
  // category would be dead weight.
  if (kind === 'property') {
    if (!category) throw new ConvexError('missing_category')
  } else if (category) {
    throw new ConvexError('category_not_supported')
  }

  await ctx.db.patch('transactions', tx._id, {
    allocation: { kind, targetId, category },
    matchStatus: 'matched',
    vatRateBps: undefined,
    category: undefined,
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
  // A transfer leg is detached by `applyUnpairTransfer`, which also disposes
  // of the shared `transfers` row — deallocating here would strand it.
  if (tx.allocation?.kind === 'transfer') {
    throw new ConvexError('allocated_to_transfer')
  }
  if (!tx.allocation) return

  await ctx.db.patch('transactions', tx._id, {
    allocation: undefined,
    matchStatus: 'unmatched',
    vatRateBps: undefined,
    category: undefined,
  })
}

// ─── Internal transfers (two legs, same legal entity) ───────────────────────

/** The entity (`group_*`) owning the account a transaction sits on. */
async function ownerCompanyOf(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
): Promise<Id<'companies'>> {
  const account = await ctx.db.get('bankAccounts', tx.bankAccountId)
  if (!account) throw new ConvexError('not_found')
  return account.ownerCompanyId
}

/**
 * Opens an internal transfer on a single leg: creates the `transfers` row
 * anchored on the leg's owning entity and allocates the leg to it. The
 * transfer is INCOMPLETE until a counter-leg is paired — which is the point:
 * it shows up as such instead of vanishing from the analysis unnoticed.
 *
 * The caller has already set the transaction to `internal_transfer`
 * (`applyCategorization`), which cleared any previous allocation.
 */
export async function applyOpenTransfer(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  createdBy: Id<'users'>,
): Promise<Id<'transfers'>> {
  const ownerCompanyId = await ownerCompanyOf(ctx, tx)
  const transferId = await ctx.db.insert('transfers', {
    orgId: tx.orgId,
    ownerCompanyId,
    createdBy,
  })
  await ctx.db.patch('transactions', tx._id, {
    allocation: { kind: 'transfer', targetId: transferId },
  })
  return transferId
}

/**
 * Pairs `leg` as the counter-leg of `transfer`.
 *
 * The invariant that makes an internal transfer verifiable: both legs sit on
 * accounts owned by the SAME legal entity (`bankAccounts.ownerCompanyId`),
 * on two different accounts, in opposite directions. A movement between two
 * different entities is NOT an internal transfer — it is pointed to that
 * entity like a deal (cf. KNOWN_ISSUES.md « Virements internes »).
 *
 * Amounts are deliberately NOT required to be equal: bank fees and partial
 * transfers are real. The gap is surfaced by the readers, never absorbed.
 *
 * When `leg` already carries its own (incomplete) transfer — the usual case
 * after a bulk categorization tagged both legs separately — that row is
 * absorbed and deleted, so two half-transfers merge into one instead of
 * dead-ending.
 */
export async function applyPairTransfer(
  ctx: MutCtx,
  transfer: Doc<'transfers'>,
  leg: Doc<'transactions'>,
  decidedBy: Id<'users'>,
) {
  if (leg.orgId !== transfer.orgId) throw new ConvexError('transfer_wrong_org')

  const existing = await transferLegs(ctx, transfer)
  if (existing.some((l) => l._id === leg._id)) return // already paired here
  if (existing.length >= 2) throw new ConvexError('transfer_already_complete')

  // The leg must be free, or hold nothing but its own incomplete transfer.
  const legTransferId =
    leg.allocation?.kind === 'transfer' ? leg.allocation.targetId : null
  if (leg.allocation && !legTransferId) {
    assertNotAllocatedElsewhere(leg) // deal → its own error code
    throw new ConvexError('already_matched_to_deal')
  }

  if (existing.length === 1) {
    const other = existing[0]
    if (other.bankAccountId === leg.bankAccountId) {
      throw new ConvexError('transfer_same_account')
    }
    if (other.direction === leg.direction) {
      throw new ConvexError('transfer_same_direction')
    }
  }

  const ownerCompanyId = await ownerCompanyOf(ctx, leg)
  if (ownerCompanyId !== transfer.ownerCompanyId) {
    throw new ConvexError('transfer_wrong_entity')
  }

  const wasTagged = leg.matchStatus === 'internal_transfer'
  await ctx.db.patch('transactions', leg._id, {
    matchStatus: 'internal_transfer',
    dealId: undefined,
    allocation: { kind: 'transfer', targetId: transfer._id },
    vatRateBps: undefined,
    category: undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  // Pairing a not-yet-tagged counter-leg IS the categorization gesture for
  // it — log it like `applyCategorization` would, so the decision journal
  // stays exhaustive.
  if (!wasTagged) {
    await recordDecision(ctx, {
      transaction: leg,
      decision: 'internal_transfer',
      source: 'manual',
      decidedBy,
    })
  }

  // Absorb the leg's own half-transfer, now legless.
  if (legTransferId && legTransferId !== transfer._id) {
    const orphanId = ctx.db.normalizeId('transfers', legTransferId)
    const orphan = orphanId ? await ctx.db.get('transfers', orphanId) : null
    if (orphan && (await transferLegs(ctx, orphan)).length === 0) {
      await ctx.db.delete('transfers', orphan._id)
    }
  }
}

/**
 * Detaches one leg from its transfer: the transaction goes back to
 * `unmatched` (same end state as `applyDeallocate` on a liability), and the
 * `transfers` row is deleted once it has no leg left. The remaining leg, if
 * any, stays tagged and simply becomes incomplete again.
 */
export async function applyUnpairTransfer(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  decidedBy: Id<'users'>,
) {
  if (tx.allocation?.kind !== 'transfer') return

  const transferId = ctx.db.normalizeId('transfers', tx.allocation.targetId)
  const transfer = transferId ? await ctx.db.get('transfers', transferId) : null

  await ctx.db.patch('transactions', tx._id, {
    allocation: undefined,
    matchStatus: 'unmatched',
    vatRateBps: undefined,
    category: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: 'unmatched',
    source: 'manual',
    decidedBy,
  })

  if (transfer && (await transferLegs(ctx, transfer)).length === 0) {
    await ctx.db.delete('transfers', transfer._id)
  }
}
