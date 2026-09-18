/**
 * Links between organizations for the bank feed (`powensFeedGrants`).
 *
 * "The bank connections of CALTE may feed accounts of SCI Chapelle": one row,
 * declared once by an admin of both orgs, visible from both sides, removable
 * as long as nothing depends on it. It is the only thing that lets a Powens
 * user write outside its own org (cf. `convex/powens.ts:resolveAccount`) and
 * the only thing that lets an account be attached to another org
 * (`cash.moveAccountToOrg`). Read helpers live in `convex/lib/feedGrants.ts`.
 */
import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember, requireOrgRole } from './lib/auth'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

type OrgRef = { _id: Id<'organizations'>; name: string; slug: string }

async function orgRef(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
): Promise<OrgRef | null> {
  const org = await ctx.db.get('organizations', orgId)
  return org ? { _id: org._id, name: org.name, slug: org.slug } : null
}

/** Both directions of an org's links: the orgs it feeds, and the orgs that
 * feed it. Feeds the Réglages → Intégrations card and the account move
 * dialog. */
export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const feeding = await ctx.db
      .query('powensFeedGrants')
      .withIndex('by_feed', (q) => q.eq('feedOrgId', orgId))
      .collect()
    const fedBy = await ctx.db
      .query('powensFeedGrants')
      .withIndex('by_host', (q) => q.eq('hostOrgId', orgId))
      .collect()
    const shape = async (
      rows: Array<Doc<'powensFeedGrants'>>,
      pick: (r: Doc<'powensFeedGrants'>) => Id<'organizations'>,
    ) => {
      const out: Array<{ _id: Id<'powensFeedGrants'>; org: OrgRef }> = []
      for (const r of rows) {
        const org = await orgRef(ctx, pick(r))
        if (org) out.push({ _id: r._id, org })
      }
      return out
    }
    return {
      feeding: await shape(feeding, (r) => r.hostOrgId),
      fedBy: await shape(fedBy, (r) => r.feedOrgId),
    }
  },
})

/** Declares that the bank connections of `feedOrgId` may feed accounts of
 * `hostOrgId`. Admin on BOTH sides: one org opens its feed, the other opens
 * its books. */
export const create = mutation({
  args: {
    feedOrgId: v.id('organizations'),
    hostOrgId: v.id('organizations'),
  },
  handler: async (ctx, { feedOrgId, hostOrgId }) => {
    if (feedOrgId === hostOrgId) throw new ConvexError('same_org')
    const { user } = await requireOrgRole(ctx, feedOrgId, 'admin')
    await requireOrgRole(ctx, hostOrgId, 'admin')
    const existing = await ctx.db
      .query('powensFeedGrants')
      .withIndex('by_feed_and_host', (q) =>
        q.eq('feedOrgId', feedOrgId).eq('hostOrgId', hostOrgId),
      )
      .unique()
    if (existing) throw new ConvexError('already_linked')
    return await ctx.db.insert('powensFeedGrants', {
      feedOrgId,
      hostOrgId,
      createdBy: user._id,
      createdAt: Date.now(),
    })
  },
})

/** Removes a link. Refused while an account of the host org is still fed by
 * a connection of the feed org: the ingestion would start ignoring it
 * silently. Attach the account back (or archive it) first. */
export const remove = mutation({
  args: { grantId: v.id('powensFeedGrants') },
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get('powensFeedGrants', grantId)
    if (!grant) throw new ConvexError('not_found')
    await requireOrgRole(ctx, grant.feedOrgId, 'admin')
    await requireOrgRole(ctx, grant.hostOrgId, 'admin')

    const connections = await ctx.db
      .query('powensConnections')
      .withIndex('by_org', (q) => q.eq('orgId', grant.feedOrgId))
      .collect()
    const feedConnectionIds = new Set(connections.map((c) => c.powensConnectionId))
    const hosted = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', grant.hostOrgId))
      .collect()
    const inUse = hosted.filter(
      (a) =>
        !a.archivedAt &&
        a.powensConnectionId != null &&
        feedConnectionIds.has(a.powensConnectionId),
    )
    if (inUse.length > 0) {
      throw new ConvexError(`grant_in_use:${inUse.length}`)
    }
    await ctx.db.delete('powensFeedGrants', grantId)
  },
})
