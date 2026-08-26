/**
 * Who receives the report pipeline's problem mails — one definition, used by
 * the sender (`reportNotify.listRecipients`), by the settings screen that
 * shows the list, and by the guard that refuses to empty it.
 *
 * The list is deliberately CROSS-ORG, like the review queue itself: a
 * quarantined email has not been attached to any organization yet, so there is
 * no org to scope its alert to.
 *
 * Emptying it is forbidden. The notice a forwarder gets when their report
 * fails says the team has been told and will sort it out; with nobody
 * subscribed that sentence becomes a lie, and the failure reaches no one at
 * all — see KNOWN_ISSUES "Une alerte qui marche n'est pas une alerte qui
 * arrive".
 */

import { wantsAlert } from './notificationPrefs'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Same ceiling as the rest of the pipeline: this app has two users. */
const MAX_MEMBERSHIPS = 50

export type ReportIssueRecipient = {
  userId: Id<'users'>
  email: string
  name?: string
}

/** Every member who still wants the report problem mails. */
export async function reportIssueRecipients(
  ctx: Ctx,
): Promise<Array<ReportIssueRecipient>> {
  const memberships = await ctx.db.query('organizationMembers').take(MAX_MEMBERSHIPS)
  const out: Array<ReportIssueRecipient> = []
  const seen = new Set<string>()
  for (const userId of memberships.map((m) => m.userId)) {
    if (seen.has(userId)) continue
    seen.add(userId)
    if (!(await wantsAlert(ctx, userId, 'reportIssues'))) continue
    const user = await ctx.db.get('users', userId)
    if (user?.email) out.push({ userId, email: user.email, name: user.name ?? undefined })
  }
  return out
}

/**
 * Would turning `reportIssues` off for `userId` leave nobody to receive them?
 * The caller refuses the change when this is true.
 */
export async function isLastReportIssueRecipient(
  ctx: Ctx,
  userId: Id<'users'>,
): Promise<boolean> {
  const current = await reportIssueRecipients(ctx)
  return current.length <= 1 && current.some((r) => r.userId === userId)
}
