import { mutation, query } from './_generated/server'
import { authComponent } from './auth'
import { provisionAppUser, safeAppUser } from './lib/auth'

export const me = query({
  args: {},
  handler: async (ctx) => {
    const baUser = await authComponent.safeGetAuthUser(ctx)
    if (!baUser) return { kind: 'unauthenticated' as const }

    const user = await safeAppUser(ctx)
    if (!user) {
      return {
        kind: 'unprovisioned' as const,
        baUser: {
          id: baUser._id,
          email: baUser.email,
          name: baUser.name ?? null,
        },
      }
    }

    const memberships = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const orgs = (
      await Promise.all(
        memberships.map(async (m) => {
          const org = await ctx.db.get(m.orgId)
          if (!org) return null
          return {
            _id: org._id,
            slug: org.slug,
            name: org.name,
            logoUrl: org.logoUrl ?? null,
            role: m.role,
          }
        }),
      )
    ).filter((o): o is NonNullable<typeof o> => o !== null)

    return {
      kind: 'ready' as const,
      user: {
        _id: user._id,
        email: user.email,
        name: user.name ?? null,
        avatarUrl: user.avatarUrl ?? null,
        superAdmin: user.superAdmin,
        lastOrgSlug: user.lastOrgSlug ?? null,
      },
      orgs,
    }
  },
})

export const provisionMe = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await provisionAppUser(ctx)
    return user._id
  },
})
