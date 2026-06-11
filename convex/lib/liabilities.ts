/**
 * Pure liabilities (passif) logic (inter-entity current account balances).
 *
 * Deliberately free of any Convex ctx dependency: tested via node:test
 * (tests/liabilities.test.ts), same pattern as lib/recurrence.ts.
 *
 * Balance derivation rule (cf. KNOWN_ISSUES.md « Passif »): each org derives
 * a C/C balance from ITS OWN transactions allocated to it.
 * - Creditor (fromOrgId): out = loan, in = repayment received
 *   → positive balance = receivable.
 * - Debtor (toOrgId): in = borrowing, out = repayment paid
 *   → negative balance = debt.
 * The two sides can diverge when matching is incomplete — that is a
 * reconciliation signal, not a bug.
 */

export type LoanSide = 'creditor' | 'debtor'

export type LoanOrgRefs = {
  fromOrgId: string
  toOrgId: string
}

export type AllocatedTx = {
  direction: 'in' | 'out'
  amount: number // cents, always positive (transactions convention)
}

/**
 * Side of the viewing org on a C/C: creditor if it is fromOrgId, debtor if
 * toOrgId, null if it is not a party to the loan.
 */
export function loanSideForOrg(
  loan: LoanOrgRefs,
  orgId: string,
): LoanSide | null {
  if (loan.fromOrgId === orgId) return 'creditor'
  if (loan.toOrgId === orgId) return 'debtor'
  return null
}

/**
 * Signed balance (cents) of a C/C from one org's point of view, derived from
 * its own transactions allocated to the loan: Σ(out) − Σ(in).
 *
 * The same formula serves both sides:
 * - Creditor: pays out to lend (out) → balance + = receivable.
 * - Debtor: receives to borrow (in) → balance − = debt.
 */
export function computeLoanBalanceCents(txs: Array<AllocatedTx>): number {
  let balance = 0
  for (const tx of txs) {
    balance += tx.direction === 'out' ? tx.amount : -tx.amount
  }
  return balance
}
