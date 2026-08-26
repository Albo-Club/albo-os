import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { roleValidator } from './schema'
import {
  requireAppUser,
  requireOrgMember,
  requireOrgRole,
  safeAppUser,
} from './lib/auth'
import {
  notificationKindValidator,
  readAlertPrefs,
  setAlertPref,
} from './lib/notificationPrefs'
import { MAX_SILENCE_MONTHS, MIN_SILENCE_MONTHS } from './lib/reportFreshness'
import { isLastReportIssueRecipient, reportIssueRecipients } from './lib/reportRecipients'
import { isBlockedSender } from './lib/reportSenders'
import { setLastOrgSlug } from './lib/userPrefs'
import { resolveAvatarUrl, resolveLogoUrl } from './lib/storage'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'

export const listMembers = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return await Promise.all(
      members.map(async (m) => {
        const u = await ctx.db.get('users', m.userId)
        return {
          _id: m._id,
          userId: m.userId,
          email: u?.email ?? '',
          name: u?.name ?? null,
          avatarUrl: u ? await resolveAvatarUrl(ctx, u) : null,
          role: m.role,
          joinedAt: m.joinedAt,
        }
      }),
    )
  },
})

/**
 * Alert prefs of every member of `orgId`, joined on `userId` by the settings
 * matrix. The flags are GLOBAL (one `userPrefs` row per user, applying to
 * every org they belong to); they are only surfaced through an org because
 * that is where the member list the user recognises lives.
 */
export const listAlertPrefs = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return Promise.all(
      members.map(async (m) => ({
        userId: m.userId,
        prefs: await readAlertPrefs(ctx, m.userId),
      })),
    )
  },
})

/**
 * Toggle one alert for one member. Anyone edits their own line; editing
 * someone else's needs admin. The target must be a member of `orgId` — the
 * flags being global, this membership check is what stops an admin from
 * reaching into a user they share no org with.
 */
export const setMemberAlertPref = mutation({
  args: {
    orgId: v.id('organizations'),
    userId: v.id('users'),
    kind: notificationKindValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, { orgId, userId, kind, enabled }) => {
    const me = await requireAppUser(ctx)
    if (userId === me._id) {
      await requireOrgMember(ctx, orgId)
    } else {
      await requireOrgRole(ctx, orgId, 'admin')
      const target = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', userId),
        )
        .unique()
      if (!target) throw new ConvexError('not_found')
    }
    // The report problem mails must always land somewhere: the notice a
    // forwarder gets on failure promises the team was told. Emptying the list
    // would make that a lie and lose the failure entirely.
    if (kind === 'reportIssues' && !enabled && (await isLastReportIssueRecipient(ctx, userId))) {
      throw new ConvexError('last_report_recipient')
    }

    await setAlertPref(ctx, userId, kind, enabled)
    return null
  },
})

/**
 * Who currently receives the report pipeline's problem mails, spelled out
 * under the alert matrix. Reading a column of ticks to work out whether
 * anybody is on duty is exactly how a list ends up empty without anyone
 * noticing.
 */
export const listReportIssueRecipients = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return (await reportIssueRecipients(ctx)).map((r) => ({
      userId: r.userId,
      name: r.name ?? r.email,
    }))
  },
})

// ─── Sending addresses (report forwards) ─────────────────────────────────────

/**
 * The secondary addresses each member of `orgId` may forward reports from.
 *
 * These are NOT an access filter — anyone can write to the report address and
 * the content decides whether anything is filed. They are an identity map:
 * a report forwarded from a declared address earns its sender the full
 * confirmation instead of the silence a stranger gets.
 */
export const listMemberAliases = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const out: Array<{ _id: Id<'userEmailAliases'>; userId: Id<'users'>; email: string }> = []
    for (const m of members) {
      const aliases = await ctx.db
        .query('userEmailAliases')
        .withIndex('by_user', (q) => q.eq('userId', m.userId))
        .collect()
      for (const a of aliases) out.push({ _id: a._id, userId: a.userId, email: a.email })
    }
    return out
  },
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Declare an address a member forwards from. Anyone adds their own; adding
 * one for someone else needs admin, and the target must be a member of
 * `orgId` — the aliases being global, that membership check is what stops an
 * admin from reaching into a user they share no org with.
 *
 * An address belongs to exactly one person: it is refused when it is already
 * an account address or another alias, since two owners would make "who may
 * be answered" ambiguous. The mailing group's own address is refused too — it
 * is what the loop guard drops.
 */
export const addMemberAlias = mutation({
  args: {
    orgId: v.id('organizations'),
    userId: v.id('users'),
    email: v.string(),
  },
  handler: async (ctx, { orgId, userId, email }) => {
    const me = await requireAppUser(ctx)
    if (userId === me._id) {
      await requireOrgMember(ctx, orgId)
    } else {
      await requireOrgRole(ctx, orgId, 'admin')
      const target = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) => q.eq('orgId', orgId).eq('userId', userId))
        .unique()
      if (!target) throw new ConvexError('not_found')
    }

    const normalized = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) throw new ConvexError('invalid_email')
    if (isBlockedSender(normalized, process.env.AGENTMAIL_INBOX_ID ?? '')) {
      throw new ConvexError('blocked_address')
    }

    const asAccount = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .first()
    if (asAccount) throw new ConvexError('email_taken')
    const asAlias = await ctx.db
      .query('userEmailAliases')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .first()
    if (asAlias) throw new ConvexError('email_taken')

    await ctx.db.insert('userEmailAliases', {
      userId,
      email: normalized,
      addedBy: me._id,
      addedAt: Date.now(),
    })
    return null
  },
})

/** Drop a declared address. Same rule as adding it. */
export const removeMemberAlias = mutation({
  args: { orgId: v.id('organizations'), aliasId: v.id('userEmailAliases') },
  handler: async (ctx, { orgId, aliasId }) => {
    const me = await requireAppUser(ctx)
    const alias = await ctx.db.get('userEmailAliases', aliasId)
    if (!alias) throw new ConvexError('not_found')
    if (alias.userId === me._id) {
      await requireOrgMember(ctx, orgId)
    } else {
      await requireOrgRole(ctx, orgId, 'admin')
      const target = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) => q.eq('orgId', orgId).eq('userId', alias.userId))
        .unique()
      if (!target) throw new ConvexError('not_found')
    }
    await ctx.db.delete('userEmailAliases', aliasId)
    return null
  },
})

const SLUG_RE = /^[a-z0-9-]{3,40}$/

// Reserved slugs that would clash with platform routes or have semantic
// ambiguity (`me/admin/...`). Keep this aligned with `src/routes/` top-level
// segments. If a new route is added under `app/$orgSlug/...` that uses a
// previously unreserved word, add it here.
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'register',
  'logout',
  'signin',
  'signup',
  'sign-in',
  'sign-up',
  'me',
  'settings',
  'billing',
  'invitations',
  'onboarding',
  'reset-password',
  'forgot-password',
  'verify-email',
  'accept-invite',
  'help',
  'docs',
  'support',
  'status',
  'www',
  'public',
  'static',
  'assets',
  'health',
  'about',
  'terms',
  'privacy',
  'pricing',
  'home',
  'all',
])

export const checkSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const normalized = slug.toLowerCase().trim()
    if (!SLUG_RE.test(normalized))
      return { available: false, reason: 'invalid' as const }
    if (RESERVED_SLUGS.has(normalized))
      return { available: false, reason: 'reserved' as const }
    const conflict = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', normalized))
      .unique()
    if (conflict) return { available: false, reason: 'taken' as const }
    return { available: true } as const
  },
})

export const create = mutation({
  args: { name: v.string(), slug: v.string() },
  handler: async (ctx, { name, slug }) => {
    const user = await requireAppUser(ctx)
    const normalizedSlug = slug.toLowerCase().trim()
    if (!SLUG_RE.test(normalizedSlug)) throw new ConvexError('invalid_slug')
    if (RESERVED_SLUGS.has(normalizedSlug))
      throw new ConvexError('slug_reserved')
    const trimmedName = name.trim()
    if (!trimmedName) throw new ConvexError('invalid_name')

    const conflict = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', normalizedSlug))
      .unique()
    if (conflict) throw new ConvexError('slug_taken')

    const orgId = await ctx.db.insert('organizations', {
      slug: normalizedSlug,
      name: trimmedName,
      createdBy: user._id,
      createdAt: Date.now(),
    })
    await ctx.db.insert('organizationMembers', {
      orgId,
      userId: user._id,
      role: 'owner',
      joinedAt: Date.now(),
    })
    await setLastOrgSlug(ctx, user, normalizedSlug)
    return { orgId, slug: normalizedSlug }
  },
})

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const user = await safeAppUser(ctx)
    if (!user) return null
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!org) return null
    const member = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', org._id).eq('userId', user._id),
      )
      .unique()
    if (!member) return null
    return {
      ...org,
      logoUrl: await resolveLogoUrl(ctx, org),
    }
  },
})

export const setLastOrg = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const user = await requireAppUser(ctx)
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!org) throw new ConvexError('not_found')
    await requireOrgMember(ctx, org._id)
    await setLastOrgSlug(ctx, user, slug)
    return null
  },
})

export const updateGeneral = mutation({
  args: {
    orgId: v.id('organizations'),
    name: v.string(),
    reportSilenceMonths: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, name, reportSilenceMonths }) => {
    await requireOrgRole(ctx, orgId, 'admin')
    const trimmedName = name.trim()
    if (!trimmedName) throw new ConvexError('invalid_name')
    if (
      reportSilenceMonths !== undefined &&
      (!Number.isInteger(reportSilenceMonths) ||
        reportSilenceMonths < MIN_SILENCE_MONTHS ||
        reportSilenceMonths > MAX_SILENCE_MONTHS)
    ) {
      throw new ConvexError('invalid_report_silence_months')
    }
    await ctx.db.patch('organizations', orgId, {
      name: trimmedName,
      ...(reportSilenceMonths !== undefined ? { reportSilenceMonths } : {}),
    })
    return null
  },
})

async function countOwners(
  ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
  orgId: Id<'organizations'>,
): Promise<number> {
  const members = await ctx.db
    .query('organizationMembers')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  return members.filter((m) => m.role === 'owner').length
}

export const updateMemberRole = mutation({
  args: {
    orgId: v.id('organizations'),
    memberId: v.id('organizationMembers'),
    role: roleValidator,
  },
  handler: async (ctx, { orgId, memberId, role }) => {
    const { member: acting } = await requireOrgRole(ctx, orgId, 'admin')
    const target = await ctx.db.get('organizationMembers', memberId)
    if (!target || target.orgId !== orgId) throw new ConvexError('not_found')

    if (target.role === 'owner' || role === 'owner') {
      if (acting.role !== 'owner') throw new ConvexError('owner_only')
    }
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await countOwners(ctx, orgId)
      if (owners <= 1) throw new ConvexError('last_owner')
    }
    if (target.role === role) return null
    await ctx.db.patch('organizationMembers', memberId, { role })
    return null
  },
})

export const removeMember = mutation({
  args: {
    orgId: v.id('organizations'),
    memberId: v.id('organizationMembers'),
  },
  handler: async (ctx, { orgId, memberId }) => {
    const { user, member: acting } = await requireOrgRole(ctx, orgId, 'admin')
    const target = await ctx.db.get('organizationMembers', memberId)
    if (!target || target.orgId !== orgId) throw new ConvexError('not_found')
    if (target.role === 'owner') {
      if (acting.role !== 'owner') throw new ConvexError('owner_only')
      const owners = await countOwners(ctx, orgId)
      if (owners <= 1) throw new ConvexError('last_owner')
    }
    if (target.userId === user._id && acting.role === 'owner') {
      const owners = await countOwners(ctx, orgId)
      if (owners <= 1) throw new ConvexError('last_owner')
    }
    await ctx.db.delete('organizationMembers', memberId)
    return null
  },
})
