/**
 * Internal queries backing the MCP server (convex/mcp/server.ts).
 *
 * The MCP endpoint authenticates via OAuth bearer tokens (no Convex auth
 * identity), so — like the agent tools — every query takes an explicit
 * `actorUserId` and re-verifies org membership via `readMembership`.
 */

import { ConvexError, v } from 'convex/values'

import { internalQuery } from '../_generated/server'
import { readMembership } from '../lib/agentScope'
import type { Id } from '../_generated/dataModel'

/**
 * Maps a Better Auth user to our app `users` row. Mirrors the dedup strategy
 * of `provisionAppUser` (convex/lib/auth.ts): lookup by `betterAuthId` first,
 * then fall back to email (covers BA-side account linking). Read-only — the
 * row is healed by `provisionAppUser` on the next in-app login.
 */
export const resolveActor = internalQuery({
  args: {
    betterAuthId: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { betterAuthId, email }) => {
    if (betterAuthId) {
      const byId = await ctx.db
        .query('users')
        .withIndex('by_betterAuthId', (q) => q.eq('betterAuthId', betterAuthId))
        .unique()
      if (byId) return byId._id
    }
    if (email) {
      const byEmail = await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', email))
        .first()
      if (byEmail) return byEmail._id
    }
    return null
  },
})

/** Resolves an org slug to its id, enforcing the caller's membership. */
export const resolveOrg = internalQuery({
  args: {
    slug: v.string(),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { slug, actorUserId }): Promise<Id<'organizations'>> => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    await readMembership(ctx, org._id, actorUserId)
    return org._id
  },
})

/** Orgs the actor belongs to — powers the `listOrgs` MCP tool. */
export const listOrgsForUser = internalQuery({
  args: {
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { actorUserId }) => {
    const memberships = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', actorUserId))
      .take(50)
    const orgs = await Promise.all(
      memberships.map(async (member) => {
        const org = await ctx.db.get('organizations', member.orgId)
        return org
          ? { slug: org.slug, name: org.name, role: member.role }
          : null
      }),
    )
    return orgs.filter((org) => org !== null)
  },
})
