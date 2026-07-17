/**
 * Brick 6 — recap notifications, 100% via AgentMail (design decision:
 * no Resend in this pipeline).
 *
 * Routing rule (anti-enumeration, hard-coded):
 * - The sender is re-checked as a member AT SEND TIME. Member → the recap
 *   is a REPLY in the forward's own thread (lands in their mailbox, in
 *   context). Not a member → NEVER reply; a FRESH email goes to all members
 *   (quarantine notices, or rows manually assigned from quarantine).
 * - Idempotent: `notifiedAt` is claimed transactionally before sending —
 *   scheduler retries never double-send.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { replyToMessage, sendMessage } from './agentmail'
import {
  reportQuarantineHtml,
  reportRecapFailureHtml,
  reportRecapSuccessHtml,
  reviewReasonLabel,
} from './emailTemplates'
import type { RecapMetric, RecapSuspicious } from './emailTemplates'

function siteUrl(): string {
  return (process.env.SITE_URL ?? '').replace(/\/$/, '')
}

// ─── Queries / mutations ─────────────────────────────────────────────────────

/** Claim the notification slot; false when already notified (idempotence). */
export const claimNotify = internalMutation({
  args: { inboundEmailId: v.id('inboundEmails') },
  handler: async (ctx, { inboundEmailId }): Promise<boolean> => {
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row || row.notifiedAt) return false
    await ctx.db.patch('inboundEmails', inboundEmailId, { notifiedAt: Date.now() })
    return true
  },
})

/** All member emails (recipients of fresh notices). */
export const listRecipients = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<string>> => {
    const memberships = await ctx.db.query('organizationMembers').take(50)
    const userIds = [...new Set(memberships.map((m) => m.userId))]
    const emails: Array<string> = []
    for (const userId of userIds) {
      const user = await ctx.db.get('users', userId)
      if (user?.email) emails.push(user.email)
    }
    return [...new Set(emails)]
  },
})

/** Is this email address an authenticated member? (checked at send time) */
export const isMemberEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<boolean> => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    if (!user) return false
    const membership = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first()
    return Boolean(membership)
  },
})

/** Matched companies enriched with org name + slug (for links). */
export const companiesWithOrg = internalQuery({
  args: {
    refs: v.array(v.object({ companyId: v.id('companies'), orgId: v.id('organizations') })),
  },
  handler: async (ctx, { refs }) => {
    const out: Array<{ name: string; orgName: string; url: string | null }> = []
    for (const ref of refs) {
      const [company, org] = await Promise.all([
        ctx.db.get('companies', ref.companyId),
        ctx.db.get('organizations', ref.orgId),
      ])
      if (!company || !org) continue
      const base = siteUrl()
      out.push({
        name: company.name,
        orgName: org.name,
        url: base ? `${base}/app/${org.slug}/participations/${company._id}` : null,
      })
    }
    return out
  },
})

// ─── Send ────────────────────────────────────────────────────────────────────

const successPayloadValidator = v.object({
  reportPeriod: v.string(),
  reportType: v.string(),
  matchMethod: v.string(),
  metricsFound: v.array(v.object({ metricType: v.string(), value: v.number(), unit: v.string() })),
  suspicious: v.array(
    v.object({
      metricType: v.string(),
      value: v.number(),
      unit: v.string(),
      previousValue: v.number(),
    }),
  ),
  unrecognized: v.array(v.string()),
  missingUsual: v.array(v.string()),
  // Fiche KPI cible checklist (present when the company defines targets).
  targets: v.optional(
    v.array(
      v.object({
        metricType: v.string(),
        found: v.boolean(),
        value: v.optional(v.number()),
        unit: v.optional(v.string()),
      }),
    ),
  ),
})

export const send = internalAction({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    kind: v.union(v.literal('success'), v.literal('failure'), v.literal('quarantine')),
    reason: v.optional(v.string()),
    success: v.optional(successPayloadValidator),
  },
  handler: async (ctx, { inboundEmailId, kind, reason, success }) => {
    const claimed: boolean = await ctx.runMutation(internal.reportNotify.claimNotify, {
      inboundEmailId,
    })
    if (!claimed) return null

    const row = await ctx.runQuery(internal.reportIdentify.getRow, { inboundEmailId })
    if (!row) return null

    const queueUrl = `${siteUrl()}/app/all/reports`
    const senderIsMember: boolean = await ctx.runQuery(internal.reportNotify.isMemberEmail, {
      email: row.fromEmail,
    })

    let html: string
    let subject: string
    if (kind === 'success' && success) {
      const companies = await ctx.runQuery(internal.reportNotify.companiesWithOrg, {
        refs: row.matchedCompanies ?? [],
      })
      const metricsFound: Array<RecapMetric> = success.metricsFound
      const suspicious: Array<RecapSuspicious> = success.suspicious
      html = reportRecapSuccessHtml({
        companies,
        reportPeriod: success.reportPeriod,
        reportType: success.reportType,
        matchMethod: success.matchMethod,
        sources: row.sources ?? [],
        metricsFound,
        suspicious,
        unrecognized: success.unrecognized,
        missingUsual: success.missingUsual,
        targets: success.targets,
      })
      subject = `Albo OS — report rangé : ${success.reportPeriod}`
    } else if (kind === 'failure') {
      html = reportRecapFailureHtml(reason ?? 'unknown', queueUrl)
      subject = `Albo OS — report non traité (${reviewReasonLabel(reason ?? 'unknown')})`
    } else {
      html = reportQuarantineHtml(row.fromEmail, row.subject, reason ?? 'unknown', queueUrl)
      subject = 'Albo OS — email en quarantaine'
    }

    // Anti-enumeration routing: in-thread reply ONLY for member senders.
    if (kind !== 'quarantine' && senderIsMember) {
      await replyToMessage(row.agentmailInboxId, row.agentmailMessageId, html)
    } else {
      const recipients: Array<string> = await ctx.runQuery(
        internal.reportNotify.listRecipients,
        {},
      )
      if (recipients.length > 0) {
        await sendMessage(row.agentmailInboxId, recipients, subject, html)
      }
    }

    console.log(
      `[reportNotify] ${kind} recap sent for ${row.agentmailMessageId} (in-thread=${kind !== 'quarantine' && senderIsMember})`,
    )
    return null
  },
})
