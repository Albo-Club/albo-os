import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { components } from './_generated/api'

/**
 * One-shot dev cleanup. Run via:
 *   pnpm exec convex run admin:purgeExcept '{"keepEmail":"x@y.com"}'
 *
 * Nukes:
 *  - All Convex app data except the matching user (and their org memberships are also nuked — orgs are wiped fully)
 *  - All Better Auth users (and dependent sessions/accounts via cascade in the BA component) except the matching one
 */
export const purgeExcept = internalMutation({
  args: { keepEmail: v.string() },
  handler: async (ctx, { keepEmail }) => {
    const target = keepEmail.toLowerCase().trim()

    for (const table of [
      'invitations',
      'organizationMembers',
      'organizations',
    ] as const) {
      const rows = await ctx.db.query(table).collect()
      for (const r of rows) await ctx.db.delete(r._id)
    }

    let keptConvexUserId: string | null = null
    const users = await ctx.db.query('users').collect()
    for (const u of users) {
      if (u.email.toLowerCase() === target) {
        keptConvexUserId = u._id
        await ctx.db.patch(u._id, { lastOrgSlug: undefined })
      } else {
        await ctx.db.delete(u._id)
      }
    }

    let cursor: string | null = null
    let baDeleted = 0
    const adapter = (
      components as unknown as {
        betterAuth: {
          adapter: {
            findMany: import('convex/server').FunctionReference<
              'query',
              'internal'
            >
            deleteOne: import('convex/server').FunctionReference<
              'mutation',
              'internal'
            >
          }
        }
      }
    ).betterAuth.adapter

    while (true) {
      const result = (await ctx.runQuery(adapter.findMany, {
        model: 'user',
        paginationOpts: { numItems: 100, cursor },
      })) as {
        page: Array<{ _id: string; email?: string }>
        isDone: boolean
        continueCursor: string
      }
      for (const u of result.page) {
        if ((u.email ?? '').toLowerCase() !== target) {
          await ctx.runMutation(adapter.deleteOne, {
            input: {
              model: 'user',
              where: [{ field: '_id', operator: 'eq', value: u._id }],
            },
          })
          baDeleted += 1
        }
      }
      if (result.isDone) break
      cursor = result.continueCursor
    }

    return {
      keptConvexUserId,
      baUsersDeleted: baDeleted,
    }
  },
})
