/**
 * The inbound email a stored report came from.
 *
 * Read by both sides of a deletion: `reportInbox` corrects the queue row when
 * a report leaves an entity, and `documents:remove` needs it to know whether
 * the source email still holds the file it is about to free.
 */

import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Recent reports carry the back-link; older ones are found again through the
 * AgentMail message id they share with their email. An upload stored before
 * the back-link existed has no way home — callers must tolerate `null`.
 */
export async function sourceInbound(
  ctx: QueryCtx | MutationCtx,
  report: Doc<'companyReports'>,
): Promise<Doc<'inboundEmails'> | null> {
  if (report.inboundEmailId) {
    return await ctx.db.get('inboundEmails', report.inboundEmailId)
  }
  const messageId = report.agentmailMessageId
  if (!messageId) return null
  return await ctx.db
    .query('inboundEmails')
    .withIndex('by_message_id', (q) => q.eq('agentmailMessageId', messageId))
    .first()
}
