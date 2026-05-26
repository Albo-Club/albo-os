/**
 * Vue agrégée cross-org (lecture seule). Union des deals de TOUTES les
 * organisations dont l'utilisateur courant est membre. Une nouvelle org
 * apparaît d'office (la frontière d'autorisation = les memberships).
 *
 * Pas de mutation ici : l'édition se fait dans la vue par-org.
 */

import { query } from './_generated/server'
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
    totalShares: c.totalShares ?? null,
  }
}

async function enrich(
  ctx: Ctx,
  deal: Doc<'deals'>,
  org: { _id: Doc<'organizations'>['_id']; name: string; slug: string },
) {
  const [investor, target, spv] = await Promise.all([
    ctx.db.get(deal.investorCompanyId),
    ctx.db.get(deal.targetCompanyId),
    deal.viaSpvCompanyId ? ctx.db.get(deal.viaSpvCompanyId) : null,
  ])
  return {
    ...deal,
    org,
    investor: companyRef(investor),
    target: companyRef(target),
    spv: companyRef(spv),
  }
}

/** Tous les deals de toutes mes orgs, enrichis et taggés par org. */
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
        const org = await ctx.db.get(m.orgId)
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
