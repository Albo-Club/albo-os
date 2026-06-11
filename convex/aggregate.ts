/**
 * Cross-org aggregated view (read-only). Union of the deals of ALL
 * organizations the current user is a member of. A new org shows up
 * automatically (the authorization boundary = the memberships).
 *
 * No mutations here: editing happens in the per-org view.
 */

import { query } from './_generated/server'
import { lastValuationCents, transactionTotals } from './deals'
import { requireAppUser } from './lib/auth'
import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel>

function companyRef(c: Doc<'companies'> | null) {
  if (!c) return null
  return {
    _id: c._id,
    name: c.name,
    kind: c.kind,
    sector: c.sector ?? null,
    totalShares: c.totalShares ?? null,
  }
}

async function enrich(
  ctx: Ctx,
  deal: Doc<'deals'>,
  org: { _id: Doc<'organizations'>['_id']; name: string; slug: string },
) {
  const [investor, target, spv] = await Promise.all([
    ctx.db.get("companies", deal.investorCompanyId),
    ctx.db.get("companies", deal.targetCompanyId),
    deal.viaSpvCompanyId ? ctx.db.get("companies", deal.viaSpvCompanyId) : null,
  ])
  return {
    ...deal,
    org,
    investor: companyRef(investor),
    target: companyRef(target),
    spv: companyRef(spv),
    // Versé / Reçu (paid out / received) computed from the transactions (cf. deals.transactionTotals)
    ...(await transactionTotals(ctx, deal._id)),
    lastValuationCents: await lastValuationCents(ctx, deal._id),
  }
}

/** All deals across all my orgs, enriched and tagged by org. */
export const listDeals = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAppUser(ctx)
    const memberships = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const perOrg = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get("organizations", m.orgId)
        if (!org) return []
        const tag = { _id: org._id, name: org.name, slug: org.slug }
        const deals = await ctx.db
          .query('deals')
          .withIndex('by_org', (q) => q.eq('orgId', m.orgId))
          .collect()
        return Promise.all(deals.map((dd) => enrich(ctx, dd, tag)))
      }),
    )

    return perOrg
      .flat()
      .sort((a, b) => (b.signedDate ?? 0) - (a.signedDate ?? 0))
  },
})
