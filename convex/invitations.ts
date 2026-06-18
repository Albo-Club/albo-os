import { ConvexError, v } from 'convex/values'
import { internalQuery, mutation, query } from './_generated/server'
import { components } from './_generated/api'
import { invitationRoleValidator } from './schema'
import { provisionAppUser, requireOrgRole } from './lib/auth'
import { setLastOrgSlug } from './lib/userPrefs'
import { RESEND_FROM, resend } from './email'
import { invitationEmail } from './emailTemplates'
import { consumeLimit } from './rateLimiters'
import type { FunctionReference } from 'convex/server'

const TOKEN_BYTES = 32
const EXPIRES_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function genToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const create = mutation({
  args: {
    orgId: v.id('organizations'),
    email: v.string(),
    role: invitationRoleValidator,
  },
  handler: async (ctx, { orgId, email, role }) => {
    const { user: inviter } = await requireOrgRole(ctx, orgId, 'admin')
    await consumeLimit(ctx, 'invitationCreate', inviter._id)
    const org = await ctx.db.get('organizations', orgId)
    if (!org) throw new ConvexError('not_found')

    const normalizedEmail = email.toLowerCase().trim()
    if (!EMAIL_RE.test(normalizedEmail)) {
      throw new ConvexError('invalid_email')
    }

    const existing = await ctx.db
      .query('invitations')
      .withIndex('by_email_and_org', (q) =>
        q.eq('email', normalizedEmail).eq('orgId', orgId),
      )
      .filter((q) => q.eq(q.field('acceptedAt'), undefined))
      .first()
    if (existing) throw new ConvexError('already_invited')

    const token = genToken()
    const invId = await ctx.db.insert('invitations', {
      orgId,
      email: normalizedEmail,
      role,
      token,
      invitedBy: inviter._id,
      expiresAt: Date.now() + EXPIRES_MS,
    })

    const siteUrl = process.env.SITE_URL!
    const acceptUrl = `${siteUrl}/accept-invite/${token}`
    const inviterName = inviter.name ?? inviter.email
    // Prefer the recipient's stored language; fall back to the inviter's so
    // the invite at least matches the sender's locale, then English.
    const recipient = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalizedEmail))
      .first()
    const locale =
      recipient?.preferredLanguage ?? inviter.preferredLanguage ?? 'en'
    const { subject, html, text } = invitationEmail({
      locale,
      inviterName,
      orgName: org.name,
      acceptUrl,
    })
    await resend.sendEmail(ctx, {
      from: RESEND_FROM,
      to: normalizedEmail,
      subject,
      html,
      text,
      replyTo: [inviter.email],
    })
    return invId
  },
})

/**
 * Public preview of an invitation by token. The token itself authenticates
 * access — no auth required. Returns minimal info so the accept page can
 * branch its UI between sign-in / sign-up / switch-account.
 */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const inv = await ctx.db
      .query('invitations')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique()
    if (!inv) return { kind: 'not_found' as const }
    if (inv.acceptedAt) return { kind: 'already_accepted' as const }
    if (inv.expiresAt < Date.now()) return { kind: 'expired' as const }

    const org = await ctx.db.get('organizations', inv.orgId)
    if (!org) return { kind: 'not_found' as const }

    const adapter = (
      components as unknown as {
        betterAuth: {
          adapter: {
            findMany: FunctionReference<'query', 'internal'>
          }
        }
      }
    ).betterAuth.adapter
    const result = (await ctx.runQuery(adapter.findMany, {
      model: 'user',
      paginationOpts: { numItems: 1, cursor: null },
      where: [{ field: 'email', operator: 'eq', value: inv.email }],
    })) as { page: Array<{ email?: string }> }
    const accountExists = result.page.length > 0

    return {
      kind: 'ok' as const,
      email: inv.email,
      role: inv.role,
      orgName: org.name,
      accountExists,
    }
  },
})

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await provisionAppUser(ctx)
    const inv = await ctx.db
      .query('invitations')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique()
    if (!inv) throw new ConvexError('not_found')

    const org = await ctx.db.get('organizations', inv.orgId)
    if (!org) throw new ConvexError('not_found')

    // Case-insensitive, whitespace-tolerant match on both sides. `inv.email`
    // is normalized at creation; the BA-sourced user email may carry casing,
    // so normalize it too — casing must never block a legitimate accept.
    if (inv.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new ConvexError('email_mismatch')
    }

    const existingMember = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', inv.orgId).eq('userId', user._id),
      )
      .unique()

    // Idempotent replay: the user is already in the org (e.g. the accept
    // effect fired twice, or they reopened the link). Reconcile a missing
    // acceptedAt stamp and succeed — never throw on a benign re-accept.
    if (existingMember) {
      if (!inv.acceptedAt) {
        await ctx.db.patch('invitations', inv._id, { acceptedAt: Date.now() })
      }
      await setLastOrgSlug(ctx, user, org.slug)
      return { orgSlug: org.slug }
    }

    // First-time accept: the invitation must still be live.
    if (inv.acceptedAt) throw new ConvexError('already_accepted')
    if (inv.expiresAt < Date.now()) throw new ConvexError('expired')

    await ctx.db.insert('organizationMembers', {
      orgId: inv.orgId,
      userId: user._id,
      role: inv.role,
      joinedAt: Date.now(),
    })
    await ctx.db.patch('invitations', inv._id, { acceptedAt: Date.now() })
    await setLastOrgSlug(ctx, user, org.slug)
    return { orgSlug: org.slug }
  },
})

/**
 * Internal — is this invitation token valid for a brand-new signup of `email`?
 * True only when the token resolves to a still-pending, unexpired invitation
 * whose recipient email matches (case-insensitive, trimmed). Used by the
 * Better Auth `user.create.before` hook in `convex/auth.ts` to skip email
 * verification for invited signups: following the signed, single-use
 * invitation link already proves inbox possession. Token-gated — merely
 * knowing an invited email is not enough to bypass verification.
 */
export const validateInviteForSignup = internalQuery({
  args: { token: v.string(), email: v.string() },
  handler: async (ctx, { token, email }): Promise<boolean> => {
    const inv = await ctx.db
      .query('invitations')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique()
    if (!inv) return false
    if (inv.acceptedAt) return false
    if (inv.expiresAt < Date.now()) return false
    return inv.email.trim().toLowerCase() === email.trim().toLowerCase()
  },
})

export const revoke = mutation({
  args: { invitationId: v.id('invitations') },
  handler: async (ctx, { invitationId }) => {
    const inv = await ctx.db.get('invitations', invitationId)
    if (!inv) throw new ConvexError('not_found')
    await requireOrgRole(ctx, inv.orgId, 'admin')
    if (inv.acceptedAt) throw new ConvexError('already_accepted')
    await ctx.db.delete('invitations', invitationId)
    return null
  },
})

export const listForOrg = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgRole(ctx, orgId, 'admin')
    const invs = await ctx.db
      .query('invitations')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return invs
      .filter((i) => !i.acceptedAt)
      .map((i) => ({
        _id: i._id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
      }))
  },
})
