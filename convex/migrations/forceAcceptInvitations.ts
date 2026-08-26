/**
 * Force-accept pending invitations — join an org on behalf of the invitee,
 * without the invitation email round-trip.
 *
 * Context: an invitation is normally consumed by its recipient clicking the
 * link (`invitations:accept`), which requires them to be signed in with the
 * invited address. When that round-trip cannot happen (mail never arrived,
 * link lost, recipient signed in under another address), the membership can
 * be created directly from the invitation already recorded in the org.
 *
 * Hard limit: this can NOT create a login. A `users` row must already exist
 * for the invited address — i.e. the person has signed in at least once with
 * it. Minting a Better Auth account here would produce duplicate users for
 * the same person (cf. KNOWN_ISSUES.md « Account linking & verified email »),
 * so an address without an account is reported as `no_account` and skipped.
 *
 * Scope: it forces an EXISTING invitation, it does not invent memberships —
 * an address with no invitation row for that org is reported `no_invitation`.
 * The invitation's role is what the membership gets. An expired invitation is
 * accepted anyway (that is what forcing means) and flagged in the outcome.
 * Idempotent: a re-run reports `already_member` and reconciles a missing
 * `acceptedAt` stamp, exactly like the idempotent replay in
 * `invitations:accept`.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/forceAcceptInvitations:inspect \
 *     '{"orgSlug":"albo","emails":["clement@morning.fr"]}'
 *   # STOP: check `willJoin` on every line, then
 *   pnpm exec convex run --prod migrations/forceAcceptInvitations:apply \
 *     '{"orgSlug":"albo","emails":["clement@morning.fr"]}'
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { normalizeEmail } from '../lib/invitations'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

async function orgBySlug(ctx: Ctx, slug: string) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${slug}`)
  return org
}

/** The three rows that decide the outcome for one invited address. */
async function resolve(ctx: Ctx, orgId: Id<'organizations'>, email: string) {
  const normalized = normalizeEmail(email)
  const user = await ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', normalized))
    .first()
  const invitation = await ctx.db
    .query('invitations')
    .withIndex('by_email_and_org', (q) =>
      q.eq('email', normalized).eq('orgId', orgId),
    )
    .first()
  const member = user
    ? await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', user._id),
        )
        .unique()
    : null
  return { normalized, user, invitation, member }
}

/** Read-only: what `apply` would do for each address, and why. */
export const inspect = internalQuery({
  args: { orgSlug: v.string(), emails: v.array(v.string()) },
  handler: async (ctx, { orgSlug, emails }) => {
    const org = await orgBySlug(ctx, orgSlug)
    const now = Date.now()
    const rows = []
    for (const email of emails) {
      const { normalized, user, invitation, member } = await resolve(
        ctx,
        org._id,
        email,
      )
      rows.push({
        email: normalized,
        account: user ? { _id: user._id, name: user.name ?? null } : null,
        alreadyMember: member ? member.role : null,
        invitation: invitation
          ? {
              role: invitation.role,
              expired: invitation.expiresAt < now,
              acceptedAt: invitation.acceptedAt ?? null,
            }
          : null,
        willJoin:
          user == null
            ? 'no_account'
            : member
              ? 'already_member'
              : invitation == null
                ? 'no_invitation'
                : `join_as:${invitation.role}`,
      })
    }
    return { org: { _id: org._id, slug: org.slug, name: org.name }, rows }
  },
})

/** Creates the memberships and stamps the invitations. Skips (without
 * throwing) an address with no account or no invitation, so one bad line
 * does not block the others — the reason is in the returned row. */
export const apply = internalMutation({
  args: { orgSlug: v.string(), emails: v.array(v.string()) },
  handler: async (ctx, { orgSlug, emails }) => {
    const org = await orgBySlug(ctx, orgSlug)
    const now = Date.now()
    const rows = []
    for (const email of emails) {
      const { normalized, user, invitation, member } = await resolve(
        ctx,
        org._id,
        email,
      )
      if (!user) {
        rows.push({ email: normalized, outcome: 'no_account' as const })
        continue
      }
      if (member) {
        if (invitation && !invitation.acceptedAt) {
          await ctx.db.patch('invitations', invitation._id, { acceptedAt: now })
        }
        rows.push({
          email: normalized,
          outcome: 'already_member' as const,
          role: member.role,
        })
        continue
      }
      if (!invitation) {
        rows.push({ email: normalized, outcome: 'no_invitation' as const })
        continue
      }
      await ctx.db.insert('organizationMembers', {
        orgId: org._id,
        userId: user._id,
        role: invitation.role,
        joinedAt: now,
      })
      if (!invitation.acceptedAt) {
        await ctx.db.patch('invitations', invitation._id, { acceptedAt: now })
      }
      rows.push({
        email: normalized,
        outcome: 'joined' as const,
        role: invitation.role,
        wasExpired: invitation.expiresAt < now,
      })
    }
    return { org: org.slug, rows }
  },
})
