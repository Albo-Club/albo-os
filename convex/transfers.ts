import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  applyOpenTransfer,
  applyPairTransfer,
  applyUnpairTransfer,
} from './lib/pointage'
import { normalizeSearch } from './lib/searchText'
import { transferLegs } from './lib/transfers'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * Internal transfers: a movement between two bank accounts of the SAME legal
 * entity (`bankAccounts.ownerCompanyId`), possibly across banks.
 *
 * A transfer is an OBJECT with two legs, not a per-line label: that is what
 * makes it verifiable. A leg tagged without its counter-leg stays visible as
 * incomplete instead of silently leaving the analysis
 * (cf. KNOWN_ISSUES.md « Virements internes »).
 *
 * The counter-leg is ALWAYS chosen by hand. `listPairable` narrows by
 * structural rule (same entity, other account, opposite direction) and sorts
 * by date — it never ranks by likelihood, so it is a filter, not a
 * suggestion (cf. CLAUDE.md, suppression du moteur de suggestion).
 */

/** Bound on the candidate counter-legs read per account. */
const PAIRABLE_PER_ACCOUNT = 100

/** Loads a transaction and checks the caller belongs to its org. */
async function requireTransaction(
  ctx: QueryCtx | MutationCtx,
  transactionId: Id<'transactions'>,
) {
  const tx = await ctx.db.get('transactions', transactionId)
  if (!tx) throw new ConvexError('not_found')
  const { user } = await requireOrgMember(ctx, tx.orgId)
  return { tx, user }
}

/** The transfer a transaction belongs to, or null. */
async function transferOf(
  ctx: QueryCtx | MutationCtx,
  tx: Doc<'transactions'>,
): Promise<Doc<'transfers'> | null> {
  if (tx.allocation?.kind !== 'transfer') return null
  const id = ctx.db.normalizeId('transfers', tx.allocation.targetId)
  return id ? await ctx.db.get('transfers', id) : null
}

/** Display shape of one leg (amounts in cents, dates ms epoch). */
function legView(tx: Doc<'transactions'>, account: Doc<'bankAccounts'> | null) {
  return {
    _id: tx._id,
    direction: tx.direction,
    amount: tx.amount,
    transactionDate: tx.transactionDate,
    rawLabel: tx.rawLabel,
    counterparty: tx.counterparty ?? null,
    account: account
      ? {
          _id: account._id,
          label: account.displayName ?? account.label,
          bankName: account.bankName,
        }
      : null,
  }
}

/**
 * The transfer a transaction belongs to, with both legs and the two figures
 * that must never be absorbed: the amount gap (bank fees, partial transfer)
 * and the in-transit delay (different banks settle on different days). Both
 * are DERIVED here, never stored.
 *
 * Returns null when the transaction is not an internal transfer at all.
 */
export const getForTransaction = query({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const { tx } = await requireTransaction(ctx, transactionId)
    if (tx.matchStatus !== 'internal_transfer') return null

    const transfer = await transferOf(ctx, tx)
    // Tagged but never paired — including every row tagged before transfers
    // became an object (no allocation at all).
    if (!transfer) {
      return { complete: false, legs: [], gapCents: null, transitDays: null }
    }

    const legs = await transferLegs(ctx, transfer)
    legs.sort((a, b) => a.transactionDate - b.transactionDate)
    const views = await Promise.all(
      legs.map(async (leg) =>
        legView(leg, await ctx.db.get('bankAccounts', leg.bankAccountId)),
      ),
    )

    const out = legs.find((l) => l.direction === 'out')
    const income = legs.find((l) => l.direction === 'in')
    const complete = legs.length === 2 && out != null && income != null

    return {
      complete,
      legs: views,
      gapCents: complete ? out.amount - income.amount : null,
      transitDays: complete
        ? Math.round(
            (income.transactionDate - out.transactionDate) / 86_400_000,
          )
        : null,
    }
  },
})

/**
 * Candidate counter-legs for a transfer leg: transactions on the OTHER
 * accounts of the same entity, in the opposite direction, still free
 * (`unmatched`) or themselves tagged as an internal transfer (the usual
 * shape after a bulk categorization tagged both legs separately).
 *
 * Sorted by descending date, `search` filtering on the same normalized text
 * as the rest of the app. Bounded to PAIRABLE_PER_ACCOUNT rows per account:
 * a counter-leg older than that is reached through the search box.
 */
export const listPairable = query({
  args: {
    transactionId: v.id('transactions'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { transactionId, search }) => {
    const { tx } = await requireTransaction(ctx, transactionId)

    const ownAccount = await ctx.db.get('bankAccounts', tx.bankAccountId)
    if (!ownAccount) throw new ConvexError('not_found')

    // Same entity, other accounts — the invariant, applied as a filter.
    const siblings = (
      await ctx.db
        .query('bankAccounts')
        .withIndex('by_owner', (q) =>
          q
            .eq('orgId', tx.orgId)
            .eq('ownerCompanyId', ownAccount.ownerCompanyId),
        )
        .collect()
    ).filter((a) => a._id !== ownAccount._id && a.archivedAt == null)

    const wanted = tx.direction === 'out' ? 'in' : 'out'
    const term = search ? normalizeSearch(search) : ''

    const rows: Array<Doc<'transactions'>> = []
    for (const account of siblings) {
      const candidates = await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) => q.eq('bankAccountId', account._id))
        .order('desc')
        .take(PAIRABLE_PER_ACCOUNT)
      for (const candidate of candidates) {
        if (candidate.direction !== wanted) continue
        const status = candidate.matchStatus ?? 'unmatched'
        if (status !== 'unmatched' && status !== 'internal_transfer') continue
        // Already half of ANOTHER complete transfer.
        if (candidate.allocation?.kind === 'transfer') {
          const other = await transferOf(ctx, candidate)
          if (other && (await transferLegs(ctx, other)).length >= 2) continue
        }
        if (term && !candidate.searchText?.includes(term)) continue
        rows.push(candidate)
      }
    }

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    const accountsById = new Map(siblings.map((a) => [a._id, a]))
    return rows.map((row) =>
      legView(row, accountsById.get(row.bankAccountId) ?? null),
    )
  },
})

/**
 * Pairs two legs of the same internal transfer. `transactionId` is the leg
 * already tagged; `counterpartTransactionId` is the one chosen by hand.
 *
 * Opens the `transfers` row on the fly when the tagged leg has none — which
 * is how a row tagged before transfers became an object gets adopted without
 * any backfill.
 */
export const pairTransfer = mutation({
  args: {
    transactionId: v.id('transactions'),
    counterpartTransactionId: v.id('transactions'),
  },
  handler: async (ctx, { transactionId, counterpartTransactionId }) => {
    if (transactionId === counterpartTransactionId) {
      throw new ConvexError('transfer_same_transaction')
    }
    const { tx, user } = await requireTransaction(ctx, transactionId)
    if (tx.matchStatus !== 'internal_transfer') {
      throw new ConvexError('not_an_internal_transfer')
    }

    let transfer = await transferOf(ctx, tx)
    if (!transfer) {
      const transferId = await applyOpenTransfer(ctx, tx, user._id)
      transfer = await ctx.db.get('transfers', transferId)
      if (!transfer) throw new ConvexError('not_found')
    }

    const counterpart = await ctx.db.get(
      'transactions',
      counterpartTransactionId,
    )
    if (!counterpart) throw new ConvexError('not_found')

    await applyPairTransfer(ctx, transfer, counterpart, user._id)
    return null
  },
})

/**
 * Detaches one leg from its transfer: back to `unmatched`. The remaining leg
 * stays tagged and becomes incomplete again; the `transfers` row is deleted
 * once it has no leg left.
 */
export const unpairTransfer = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const { tx, user } = await requireTransaction(ctx, transactionId)
    await applyUnpairTransfer(ctx, tx, user._id)
    return null
  },
})
