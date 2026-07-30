/**
 * Removal of stray organizations — self-service signups that are not Albo OS
 * investment vehicles.
 *
 * Context: Albo OS is internal (Benjamin + Clément), but creating an account
 * creates an org. Two « Indiana Bunn » orgs (slugs `indianabunn`, `indiana`)
 * appeared on 15 and 16/06/2026, created by two accounts that are neither
 * Benjamin's nor Clément's. Multi-tenancy makes them harmless — they see
 * nothing of calte/albo — but they pollute the org list and the super-admin
 * views.
 *
 * `inspect` (read-only) shows what an org holds: its members with their user
 * account, and the row count of every org-scoped table. `apply` deletes the
 * org with its memberships and its invitations, and REFUSES a protected slug
 * or an org that still holds business content — an org with data is a business
 * decision, not a cleanup.
 *
 * What this does NOT do: touch the user accounts. Deleting a login is a
 * separate decision (Better Auth side, which triggers `users:cascadeDelete`);
 * a user left without any org simply lands on the org-creation screen. Their
 * `userPrefs.lastOrgSlug` may point at the deleted slug — harmless, it
 * resolves to nothing and the app falls back.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/purgeStrayOrgs:inspect \
 *     '{"slugs":["indianabunn","indiana"]}'
 *   # STOP: check that everything is at 0 and that the members are unknown, then
 *   pnpm exec convex run --prod migrations/purgeStrayOrgs:apply '{"slug":"indianabunn"}'
 *   pnpm exec convex run --prod migrations/purgeStrayOrgs:apply '{"slug":"indiana"}'
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Never deletable: the two investment vehicles. */
const PROTECTED_SLUGS: ReadonlyArray<string> = ['calte', 'albo']

/**
 * Org-scoped tables holding business content, all reached through their
 * `by_org` index (no full scan). Child tables (`valuations`, `kpiSnapshots`,
 * `transactions`, `intercompanyLoans`…) are covered transitively: they cannot
 * exist without their parent company / deal / bank account, which is counted
 * here. `organizationMembers` and `invitations` are the org's own plumbing —
 * deleted with it, not counted as content.
 */
const CONTENT_TABLES = [
  'powensUsers',
  'powensConnections',
  'externalConnections',
  'vascoConnections',
  'vascoCommunicationsCache',
  'vascoPortfolioIssuers',
  'companies',
  'companyRelations',
  'deals',
  'dealProjections',
  'documents',
  'companyReports',
  'companyIntelligence',
  'equityPositions',
  'bankAccounts',
  'categoryRules',
  'dismissedRuleSuggestions',
  'cashAlertSettings',
  'matchingDecisions',
  'forecastRules',
  'forecastEntries',
  'todos',
] as const

/** Row count per content table, plus the `telegramAccounts` rows pointing at
 * the org (top-level `orgId`, no `by_org` index — tiny table, scanned). */
async function contentCounts(
  ctx: Ctx,
  orgId: Id<'organizations'>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of CONTENT_TABLES) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    if (rows.length > 0) counts[table] = rows.length
  }
  const telegram = (await ctx.db.query('telegramAccounts').collect()).filter(
    (r) => r.orgId === orgId,
  )
  if (telegram.length > 0) counts.telegramAccounts = telegram.length
  return counts
}

async function orgBySlug(ctx: Ctx, slug: string) {
  return ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
}

/** Read-only: who is in these orgs and what they hold. */
export const inspect = internalQuery({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }) => {
    const out = []
    for (const slug of slugs) {
      const org = await orgBySlug(ctx, slug)
      if (!org) {
        out.push({ slug, found: false as const })
        continue
      }
      const members = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org', (q) => q.eq('orgId', org._id))
        .collect()
      const invitations = await ctx.db
        .query('invitations')
        .withIndex('by_org', (q) => q.eq('orgId', org._id))
        .collect()
      const memberRows = []
      for (const member of members) {
        const user = await ctx.db.get('users', member.userId)
        const otherOrgs = user
          ? (
              await ctx.db
                .query('organizationMembers')
                .withIndex('by_user', (q) => q.eq('userId', user._id))
                .collect()
            ).filter((m) => m.orgId !== org._id).length
          : 0
        memberRows.push({
          role: member.role,
          userId: member.userId,
          email: user?.email ?? null,
          name: user?.name ?? null,
          superAdmin: user?.superAdmin ?? false,
          createdAt:
            user == null
              ? null
              : new Date(user._creationTime).toISOString().slice(0, 10),
          otherOrgs,
        })
      }
      const content = await contentCounts(ctx, org._id)
      out.push({
        slug,
        found: true as const,
        _id: org._id,
        name: org.name,
        createdAt: new Date(org._creationTime).toISOString(),
        protected: PROTECTED_SLUGS.includes(slug),
        members: memberRows,
        invitations: invitations.length,
        content,
        deletable: !PROTECTED_SLUGS.includes(slug) &&
          Object.keys(content).length === 0,
      })
    }
    return out
  },
})

/** Deletes ONE stray org: its invitations, its memberships, then the org.
 * Refuses a protected slug or an org still holding content. Idempotent (a
 * missing slug is a no-op). */
export const apply = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (PROTECTED_SLUGS.includes(slug)) {
      throw new ConvexError(`protected_org:${slug}`)
    }
    const org = await orgBySlug(ctx, slug)
    if (!org) return { deleted: false as const, reason: 'org_not_found' }

    const content = await contentCounts(ctx, org._id)
    if (Object.keys(content).length > 0) {
      // An org holding data is not a leftover — refuse rather than destroy.
      throw new ConvexError(
        `org_not_empty:${slug}:${Object.entries(content)
          .map(([t, n]) => `${t}=${n}`)
          .join(',')}`,
      )
    }

    const invitations = await ctx.db
      .query('invitations')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const invitation of invitations) {
      await ctx.db.delete('invitations', invitation._id)
    }
    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const member of members) {
      await ctx.db.delete('organizationMembers', member._id)
    }
    if (org.logoStorageId) {
      try {
        await ctx.storage.delete(org.logoStorageId)
      } catch {
        // ignore — storage may already be gone
      }
    }
    await ctx.db.delete('organizations', org._id)
    return {
      deleted: true as const,
      slug,
      name: org.name,
      removedMembers: members.length,
      removedInvitations: invitations.length,
    }
  },
})
