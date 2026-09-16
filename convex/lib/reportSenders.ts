/**
 * Who is behind an inbound report email, and which addresses the pipeline must
 * never talk to.
 *
 * Two questions the report circuit keeps separate:
 * - "May this mail be processed?" — answered by the CONTENT (`reportIdentify`
 *   has to match a participation and corroborate it deterministically), never
 *   by the sender. Anyone may write to the report address.
 * - "May we answer this sender?" — answered HERE. Only a member of an org gets
 *   a reply, because the confirmation carries amounts, org names and fiche
 *   links. A stranger gets nothing at all (anti-enumeration).
 *
 * A member is recognized by their `users.email`, and only by it. Forwarding
 * from another address means being an unknown to the circuit: the mail is
 * still filed, it just gets no reply. An address someone forwards from
 * regularly is therefore an account of theirs, not a declaration on the side.
 */

import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * The user behind `email` when they are a member of ≥ 1 org, else null.
 */
export async function resolveMemberByEmail(
  ctx: Ctx,
  email: string,
): Promise<Id<'users'> | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const user = await ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', normalized))
    .first()
  if (!user) return null

  const membership = await ctx.db
    .query('organizationMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .first()
  return membership ? user._id : null
}

/**
 * Addresses the pipeline must never ingest from nor reply to: the mailing
 * group that fronts the report inbox, and the inbox itself.
 *
 * Without this, one mis-set Google Groups option (a subject prefix or a footer
 * breaks DKIM, so Google rewrites `From` into the group address) turns every
 * confirmation into a message sent to the group — which redelivers it to the
 * inbox, which answers again. `REPORT_GROUP_ADDRESSES` holds the group
 * alias(es), comma-separated.
 */
export function blockedSenderAddresses(inboxId: string): Set<string> {
  const out = new Set<string>()
  for (const raw of (process.env.REPORT_GROUP_ADDRESSES ?? '').split(',')) {
    const address = raw.trim().toLowerCase()
    if (address) out.add(address)
  }
  // An AgentMail inbox id IS its email address, so this catches the inbox
  // answering itself even with no env var set.
  const self = inboxId.trim().toLowerCase()
  if (self.includes('@')) out.add(self)
  return out
}

/** Is `email` one of the addresses we must never ingest from or answer? */
export function isBlockedSender(email: string, inboxId: string): boolean {
  return blockedSenderAddresses(inboxId).has(email.trim().toLowerCase())
}
