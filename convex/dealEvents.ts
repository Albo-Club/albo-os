import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import type { Id } from './_generated/dataModel'

/** Rows served to the company sheet — enough for "see more" without paging. */
const LIMIT = 100

/**
 * The activity journal of a company's deals, newest first: who did what,
 * when. Actor names and deal titles are resolved here (a handful of users
 * and deals per company) so the sheet renders rows without a second query.
 * The write side, and the one-event-per-call rule, live in
 * `convex/lib/dealEvents.ts`.
 */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const rows = await ctx.db
      .query('dealEvents')
      .withIndex('by_company_at', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(LIMIT)

    const names = new Map<Id<'users'>, string>()
    const deals = new Map<
      Id<'deals'>,
      { _id: Id<'deals'>; name?: string; instrumentKind: string } | null
    >()
    for (const row of rows) {
      if (row.actor.kind === 'user' && !names.has(row.actor.userId)) {
        const u = await ctx.db.get('users', row.actor.userId)
        names.set(row.actor.userId, u?.name ?? u?.email ?? '?')
      }
      if (!deals.has(row.dealId)) {
        const d = await ctx.db.get('deals', row.dealId)
        deals.set(
          row.dealId,
          d
            ? { _id: d._id, name: d.name, instrumentKind: d.instrumentKind }
            : null,
        )
      }
    }

    return rows.map((row) => ({
      _id: row._id,
      at: row.at,
      actor:
        row.actor.kind === 'user'
          ? {
              kind: 'user' as const,
              name: names.get(row.actor.userId) ?? '?',
              viaAgent: row.actor.viaAgent ?? false,
            }
          : { kind: row.actor.kind },
      event: row.event,
      deal: deals.get(row.dealId) ?? null,
    }))
  },
})
