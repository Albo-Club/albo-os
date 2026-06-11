import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAppUser, requireOrgMember } from './lib/auth'
import { computeLoanBalanceCents, loanSideForOrg } from './lib/liabilities'
import { applyAllocateToLiability, applyDeallocate } from './lib/pointage'
import { buildSearchText } from './lib/searchText'
import { equityPositionType } from './schema'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Minimal shape of a transaction allocated to a liability target, for
 * display and detaching on the front end.
 */
function pickAllocatedTx(tx: Doc<'transactions'>) {
  return {
    _id: tx._id,
    direction: tx.direction,
    amount: tx.amount,
    transactionDate: tx.transactionDate,
    rawLabel: tx.rawLabel,
    counterparty: tx.counterparty ?? null,
  }
}

/** Holder display name of an equity position (org name > label > person). */
async function holderNameOf(ctx: QueryCtx, position: Doc<'equityPositions'>) {
  const holderOrg = position.holderOrgId
    ? await ctx.db.get('organizations', position.holderOrgId)
    : null
  return (
    holderOrg?.name ?? position.holderLabel ?? position.holderPersonId ?? null
  )
}

/** Counterparty display name of a loan, seen from `orgId`'s side. */
async function counterpartyNameOf(
  ctx: QueryCtx,
  loan: Doc<'intercompanyLoans'>,
  orgId: Id<'organizations'>,
) {
  const counterpartyOrg = await ctx.db.get(
    'organizations',
    loan.fromOrgId === orgId ? loan.toOrgId : loan.fromOrgId,
  )
  return counterpartyOrg?.name ?? loan.fromLabel ?? loan.fromPersonId ?? null
}

/** An org's C/C loans (creditor or debtor side), deduped by _id. */
async function loansOfOrg(ctx: QueryCtx, orgId: Id<'organizations'>) {
  const asCreditor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
    .collect()
  const asDebtor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_to', (q) => q.eq('toOrgId', orgId))
    .collect()
  const loansById = new Map<Id<'intercompanyLoans'>, Doc<'intercompanyLoans'>>()
  for (const loan of [...asCreditor, ...asDebtor]) {
    loansById.set(loan._id, loan)
  }
  return [...loansById.values()]
}

/**
 * Liabilities read logic, shared by the public query (after auth).
 *
 * Balances are NEVER stored: each org sums ITS OWN transactions whose
 * `allocation` targets the loan (index `by_org_allocation_target`).
 * Sign: + = receivable (org is creditor), − = debt (org is debtor).
 * Cf. convex/lib/liabilities.ts.
 */
export async function getLiabilitiesForOrg(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
) {
  // The org's transactions allocated to a given target (without the target
  // `_id` we'd read the whole table: the index covers orgId + allocation.targetId).
  const allocatedTxs = async (
    targetId: string,
    kind: 'equity' | 'intercompany_loan',
  ) => {
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', targetId),
      )
      .collect()
    return txs.filter((tx) => tx.allocation?.kind === kind)
  }

  // 1. Equity issued by the org, enriched with the holder's name and the
  //    transactions allocated to it.
  const positions = await ctx.db
    .query('equityPositions')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  const equityPositions = await Promise.all(
    positions.map(async (position) => {
      const allocated = await allocatedTxs(position._id, 'equity')
      return {
        ...position,
        holderName: await holderNameOf(ctx, position),
        transactions: allocated.map(pickAllocatedTx),
      }
    }),
  )

  // 2. C/C accounts where the org is creditor or debtor (deduped by _id).
  // 3. Per-loan balance derived from THIS org's transactions, enriched with
  //    the counterparty name (the loan's other org) and the allocated txs.
  const loans = await Promise.all(
    (await loansOfOrg(ctx, orgId)).map(async (loan) => {
      const allocated = await allocatedTxs(loan._id, 'intercompany_loan')
      const side = loanSideForOrg(loan, orgId)
      return {
        ...loan,
        // `side` is non-null by construction (the loan comes from this org's
        // by_from / by_to indexes); creditor fallback for safety.
        side: side ?? 'creditor',
        balanceCents: computeLoanBalanceCents(allocated),
        counterpartyName: await counterpartyNameOf(ctx, loan, orgId),
        transactions: allocated.map(pickAllocatedTx),
      }
    }),
  )

  return { equityPositions, loans }
}

/**
 * Lightweight liability targets for the pointage combobox: ids + display
 * names only. Unlike `getLiabilities`, reads NO allocated transactions —
 * so pointage writes never invalidate it, and the pointage page doesn't
 * pay (nor re-download) the per-target transaction lists.
 */
export const listOptions = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    const positions = await ctx.db
      .query('equityPositions')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const equityPositions = await Promise.all(
      positions.map(async (position) => ({
        _id: position._id,
        type: position.type,
        holderName: await holderNameOf(ctx, position),
      })),
    )

    const loans = await Promise.all(
      (await loansOfOrg(ctx, orgId)).map(async (loan) => ({
        _id: loan._id,
        side: loanSideForOrg(loan, orgId) ?? ('creditor' as const),
        counterpartyName: await counterpartyNameOf(ctx, loan, orgId),
      })),
    )

    return { equityPositions, loans }
  },
})

/**
 * An org's liabilities: issued equity positions + inter-entity current
 * accounts, with balances derived from the allocated transactions.
 */
export const getLiabilities = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return await getLiabilitiesForOrg(ctx, orgId)
  },
})

// ─── Transaction → liability allocation (equity / C/C) ──────────────────────
//
// Counterpart of the transaction → deal matching (convex/transactions.ts). A
// tx allocated to liabilities goes `matchStatus: 'matched'` WITHOUT `dealId` —
// that is what distinguishes it from a deal-matched tx — and thus leaves the
// matching queue. NEVER writes to `matchingDecisions` (dataset reserved for
// deal matching), never touches `reconciled` (mirror derived from deal
// matching only).

/**
 * Allocates a transaction to an equity position (`equity`) or an
 * inter-entity current account (`intercompany_loan`). The target must belong
 * to the same org as the transaction (for a C/C: the tx's org must be one of
 * the loan's two parties).
 */
export const allocateTransaction = mutation({
  args: {
    transactionId: v.id('transactions'),
    kind: v.union(v.literal('equity'), v.literal('intercompany_loan')),
    targetId: v.string(),
  },
  handler: async (ctx, { transactionId, kind, targetId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)

    // Core shared with the agent tools: convex/lib/pointage.ts.
    await applyAllocateToLiability(ctx, tx, kind, targetId)
    return null
  },
})

/**
 * Detaches a transaction from liabilities: back to the unallocated state
 * (`unmatched`). Idempotent — with no liability allocation, touches nothing.
 * A tx attached to a deal is not concerned: go through
 * `transactions:unmatchTransaction`.
 */
export const deallocateTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)

    // Core shared with the agent tools: convex/lib/pointage.ts.
    await applyDeallocate(ctx, tx)
    return null
  },
})

// ─── Manual creation (equity / C/C) ──────────────────────────────────────────
//
// Creation only (edit / delete = follow-up). Created rows immediately become
// allocatable targets (combobox of the Pointage tab, via the reactive
// getLiabilities).

/**
 * Creates an equity position issued by the org. The holder is EITHER a group
 * org (`holderOrgId`), OR a free-text label (`holderLabel`), or neither
 * (equity with no named holder). `holderPersonId` is not exposed (no persons
 * table).
 */
export const createEquityPosition = mutation({
  args: {
    orgId: v.id('organizations'), // issuing entity
    holderOrgId: v.optional(v.id('organizations')),
    holderLabel: v.optional(v.string()),
    type: equityPositionType,
    amountCents: v.number(),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)

    if (args.amountCents <= 0) throw new ConvexError('invalid_amount')
    // A single holder source (both empty = allowed).
    if (args.holderOrgId && args.holderLabel) {
      throw new ConvexError('ambiguous_holder')
    }
    if (args.holderOrgId) {
      const holderOrg = await ctx.db.get('organizations', args.holderOrgId)
      if (!holderOrg) throw new ConvexError('not_found')
    }

    return await ctx.db.insert('equityPositions', {
      orgId: args.orgId,
      holderOrgId: args.holderOrgId,
      holderLabel: args.holderLabel?.trim() || undefined,
      type: args.type,
      amountCents: args.amountCents,
      shares: args.shares,
      effectiveDate: args.effectiveDate,
    })
  },
})

/**
 * Creates a creditor → debtor inter-entity current account. The user must
 * be a member of at least one of the two orgs (no C/C between third-party
 * orgs). `interestRateBps` absent = 0 = non interest-bearing.
 */
export const createIntercompanyLoan = mutation({
  args: {
    fromOrgId: v.id('organizations'), // creditor
    toOrgId: v.id('organizations'), // debtor
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.fromOrgId === args.toOrgId) throw new ConvexError('same_org')

    // Member of at least one of the two parties.
    const user = await requireAppUser(ctx)
    const memberships = await Promise.all(
      [args.fromOrgId, args.toOrgId].map((orgId) =>
        ctx.db
          .query('organizationMembers')
          .withIndex('by_org_and_user', (q) =>
            q.eq('orgId', orgId).eq('userId', user._id),
          )
          .unique(),
      ),
    )
    if (!memberships.some((member) => member !== null)) {
      throw new ConvexError('not_a_party')
    }

    const [fromOrg, toOrg] = await Promise.all([
      ctx.db.get('organizations', args.fromOrgId),
      ctx.db.get('organizations', args.toOrgId),
    ])
    if (!fromOrg || !toOrg) throw new ConvexError('not_found')

    if (args.interestRateBps != null && args.interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }

    return await ctx.db.insert('intercompanyLoans', {
      fromOrgId: args.fromOrgId,
      toOrgId: args.toOrgId,
      interestRateBps: args.interestRateBps,
      isBlocked: args.isBlocked,
      openedDate: args.openedDate,
    })
  },
})

// ─── Edit / delete (equity / C/C) ────────────────────────────────────────────
//
// Deletion is refused while transactions are still allocated to the target
// (`has_allocations`): detach first, delete second. Never any implicit
// detaching — allocation is a user decision.

/**
 * True if at least one transaction of the given orgs is allocated to the
 * target (equity or C/C). Bounded read: `.first()` per org on the
 * `by_org_allocation_target` index.
 */
async function hasAllocations(
  ctx: QueryCtx,
  orgIds: Array<Id<'organizations'>>,
  targetId: string,
) {
  for (const orgId of orgIds) {
    const tx = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', targetId),
      )
      .first()
    if (tx) return true
  }
  return false
}

/**
 * Checks that the user is a member of at least one of the two parties of a
 * C/C (same rule as createIntercompanyLoan).
 */
async function requireLoanParty(ctx: QueryCtx, loan: Doc<'intercompanyLoans'>) {
  const user = await requireAppUser(ctx)
  const memberships = await Promise.all(
    [loan.fromOrgId, loan.toOrgId].map((orgId) =>
      ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', user._id),
        )
        .unique(),
    ),
  )
  if (!memberships.some((member) => member !== null)) {
    throw new ConvexError('not_a_party')
  }
}

/**
 * Updates an equity position (full replacement of the editable fields — the
 * dialog is pre-filled with the current values).
 * Same validation rules as createEquityPosition.
 */
export const updateEquityPosition = mutation({
  args: {
    positionId: v.id('equityPositions'),
    holderOrgId: v.optional(v.id('organizations')),
    holderLabel: v.optional(v.string()),
    type: equityPositionType,
    amountCents: v.number(),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db.get('equityPositions', args.positionId)
    if (!position) throw new ConvexError('not_found')
    await requireOrgMember(ctx, position.orgId)

    if (args.amountCents <= 0) throw new ConvexError('invalid_amount')
    if (args.holderOrgId && args.holderLabel) {
      throw new ConvexError('ambiguous_holder')
    }
    if (args.holderOrgId) {
      const holderOrg = await ctx.db.get('organizations', args.holderOrgId)
      if (!holderOrg) throw new ConvexError('not_found')
    }

    // `undefined` removes the field (Convex patch) — a cleared holder
    // becomes "none" again.
    await ctx.db.patch('equityPositions', position._id, {
      holderOrgId: args.holderOrgId,
      holderLabel: args.holderLabel?.trim() || undefined,
      type: args.type,
      amountCents: args.amountCents,
      shares: args.shares,
      effectiveDate: args.effectiveDate,
    })
    return null
  },
})

/**
 * Deletes an equity position. Refused (`has_allocations`) if transactions
 * are still allocated to it.
 */
export const deleteEquityPosition = mutation({
  args: { positionId: v.id('equityPositions') },
  handler: async (ctx, { positionId }) => {
    const position = await ctx.db.get('equityPositions', positionId)
    if (!position) throw new ConvexError('not_found')
    await requireOrgMember(ctx, position.orgId)

    if (await hasAllocations(ctx, [position.orgId], position._id)) {
      throw new ConvexError('has_allocations')
    }
    await ctx.db.delete('equityPositions', positionId)
    return null
  },
})

/**
 * Updates a C/C (rate, blocked flag, opening date). The creditor/debtor
 * parties are NOT editable: changing counterparty = delete then recreate
 * (the derived balance depends on the loan's identity).
 */
export const updateIntercompanyLoan = mutation({
  args: {
    loanId: v.id('intercompanyLoans'),
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('intercompanyLoans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireLoanParty(ctx, loan)

    if (args.interestRateBps != null && args.interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }
    await ctx.db.patch('intercompanyLoans', loan._id, {
      interestRateBps: args.interestRateBps,
      isBlocked: args.isBlocked,
      openedDate: args.openedDate,
    })
    return null
  },
})

/**
 * Deletes a C/C. Refused (`has_allocations`) if transactions of EITHER of
 * the two orgs are still allocated to it (each party's balance derives from
 * its own transactions).
 */
export const deleteIntercompanyLoan = mutation({
  args: { loanId: v.id('intercompanyLoans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('intercompanyLoans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireLoanParty(ctx, loan)

    if (await hasAllocations(ctx, [loan.fromOrgId, loan.toOrgId], loan._id)) {
      throw new ConvexError('has_allocations')
    }
    await ctx.db.delete('intercompanyLoans', loanId)
    return null
  },
})

// ─── Manual verification scenario (dev) ─────────────────────────────────────
//
// Cf. TESTING.md « Passif ». Data tagged TEST_MARKER so it can be purged via
// cleanupTestScenario. Never called by application code.

const TEST_MARKER = '[TEST liabilities]'

/**
 * Seeds the verification scenario: 1 equityPosition issued by fromOrg,
 * 1 C/C fromOrg → toOrg, and 2 transactions allocated to them (one leg per
 * org: `out` on the creditor side, `in` on the debtor side, 100 000 € each).
 *
 * Then expected via getLiabilities:
 *   fromOrg (creditor) → side 'creditor', balanceCents +10_000_000
 *   toOrg (debtor)     → side 'debtor',   balanceCents −10_000_000
 *
 *   pnpm exec convex run liabilities:seedTestScenario \
 *     '{"fromOrgId": "…", "toOrgId": "…"}'
 */
export const seedTestScenario = internalMutation({
  args: {
    fromOrgId: v.id('organizations'),
    toOrgId: v.id('organizations'),
  },
  handler: async (ctx, { fromOrgId, toOrgId }) => {
    if (fromOrgId === toOrgId) throw new ConvexError('same_org')
    const now = Date.now()
    const amountCents = 10_000_000 // 100 000 €

    // One bank account per org (created if absent, tagged TEST for cleanup).
    const accountFor = async (orgId: Id<'organizations'>) => {
      const existing = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .first()
      if (existing) return existing._id

      const root = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', orgId).eq('kind', 'group_root'),
        )
        .first()
      if (!root) throw new ConvexError('no_group_root_company')
      return await ctx.db.insert('bankAccounts', {
        orgId,
        ownerCompanyId: root._id,
        bankName: 'Test',
        label: TEST_MARKER,
        currency: 'EUR',
      })
    }
    const fromAccountId = await accountFor(fromOrgId)
    const toAccountId = await accountFor(toOrgId)

    // 1 equity position issued by the creditor (free-text TEST holder).
    const equityPositionId = await ctx.db.insert('equityPositions', {
      orgId: fromOrgId,
      holderLabel: TEST_MARKER,
      type: 'capital_social',
      amountCents: 1_000_000, // 10 000 €
      effectiveDate: now,
    })

    // 1 C/C creditor → debtor.
    const loanId = await ctx.db.insert('intercompanyLoans', {
      fromOrgId,
      toOrgId,
      fromLabel: TEST_MARKER,
      isBlocked: false,
      openedDate: now,
    })

    // 2 transactions allocated to the loan: one leg per org.
    const insertLeg = async (
      orgId: Id<'organizations'>,
      bankAccountId: Id<'bankAccounts'>,
      direction: 'in' | 'out',
    ) =>
      await ctx.db.insert('transactions', {
        orgId,
        bankAccountId,
        direction,
        amount: amountCents,
        transactionDate: now,
        rawLabel: `${TEST_MARKER} avance C/C`,
        searchText: buildSearchText(`${TEST_MARKER} avance C/C`, undefined),
        source: 'manual',
        // A tx allocated to liabilities is `matched` without dealId (same
        // state allocateTransaction would produce).
        matchStatus: 'matched',
        allocation: { kind: 'intercompany_loan', targetId: loanId },
        reconciled: false,
      })
    const fromTxId = await insertLeg(fromOrgId, fromAccountId, 'out')
    const toTxId = await insertLeg(toOrgId, toAccountId, 'in')

    return { equityPositionId, loanId, fromTxId, toTxId }
  },
})

/**
 * Purges the data created by seedTestScenario (idempotent: only deletes the
 * TEST_MARKER-tagged rows of the two orgs passed as args).
 *
 *   pnpm exec convex run liabilities:cleanupTestScenario \
 *     '{"fromOrgId": "…", "toOrgId": "…"}'
 */
export const cleanupTestScenario = internalMutation({
  args: {
    fromOrgId: v.id('organizations'),
    toOrgId: v.id('organizations'),
  },
  handler: async (ctx, { fromOrgId, toOrgId }) => {
    let deleted = 0

    for (const orgId of [fromOrgId, toOrgId]) {
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
        .collect()
      for (const tx of txs) {
        if (!tx.rawLabel.startsWith(TEST_MARKER)) continue
        await ctx.db.delete('transactions', tx._id)
        deleted += 1
      }

      const positions = await ctx.db
        .query('equityPositions')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      for (const position of positions) {
        if (position.holderLabel !== TEST_MARKER) continue
        await ctx.db.delete('equityPositions', position._id)
        deleted += 1
      }

      const loans = await ctx.db
        .query('intercompanyLoans')
        .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
        .collect()
      for (const loan of loans) {
        if (loan.fromLabel !== TEST_MARKER) continue
        await ctx.db.delete('intercompanyLoans', loan._id)
        deleted += 1
      }

      const accounts = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      for (const account of accounts) {
        if (account.label !== TEST_MARKER) continue
        await ctx.db.delete('bankAccounts', account._id)
        deleted += 1
      }
    }

    return { deleted }
  },
})
