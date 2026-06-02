import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { normalizeSearch } from './lib/searchText'
import type { Doc } from './_generated/dataModel'

/** Borne raisonnable pour la liste de transactions d'un compte. */
const TX_LIMIT = 200

function ownerRef(c: Doc<'companies'> | null) {
  if (!c) return null
  return { _id: c._id, name: c.name, kind: c.kind }
}

/**
 * Comptes bancaires (non archivés) d'une org, enrichis de leur entité
 * propriétaire (`group_*`). Le regroupement par entité et le total se font
 * côté UI. Sert la vue Cash par-org.
 */
export const listAccounts = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const active = accounts.filter((a) => !a.archivedAt)
    return await Promise.all(
      active.map(async (a) => {
        const owner = await ctx.db.get(a.ownerCompanyId)
        return {
          _id: a._id,
          bankName: a.bankName,
          label: a.label,
          displayName: a.displayName ?? null,
          accountKind: a.accountKind ?? null,
          currency: a.currency,
          currentBalance: a.currentBalance ?? null,
          balanceAsOf: a.balanceAsOf ?? null,
          owner: ownerRef(owner),
        }
      }),
    )
  },
})

/**
 * Un compte bancaire (avec son entité propriétaire), pour la page détail.
 * Le check d'org dérive du compte.
 */
export const getAccount = query({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get(bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    const owner = await ctx.db.get(account.ownerCompanyId)
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
      owner: ownerRef(owner),
    }
  },
})

/**
 * Renomme un compte bancaire (nom personnalisé `displayName`).
 * Patch ciblé : ne touche JAMAIS `label` (nom d'origine import/banque) ni
 * `bankName`. '' = effacement → l'affichage retombe sur `label`.
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
 * Transactions d'un compte, en ordre antéchronologique (plus récente d'abord).
 * Quand une transaction est rattachée à un deal, elle est labellisée par la
 * boîte investie (`deal` sinon `null`). Le check d'org dérive du compte.
 *
 * `search` (optionnel) filtre par libellé/contrepartie via le search index
 * `search_text` (insensible casse/accents). Les résultats search arrivent
 * triés par pertinence → re-tri par date pour garder l'affichage habituel.
 */
export const listAccountTransactions = query({
  args: {
    bankAccountId: v.id('bankAccounts'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { bankAccountId, search }) => {
    const account = await ctx.db.get(bankAccountId)
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
        const deal = t.dealId ? await ctx.db.get(t.dealId) : null
        const target = deal ? await ctx.db.get(deal.targetCompanyId) : null
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
