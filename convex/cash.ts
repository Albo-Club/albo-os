import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { isListedAccount } from './lib/bankAccounts'
import { normalizeSearch } from './lib/searchText'
import type { Doc } from './_generated/dataModel'

/** Reasonable cap for an account's transaction list. */
const TX_LIMIT = 200

function ownerRef(c: Doc<'companies'> | null) {
  if (!c) return null
  return { _id: c._id, name: c.name, kind: c.kind }
}

/**
 * Bank accounts (non-archived) of an org, enriched with their owning
 * entity (`group_*`). Grouping by entity and the total are done UI-side.
 * Serves the per-org Cash view.
 */
export const listAccounts = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const active = accounts.filter(isListedAccount)
    return await Promise.all(
      active.map(async (a) => {
        const owner = await ctx.db.get("companies", a.ownerCompanyId)
        return {
          _id: a._id,
          bankName: a.bankName,
          label: a.label,
          displayName: a.displayName ?? null,
          accountKind: a.accountKind ?? null,
          currency: a.currency,
          currentBalance: a.currentBalance ?? null,
          balanceAsOf: a.balanceAsOf ?? null,
          accountStatus: a.accountStatus ?? 'active',
          pledged: a.pledged ?? false,
          // Powens-synced accounts refresh their balance on webhook; the
          // others expose a manual balance edit (updateAccountBalance).
          isConnected: a.powensAccountId != null,
          owner: ownerRef(owner),
        }
      }),
    )
  },
})

/**
 * A bank account (with its owning entity), for the detail page.
 * The org check derives from the account.
 */
export const getAccount = query({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get("bankAccounts", bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    const owner = await ctx.db.get("companies", account.ownerCompanyId)
    return {
      _id: account._id,
      bankName: account.bankName,
      label: account.label,
      displayName: account.displayName ?? null,
      accountKind: account.accountKind ?? null,
      iban: account.iban ?? null,
      currency: account.currency,
      currentBalance: account.currentBalance ?? null,
      balanceAsOf: account.balanceAsOf ?? null,
      accountStatus: account.accountStatus ?? 'active',
      pledged: account.pledged ?? false,
      isConnected: account.powensAccountId != null,
      owner: ownerRef(owner),
    }
  },
})

/**
 * Qualifies an account: lifecycle (`active` / `closed`) and pledge flag
 * (nantissement / blocked funds). Never deletes anything — a closed account
 * keeps its full transaction history (deals still reference it); it simply
 * leaves the available balance (convex/lib/bankAccounts.ts).
 */
export const updateAccountSettings = mutation({
  args: {
    bankAccountId: v.id('bankAccounts'),
    accountStatus: v.union(v.literal('active'), v.literal('closed')),
    pledged: v.boolean(),
  },
  handler: async (ctx, { bankAccountId, accountStatus, pledged }) => {
    const account = await ctx.db.get('bankAccounts', bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    await ctx.db.patch('bankAccounts', bankAccountId, {
      accountStatus: accountStatus === 'active' ? undefined : accountStatus,
      pledged: pledged ? true : undefined,
    })
    return bankAccountId
  },
})

/**
 * Manual balance entry for a NON-connected account (no `powensAccountId`) —
 * Wormser, Neuflize… whose balances would otherwise go stale silently.
 * Refused on a Powens-synced account: the webhook is the source of truth
 * there and would overwrite the manual value at the next sync anyway.
 * `balanceAsOf` is stamped now so the UI can show how fresh the figure is.
 */
export const updateAccountBalance = mutation({
  args: {
    bankAccountId: v.id('bankAccounts'),
    currentBalance: v.number(), // cents; may be negative (overdraft)
  },
  handler: async (ctx, { bankAccountId, currentBalance }) => {
    const account = await ctx.db.get('bankAccounts', bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    if (account.powensAccountId != null) {
      throw new ConvexError('account_connected')
    }
    if (!Number.isInteger(currentBalance)) {
      throw new ConvexError('invalid_amount')
    }
    await ctx.db.patch('bankAccounts', bankAccountId, {
      currentBalance,
      balanceAsOf: Date.now(),
    })
    return bankAccountId
  },
})

/**
 * Renames a bank account (custom name `displayName`).
 * Targeted patch: NEVER touches `label` (original import/bank name) nor
 * `bankName`. '' = clears the field → display falls back to `label`.
 */
export const updateAccountName = mutation({
  args: {
    bankAccountId: v.id('bankAccounts'),
    displayName: v.string(),
  },
  handler: async (ctx, { bankAccountId, displayName }) => {
    const account = await ctx.db.get('bankAccounts', bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    const trimmed = displayName.trim()
    await ctx.db.patch('bankAccounts', bankAccountId, {
      displayName: trimmed === '' ? undefined : trimmed,
    })
    return bankAccountId
  },
})

/**
 * Transactions of an account, in reverse chronological order (most recent
 * first). When a transaction is attached to a deal, it is labelled with the
 * invested company (`deal` otherwise `null`). The org check derives from
 * the account.
 *
 * `search` (optional) filters by label/counterparty via the `search_text`
 * search index (case/accent insensitive). Search results come sorted by
 * relevance → re-sort by date to keep the usual display.
 */
export const listAccountTransactions = query({
  args: {
    bankAccountId: v.id('bankAccounts'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { bankAccountId, search }) => {
    const account = await ctx.db.get("bankAccounts", bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)

    const term = search ? normalizeSearch(search) : ''
    const rows = term
      ? await ctx.db
          .query('transactions')
          .withSearchIndex('search_text', (q) =>
            q.search('searchText', term).eq('bankAccountId', bankAccountId),
          )
          .take(TX_LIMIT)
      : await ctx.db
          .query('transactions')
          .withIndex('by_account_date', (q) =>
            q.eq('bankAccountId', bankAccountId),
          )
          .order('desc')
          .take(TX_LIMIT)
    if (term) rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (t) => {
        const deal = t.dealId ? await ctx.db.get("deals", t.dealId) : null
        const target = deal ? await ctx.db.get("companies", deal.targetCompanyId) : null
        return {
          _id: t._id,
          direction: t.direction,
          amount: t.amount,
          transactionDate: t.transactionDate,
          rawLabel: t.rawLabel,
          counterparty: t.counterparty ?? null,
          reconciled: t.reconciled,
          deal: deal
            ? { _id: deal._id, targetName: target?.name ?? null }
            : null,
        }
      }),
    )
  },
})
