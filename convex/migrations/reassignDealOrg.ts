/**
 * One-off correction: re-parent a mis-tagged pending deal to another org.
 *
 * The Attio sync fixes a deal's org only at creation (a cross-org move is a
 * sensitive multi-tenant op), so correcting `albo_or_calte` in Attio does not
 * propagate on its own. This moves a still-**pending** (pre-investment) deal —
 * with its linked forecast entry, and its stub target company when that company
 * is a sync stub used only by this deal — to `orgSlug`. Refuses to move a
 * non-pending deal (post-signature = Albo OS owns it). Idempotent: a no-op if
 * the deal is already in the target org.
 *
 *   npx convex run --prod migrations/reassignDealOrg:run \
 *     '{"attioDealId":"…","orgSlug":"calte"}'
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { dealForecastKey } from '../lib/attioSync'

export const run = internalMutation({
  args: { attioDealId: v.string(), orgSlug: v.string() },
  handler: async (ctx, { attioDealId, orgSlug }) => {
    const deal = await ctx.db
      .query('deals')
      .withIndex('by_attio_deal_id', (q) => q.eq('attioDealId', attioDealId))
      .unique()
    if (!deal) throw new ConvexError('deal_not_found')
    if (deal.status !== 'pending') {
      throw new ConvexError(`deal_not_pending:${deal.status}`)
    }

    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError(`org_not_found:${orgSlug}`)
    if (org._id === deal.orgId) {
      return { moved: false as const, reason: 'already_in_org' }
    }

    const investor = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'group_root'),
      )
      .first()
    if (!investor) throw new ConvexError(`no_group_root:${orgSlug}`)

    // Target company: move the stub with the deal when it is a sync-created
    // portfolio stub used by no other deal (keeps its `attioCompanyId` anchor);
    // otherwise leave the shared company put and give the deal a fresh stub in
    // the new org (no anchor — the old company still holds it).
    const company = await ctx.db.get('companies', deal.targetCompanyId)
    const otherDeal = company
      ? await ctx.db
          .query('deals')
          .withIndex('by_org_target', (q) =>
            q.eq('orgId', deal.orgId).eq('targetCompanyId', deal.targetCompanyId),
          )
          .filter((q) => q.neq(q.field('_id'), deal._id))
          .first()
      : null
    let targetCompanyId = deal.targetCompanyId
    if (
      company &&
      company.kind === 'portfolio' &&
      company.attioCompanyId &&
      !otherDeal
    ) {
      await ctx.db.patch('companies', company._id, { orgId: org._id })
    } else {
      targetCompanyId = await ctx.db.insert('companies', {
        orgId: org._id,
        name: company?.name ?? 'Société (Attio)',
        kind: 'portfolio',
      })
    }

    await ctx.db.patch('deals', deal._id, {
      orgId: org._id,
      investorCompanyId: investor._id,
      targetCompanyId,
    })

    const entry = await ctx.db
      .query('forecastEntries')
      .withIndex('by_derivedKey', (q) =>
        q.eq('derivedKey', dealForecastKey(deal._id)),
      )
      .unique()
    if (entry) {
      await ctx.db.patch('forecastEntries', entry._id, { orgId: org._id })
    }

    return {
      moved: true as const,
      dealId: deal._id,
      targetCompanyId,
      movedEntry: entry != null,
    }
  },
})
