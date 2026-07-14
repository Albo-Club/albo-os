import type { Doc } from '../_generated/dataModel'

/**
 * Scope predicates for bank-account balance aggregations.
 *
 * "Available" = the cash actually mobilizable today: EUR handling stays at
 * the call sites (some aggregate all currencies, some EUR only) — these
 * predicates only encode the lifecycle/pledge dimension:
 * - `archivedAt` set → import artifact, out of every view (pre-existing rule);
 * - `accountStatus === 'closed'` → account closed at the bank, kept for its
 *   transaction history but its (normally zero) balance never counts;
 * - `pledged` → nantissement/blocked funds: listed, but excluded from the
 *   available balance and from the forecast starting balance.
 */
export function isListedAccount(account: Doc<'bankAccounts'>): boolean {
  return !account.archivedAt
}

/** Counts toward the AVAILABLE balance (and the forecast starting balance). */
export function isAvailableAccount(account: Doc<'bankAccounts'>): boolean {
  return (
    isListedAccount(account) &&
    (account.accountStatus ?? 'active') === 'active' &&
    account.pledged !== true
  )
}
