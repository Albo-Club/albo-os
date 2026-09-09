import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember, requireOrgRole } from './lib/auth'
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
 * Attaches a bank account to ANOTHER org of the group, under the entity that
 * owns it there. One bank login can carry the accounts of several companies
 * (a Palatine access holding the current accounts of two SCIs): the Powens
 * connection stays with the org that holds the login, while each account goes
 * to its own company. `powensFeedOrgId` records that authorization — it is
 * what lets the ingestion keep writing from the other org (convex/powens.ts),
 * and unlike `powensConnectionId` it survives a reconnection.
 *
 * Refused as soon as the account is tied to something in its current org (a
 * matched transaction, a placement, a loan's direct-debit account): moving it
 * would leave those links pointing across orgs. Undo the link first.
 *
 * The transactions follow the account: their `orgId` is what every cash read,
 * the VAT position and the forecast are scoped by.
 */
export const moveAccountToOrg = mutation({
  args: {
    bankAccountId: v.id('bankAccounts'),
    targetOrgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'),
  },
  handler: async (ctx, { bankAccountId, targetOrgId, ownerCompanyId }) => {
    const account = await ctx.db.get('bankAccounts', bankAccountId)
    if (!account) throw new ConvexError('not_found')
    if (account.orgId === targetOrgId) throw new ConvexError('already_in_org')
    // Admin on BOTH sides: the account leaves one org and enters another.
    await requireOrgRole(ctx, account.orgId, 'admin')
    await requireOrgRole(ctx, targetOrgId, 'admin')

    const owner = await ctx.db.get('companies', ownerCompanyId)
    if (!owner || owner.orgId !== targetOrgId) {
      throw new ConvexError('owner_not_in_target_org')
    }
    if (!owner.kind.startsWith('group_')) {
      throw new ConvexError('owner_not_group_entity')
    }

    const transactions = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', bankAccountId))
      .collect()
    if (transactions.some((t) => t.dealId != null || t.allocation != null)) {
      throw new ConvexError('account_has_matched_transactions')
    }
    const loan = await ctx.db
      .query('loans')
      .withIndex('by_bank_account', (q) => q.eq('bankAccountId', bankAccountId))
      .first()
    if (loan) throw new ConvexError('account_used_by_loan')
    // No index on `deals.bankAccountId` — a full org scan is fine on this
    // rare admin path.
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', account.orgId))
      .collect()
    if (deals.some((d) => d.bankAccountId === bankAccountId)) {
      throw new ConvexError('account_used_by_deal')
    }

    await ctx.db.patch('bankAccounts', bankAccountId, {
      orgId: targetOrgId,
      ownerCompanyId,
      // Which org's Powens user may keep feeding this account. Cleared when
      // the account comes back home, or when nothing feeds it.
      powensFeedOrgId:
        account.powensAccountId == null ||
        (account.powensFeedOrgId ?? account.orgId) === targetOrgId
          ? undefined
          : (account.powensFeedOrgId ?? account.orgId),
    })
    for (const tx of transactions) {
      await ctx.db.patch('transactions', tx._id, { orgId: targetOrgId })
    }
    const positions = await ctx.db
      .query('investmentPositions')
      .withIndex('by_account', (q) => q.eq('bankAccountId', bankAccountId))
      .collect()
    for (const position of positions) {
      await ctx.db.patch('investmentPositions', position._id, {
        orgId: targetOrgId,
      })
    }
    return { movedTransactions: transactions.length }
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
