import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

/**
 * Transactions rattachées à un deal (rapprochement via `dealId`), triées par
 * date décroissante et enrichies du compte bancaire. Scopé à l'org du deal.
 */
export const listByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get(dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get(tx.bankAccountId)
        return {
          _id: tx._id,
          direction: tx.direction,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          reconciled: tx.reconciled,
          account: account
            ? { label: account.label, bankName: account.bankName }
            : null,
        }
      }),
    )
  },
})
