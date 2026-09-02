/**
 * Announce a VASCO/Parallel arrival by mail — the portal's equivalent of the
 * report-mail confirmation (`convex/reportNotify.ts`).
 *
 * A portal publication has no forwarder and no thread: nobody sent us
 * anything, so there is no one to reply to. What it produces is the same
 * ANNOUNCEMENT the rest of the org gets when a report is filed — same
 * template, same entity card, same synthesis block — sent as a fresh mail to
 * every member who has not turned report announcements off.
 *
 * Two orderings carry the value and must not be swapped:
 *
 * - the synthesis runs BEFORE the mail is built. The card's whole point is
 *   "where the company stands", and that is only true once this publication
 *   has been folded in (same reason `reportStore` waits on
 *   `runAnalysisBatch`). A failed synthesis never holds the mail back — the
 *   card then simply carries no note.
 * - the announcement is CLAIMED before it is sent, never after. `announcedAt`
 *   is stamped on the communications inside one transaction, so a scheduler
 *   retry finds them claimed and stays silent. Like `inboundEmails.notifiedAt`
 *   it is never released: one arrival, one mail, however many times the portal
 *   is re-pulled. The cost is the mirror risk — an action dying between the
 *   claim and the send loses that announcement — and it is the deliberate
 *   trade, a lost mail being cheaper than a loop of duplicates.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { sendMessage } from './agentmail'
import { reportConfirmationHtml } from './emailTemplates'
import type { ReportEntityCard } from './emailTemplates'
import type { Id } from './_generated/dataModel'

/** Newest first — a publication without a parsable date sinks to the bottom
 *  rather than claiming today's slot (same rule as `lib/reportFreshness`). */
function byPublishDesc(
  a: { publishDate?: string },
  b: { publishDate?: string },
): number {
  const pa = a.publishDate ? Date.parse(a.publishDate) : NaN
  const pb = b.publishDate ? Date.parse(b.publishDate) : NaN
  return (Number.isNaN(pb) ? 0 : pb) - (Number.isNaN(pa) ? 0 : pa)
}

/**
 * Stamp `announcedAt` on this issuer's un-announced communications and hand
 * back what they say. Returns an empty list when another run already claimed
 * them — the caller then sends nothing.
 */
export const claimArrivals = internalMutation({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (
    ctx,
    { orgId, clientSlug, issuerId },
  ): Promise<
    Array<{ title?: string; period?: string; publishDate?: string }>
  > => {
    const rows = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const claimed: Array<{
      title?: string
      period?: string
      publishDate?: string
    }> = []
    const now = Date.now()
    for (const row of rows) {
      if (row.clientSlug !== clientSlug) continue
      if (row.issuerId !== issuerId) continue
      if (row.announcedAt != null) continue
      await ctx.db.patch('vascoCommunicationsCache', row._id, {
        announcedAt: now,
      })
      claimed.push({
        title: row.title,
        period: row.period,
        publishDate: row.publishDate,
      })
    }
    return claimed.sort(byPublishDesc)
  },
})

/** Human date for the "published on" line. The portal's ISO string is kept
 *  verbatim when it cannot be parsed — better a raw stamp than a wrong one. */
function frenchDate(iso: string | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export const announce = internalAction({
  args: {
    companyId: v.id('companies'),
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (ctx, { companyId, orgId, clientSlug, issuerId }) => {
    // Before anything is consumed: without an outbound inbox nothing can be
    // sent, and claiming here would burn the announcement for good (the mark
    // is never released). Bail while the arrival is still un-announced, so a
    // later run can still say it.
    const inboxId = process.env.AGENTMAIL_INBOX_ID
    if (!inboxId) {
      console.warn('[vascoNotify] no AGENTMAIL_INBOX_ID — announcement deferred')
      return null
    }

    // Claim next: a retry of this action must not produce a second mail.
    const arrivals: Array<{
      title?: string
      period?: string
      publishDate?: string
    }> = await ctx.runMutation(internal.vascoNotify.claimArrivals, {
      orgId,
      clientSlug,
      issuerId,
    })
    if (arrivals.length === 0) return null

    // The note must fold this publication in before the mail quotes it.
    await ctx.runAction(internal.intelligence.runAnalysis, { companyId, orgId })

    const targets: Array<{ userId: Id<'users'>; email: string }> =
      await ctx.runQuery(internal.reportNotify.broadcastTargets, {
        orgIds: [orgId],
      })
    if (targets.length === 0) return null

    const latest = arrivals[0]
    const period = latest.period ?? frenchDate(latest.publishDate) ?? undefined
    const publishedOn = frenchDate(latest.publishDate)

    for (const target of targets) {
      // Built per recipient: the card carries committed figures and a fiche
      // link, so it is scoped to the organizations that reader belongs to.
      const cards: Array<ReportEntityCard> = await ctx.runQuery(
        internal.reportNotify.entityCards,
        { refs: [{ companyId, orgId }], userId: target.userId },
      )
      if (cards.length === 0) continue
      await sendMessage(
        inboxId,
        [target.email],
        `Albo OS — nouvelle communication ${cards[0].name}${period ? ` (${period})` : ''}`,
        reportConfirmationHtml({
          entities: cards,
          reportPeriod: period,
          // No metric extraction on this channel: the template drops the
          // "ce que dit ce report" block on an empty list, and the synthesis
          // card below it carries the substance.
          highlights: [],
          publishedOn: publishedOn
            ? `Publié sur le portail le ${publishedOn}`
            : 'Publié sur le portail',
          publicationTitles: arrivals
            .map((a) => a.title)
            .filter((t): t is string => Boolean(t))
            .slice(0, 3),
        }),
      )
    }
    return null
  },
})
