/**
 * Brick 6 — recap notifications, 100% via AgentMail (design decision:
 * no Resend in this pipeline).
 *
 * Routing rule: the decision lives in `lib/reportRouting.ts:routeRecap`
 * (channel follows the gesture, content follows the role, audience follows
 * the event — see there). The sender is re-checked as a member AT SEND TIME,
 * and a non-member is NEVER replied to, so the address cannot be probed.
 *
 * Idempotent: `notifiedAt` is claimed transactionally before sending, so
 * scheduler retries never double-send. One claim covers EVERY send of one
 * outcome (the forwarder's thread reply, the fresh mail to the other
 * handlers, the copy broadcast to the org) — they happen in the same run.
 *
 * The claim is NEVER released. Replaying a row from the queue ("Retraiter" /
 * "Rattacher") re-runs the whole pipeline in silence: the forwarder sent one
 * email and gets one answer, however many times the row is re-processed
 * afterwards. The single exception is the good news — see `claimNotify`.
 *
 * Every mail is built PER RECIPIENT: it carries committed amounts and fiche
 * links, so the entities it lists are scoped to the organizations that
 * recipient actually belongs to (`entityCards`). Two people can receive the
 * same report announcement and legitimately see different lines.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { replyToMessage, sendMessage } from './agentmail'
import { transactionTotals } from './deals'
import {
  reportConfirmationHtml,
  reportDuplicateHtml,
  reportQuarantineHtml,
  reportRecapFailureHtml,
  reportSoftFailureHtml,
  reviewReasonLabel,
} from './emailTemplates'
import { companyLogoUrl } from './lib/domain'
import { wantsAlert } from './lib/notificationPrefs'
import { reportIssueRecipients } from './lib/reportRecipients'
import { isBlockedSender, resolveMemberByEmail } from './lib/reportSenders'
import { recapKindValidator, reportSendArgs } from './lib/reportNotifyArgs'
import { routeRecap } from './lib/reportRouting'
import type { ReportEntityCard } from './emailTemplates'
import type { Id } from './_generated/dataModel'

/** One tile of `companyIntelligence.aiAnalysis.top_insights`. The column is
 *  `v.any()` in the schema, so the shape is named here rather than inferred. */
type AiInsight = {
  label?: string
  current_value?: string
  trend?: string
  trend_direction?: 'up' | 'down' | 'stable'
  context?: string
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? '').replace(/\/$/, '')
}

/**
 * Outbound inbox. A manual upload carries a placeholder inbox id (the row is
 * not an email — cf. KNOWN_ISSUES "inboundEmails contient des lignes qui ne
 * sont PAS des emails"), so a broadcast about one has to fall back to the
 * configured inbox.
 */
function outboundInbox(rowInboxId: string): string {
  return rowInboxId === 'manual-upload'
    ? (process.env.AGENTMAIL_INBOX_ID ?? rowInboxId)
    : rowInboxId
}

// ─── Queries / mutations ─────────────────────────────────────────────────────

/**
 * Claim the notification slot, and report what the row's last word was.
 *
 * The first outcome always goes out. After that the guard holds through every
 * replay, with ONE exception: a row whose last word was a problem may speak
 * once more, and only to announce that it finally went through. A second
 * problem after a first one stays silent — the queue already shows it, and a
 * mail per attempt is exactly what made this circuit unusable.
 *
 * A row notified before `notifiedKind` existed carries no outcome; it is
 * treated as final. Erring toward silence is deliberate here.
 *
 * `previousKind` is what lets the confirmation say "the report that was stuck
 * is now filed" instead of reading like an ordinary first answer.
 */
export const claimNotify = internalMutation({
  args: { inboundEmailId: v.id('inboundEmails'), kind: recapKindValidator },
  handler: async (
    ctx,
    { inboundEmailId, kind },
  ): Promise<{ claimed: boolean; previousKind?: string }> => {
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) return { claimed: false }
    if (row.notifiedAt) {
      if (kind !== 'success') return { claimed: false }
      if (row.notifiedKind !== 'failure' && row.notifiedKind !== 'quarantine') {
        return { claimed: false }
      }
    }
    await ctx.db.patch('inboundEmails', inboundEmailId, {
      notifiedAt: Date.now(),
      notifiedKind: kind,
    })
    return { claimed: true, previousKind: row.notifiedKind }
  },
})

/**
 * Members who still want the report pipeline's problem mails — a quarantined
 * email, a forward that could not be processed, or the outcome of a row
 * someone assigned by hand from the queue. They share one opt-out.
 *
 * This list does double duty in `send`: it is both the recipient list AND
 * the test for "does the sender handle the queue?", which is what decides
 * whether their confirmation carries the quality-control block. The
 * confirmation itself is never gated — it answers a gesture its reader just
 * made.
 */
export const listRecipients = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ userId: Id<'users'>; email: string }>> => {
    return (await reportIssueRecipients(ctx)).map((r) => ({
      userId: r.userId,
      email: r.email,
    }))
  },
})

/** The app user behind an email address, when they are a member — their
 *  account address or any alias they declared. Checked at send time so a
 *  membership revoked since the forward is honoured. */
export const memberByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ userId: Id<'users'> } | null> => {
    const userId = await resolveMemberByEmail(ctx, email)
    return userId ? { userId } : null
  },
})

/**
 * The entities a given reader may be told about, with everything the
 * confirmation shows: identity, fiche figures, and the company's AI synthesis.
 *
 * Scoped to the reader's own organizations. A report filed in both Calte and
 * Albo announces only the side the reader belongs to — otherwise the mail
 * would carry a committed amount the app itself refuses to show them, behind
 * a link that answers 403.
 */
export const entityCards = internalQuery({
  args: {
    refs: v.array(v.object({ companyId: v.id('companies'), orgId: v.id('organizations') })),
    userId: v.id('users'),
  },
  handler: async (ctx, { refs, userId }): Promise<Array<ReportEntityCard>> => {
    const out: Array<ReportEntityCard> = []
    for (const ref of refs) {
      const membership = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) => q.eq('orgId', ref.orgId).eq('userId', userId))
        .unique()
      if (!membership) continue

      const [company, org] = await Promise.all([
        ctx.db.get('companies', ref.companyId),
        ctx.db.get('organizations', ref.orgId),
      ])
      if (!company || !org) continue

      // Fiche figures: one company can carry several deals (Eben Home has
      // three, Rewatt nine), and they are not all of the same nature — CCA
      // tranches repaid years ago sit next to a share position still open.
      // Summing the lot into one "Versé" announced 3,47 M€ on a company where
      // 49 950 € is actually at work (ALB-237), and it contradicted the app,
      // whose participations list already splits a company into open /
      // settled / cancelled tables. Same split here, same buckets.
      //
      // `cancelled` enters neither side: the funds were wired and refunded,
      // so there never was a position (cf. CLAUDE.md).
      //
      // The figure is "Versé", summed from the bank movements reconciled
      // against each deal (`transactionTotals`, the app's own definition), NOT
      // the commitment: 275 of CALTE's 280 deals carry no `committedAmount`,
      // so keying this line on it left it blank on nearly every report.
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', ref.orgId).eq('targetCompanyId', ref.companyId),
        )
        .collect()
      let openPaid = 0
      let settledCount = 0
      let settledPaid = 0
      let settledReceived = 0
      const openDates: Array<number> = []
      for (const deal of deals) {
        if (deal.status === 'cancelled') continue
        const totals = await transactionTotals(ctx, deal._id)
        if (deal.status === 'fully_exited' || deal.status === 'written_off') {
          settledCount += 1
          settledPaid += totals.paidActual
          settledReceived += totals.received
          continue
        }
        openPaid += totals.paidActual
        const startedAt = deal.investmentDate ?? deal.signedDate
        if (typeof startedAt === 'number') openDates.push(startedAt)
      }

      // The report that came BEFORE the one just filed: the freshest two, and
      // we want the second. On a duplicate the newest IS the one re-sent, so
      // the label can legitimately repeat — it is still the previous period.
      const recent = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', ref.companyId))
        .order('desc')
        .take(2)

      const intelligence = await ctx.db
        .query('companyIntelligence')
        .withIndex('by_company', (q) => q.eq('companyId', ref.companyId))
        .unique()
      const ai = intelligence?.aiAnalysisStatus === 'completed' ? intelligence.aiAnalysis : null

      out.push({
        name: company.name,
        orgName: org.name,
        logoUrl: companyLogoUrl(company.domain),
        url: siteUrl()
          ? `${siteUrl()}/app/${org.slug}/participations/${company._id}`
          : null,
        openPaidCents: openPaid > 0 ? openPaid : undefined,
        firstInvestmentAt: openDates.length > 0 ? Math.min(...openDates) : undefined,
        // Same rule as the open line: a bucket with no movement at all says
        // nothing rather than announcing zeroes.
        settled:
          settledPaid > 0 || settledReceived > 0
            ? {
                dealCount: settledCount,
                paidCents: settledPaid,
                receivedCents: settledReceived,
              }
            : undefined,
        previousPeriod: recent[1]?.reportPeriod,
        synthesis: ai?.executive_summary
          ? {
              score: ai.health_score?.score,
              scoreLabel: ai.health_score?.label,
              summary: ai.executive_summary,
              goodPoints: ai.health_score?.good_points ?? [],
              badPoints: ai.health_score?.bad_points ?? [],
              insights: (ai.top_insights ?? []).map((i: AiInsight) => ({
                label: i.label ?? '',
                value: i.current_value ?? '',
                trend: i.trend,
                direction: i.trend_direction,
                context: i.context,
              })),
            }
          : undefined,
      })
    }
    return out
  },
})

/**
 * Who else in the report's organizations hears that it arrived. The forwarder
 * is excluded — they already got the answer in their own thread — and so is
 * anyone who turned the announcement off.
 */
export const broadcastTargets = internalQuery({
  args: {
    orgIds: v.array(v.id('organizations')),
    excludeUserId: v.optional(v.id('users')),
  },
  handler: async (
    ctx,
    { orgIds, excludeUserId },
  ): Promise<Array<{ userId: Id<'users'>; email: string }>> => {
    const seen = new Set<string>()
    const out: Array<{ userId: Id<'users'>; email: string }> = []
    for (const orgId of [...new Set(orgIds)]) {
      const members = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .take(50)
      for (const m of members) {
        if (m.userId === excludeUserId) continue
        if (seen.has(m.userId)) continue
        seen.add(m.userId)
        if (!(await wantsAlert(ctx, m.userId, 'reportAdded'))) continue
        const user = await ctx.db.get('users', m.userId)
        if (user?.email) out.push({ userId: m.userId, email: user.email })
      }
    }
    return out
  },
})

/** Display name of the person who forwarded, for the broadcast copy. */
export const displayNameOf = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<string> => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    return user?.name || email
  },
})

// ─── Send ────────────────────────────────────────────────────────────────────

export const send = internalAction({
  args: reportSendArgs,
  handler: async (ctx, { inboundEmailId, kind, reason, success }) => {
    const claim: { claimed: boolean; previousKind?: string } = await ctx.runMutation(
      internal.reportNotify.claimNotify,
      { inboundEmailId, kind },
    )
    if (!claim.claimed) return null

    const row = await ctx.runQuery(internal.reportIdentify.getRow, { inboundEmailId })
    if (!row) return null

    const queueUrl = `${siteUrl()}/app/all/reports`
    const refs = row.matchedCompanies ?? []
    const member: { userId: Id<'users'> } | null = await ctx.runQuery(
      internal.reportNotify.memberByEmail,
      { email: row.fromEmail },
    )
    const recipients: Array<{ userId: Id<'users'>; email: string }> = await ctx.runQuery(
      internal.reportNotify.listRecipients,
      {},
    )
    // Compared on the user, not the address: someone who forwarded from a
    // declared alias is the same person as the account subscribed to the
    // problem mails.
    const senderHandlesIssues =
      member !== null && recipients.some((r) => r.userId === member.userId)
    const route = routeRecap({ kind, senderIsMember: Boolean(member), senderHandlesIssues })

    // A manual upload has no AgentMail thread to reply to (the ids are
    // placeholders) and its author is in front of the fiche, which shows the
    // outcome. No reply — but the rest of the org still hears about it.
    const canReply = row.origin !== 'upload'
    const period = success?.reportPeriod

    // ── The forwarder's answer, in their own thread ──────────────────────
    if (route.reply && canReply) {
      let body: string | null = null
      if (route.reply === 'confirmation' && success && member) {
        const cards: Array<ReportEntityCard> = await ctx.runQuery(
          internal.reportNotify.entityCards,
          { refs, userId: member.userId },
        )
        body = reportConfirmationHtml({
          entities: cards,
          reportPeriod: period,
          highlights: success.highlights,
          // They were told it was stuck; say that it no longer is.
          afterFix: claim.previousKind === 'failure' || claim.previousKind === 'quarantine',
          quality: route.withQuality
            ? { ...success.quality, sources: row.sources ?? [] }
            : undefined,
        })
      } else if (route.reply === 'duplicate' && member) {
        const cards: Array<ReportEntityCard> = await ctx.runQuery(
          internal.reportNotify.entityCards,
          { refs, userId: member.userId },
        )
        body = reportDuplicateHtml({
          entityName: cards[0]?.name ?? 'cette participation',
          reportPeriod: period,
          url: cards[0]?.url ?? null,
        })
      } else if (route.reply === 'alert') {
        body = reportRecapFailureHtml(reason ?? 'unknown', queueUrl, row.error)
      } else if (route.reply === 'soft') {
        body = reportSoftFailureHtml(row.subject, row.receivedAt)
      }
      // The recipient is imposed, never inferred: the reply goes to the
      // person who forwarded, and to nobody else. Last guard before the wire
      // — an address we refuse to talk to (the mailing group, this inbox) is
      // dropped even if it got this far.
      if (body && !isBlockedSender(row.fromEmail, row.agentmailInboxId)) {
        await replyToMessage(row.agentmailInboxId, row.agentmailMessageId, body, [
          row.fromEmail,
        ])
      }
    }

    // ── The problem mail to the other queue handlers ─────────────────────
    if (route.alertOthers) {
      const html =
        kind === 'quarantine'
          ? reportQuarantineHtml(row.fromEmail, row.subject, reason ?? 'unknown', queueUrl)
          : reportRecapFailureHtml(reason ?? 'unknown', queueUrl, row.error)
      const subject =
        kind === 'quarantine'
          ? 'Albo OS — email en quarantaine'
          : `Albo OS — report non traité (${reviewReasonLabel(reason ?? 'unknown')})`
      const others = recipients
        .filter((r) => r.userId !== member?.userId)
        .map((r) => r.email)
      if (others.length > 0) {
        await sendMessage(outboundInbox(row.agentmailInboxId), others, subject, html)
      }
    }

    // ── The announcement to the rest of the organization ─────────────────
    if (route.broadcast && success) {
      const forwardedBy: string = await ctx.runQuery(internal.reportNotify.displayNameOf, {
        email: row.fromEmail,
      })
      const targets: Array<{ userId: Id<'users'>; email: string }> = await ctx.runQuery(
        internal.reportNotify.broadcastTargets,
        { orgIds: refs.map((r) => r.orgId), excludeUserId: member?.userId },
      )
      for (const target of targets) {
        const cards: Array<ReportEntityCard> = await ctx.runQuery(
          internal.reportNotify.entityCards,
          { refs, userId: target.userId },
        )
        // Every entity of this report sits outside their organizations.
        if (cards.length === 0) continue
        const names = cards.map((c) => c.name).join(', ')
        await sendMessage(
          outboundInbox(row.agentmailInboxId),
          [target.email],
          `Albo OS — nouveau report ${names}${period ? ` (${period})` : ''}`,
          reportConfirmationHtml({
            entities: cards,
            reportPeriod: period,
            highlights: success.highlights,
            forwardedBy,
          }),
        )
      }
    }

    console.log(
      `[reportNotify] ${kind} for ${row.agentmailMessageId} ` +
        `(reply=${route.reply ?? 'none'}, alertOthers=${route.alertOthers}, broadcast=${route.broadcast})`,
    )
    return null
  },
})
