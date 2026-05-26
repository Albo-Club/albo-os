import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
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
 * Transactions d'un compte **liées à un deal** (`dealId` rempli), en ordre
 * antéchronologique (plus récente d'abord). Chaque ligne est labellisée par la
 * boîte investie du deal. Le check d'org dérive du compte.
 */
export const listAccountDealTransactions = query({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get(bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) =>
        q.eq('bankAccountId', bankAccountId),
      )
      .order('desc')
      .take(TX_LIMIT)
    const linked = rows.filter((t) => t.dealId != null)

    return await Promise.all(
      linked.map(async (t) => {
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
