/**
 * Inbound report emails — store-first state machine over `inboundEmails`.
 *
 * Every email hitting the AgentMail report inbox is recorded here BEFORE any
 * processing (see convex/agentmail.ts for the webhook). Later pipeline bricks
 * (sender auth, company matching, extraction, storage) only ever advance the
 * row's `status`; nothing is lost, everything is replayable.
 *
 * Brick 1 scope: ingest (dedup + insert) + async body hydration + the
 * read query for the review-queue page. No business processing yet.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, query } from './_generated/server'
import { fetchBody, getMessage } from './agentmail'
import { requireAppUser } from './lib/auth'
import type { Id } from './_generated/dataModel'

// Keep stored body snapshots well under the 1MB Convex document cap. Later
// pipeline stages re-fetch the full body from AgentMail when they need it.
const BODY_SNAPSHOT_MAX = 100_000

const attachmentValidator = v.object({
  attachmentId: v.string(),
  filename: v.string(),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  inline: v.optional(v.boolean()),
})

const messageValidator = v.object({
  inboxId: v.string(),
  messageId: v.string(),
  threadId: v.optional(v.string()),
  from: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
  bodyUrl: v.optional(v.string()),
  date: v.optional(v.number()),
  labels: v.array(v.string()),
  attachments: v.array(attachmentValidator),
})

function truncate(s: string): string | undefined {
  const trimmed = s.trim()
  if (!trimmed) return undefined
  return trimmed.length > BODY_SNAPSHOT_MAX ? trimmed.slice(0, BODY_SNAPSHOT_MAX) : trimmed
}

// ─── Ingest (called by the webhook) ──────────────────────────────────────────

/**
 * Record an inbound message. Idempotent: a message id already seen returns
 * null and writes nothing (webhooks can be redelivered). Schedules async body
 * hydration when the webhook payload came without text/html.
 *
 * Sender authentication (brick 2) happens inline, in the same transaction:
 * every mail is forwarded by a workspace member, so the From address must
 * match an app user who belongs to ≥1 org. Anything else — unknown sender,
 * or a message AgentMail flagged as spam — is quarantined (needs_review)
 * and NEVER gets any outbound reply (anti-enumeration).
 */
export const ingest = internalMutation({
  args: { message: messageValidator },
  handler: async (ctx, { message }): Promise<Id<'inboundEmails'> | null> => {
    const existing = await ctx.db
      .query('inboundEmails')
      .withIndex('by_message_id', (q) => q.eq('agentmailMessageId', message.messageId))
      .first()
    if (existing) {
      console.log(`[reportInbox] duplicate message ${message.messageId} → skip`)
      return null
    }

    const bodyText = truncate(message.text)
    const bodyHtml = truncate(message.html)

    // Brick 2 — sender authentication + spam quarantine. `message.from` is
    // lowercased at normalization; users.email is lowercase (Better Auth).
    // A case mismatch fails safe: the row lands in quarantine, not in the
    // pipeline.
    let status: 'received' | 'needs_review' = 'received'
    let statusReason: string | undefined
    let senderUserId: Id<'users'> | undefined

    if (message.labels.includes('spam')) {
      status = 'needs_review'
      statusReason = 'spam'
    } else {
      const sender = message.from
        ? await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', message.from))
            .first()
        : null
      const membership = sender
        ? await ctx.db
            .query('organizationMembers')
            .withIndex('by_user', (q) => q.eq('userId', sender._id))
            .first()
        : null
      if (sender && membership) {
        senderUserId = sender._id
      } else {
        status = 'needs_review'
        statusReason = 'unknown_sender'
      }
    }

    const id = await ctx.db.insert('inboundEmails', {
      agentmailInboxId: message.inboxId,
      agentmailMessageId: message.messageId,
      agentmailThreadId: message.threadId,
      fromEmail: message.from,
      toEmails: message.to,
      ccEmails: message.cc,
      subject: message.subject,
      receivedAt: message.date ?? Date.now(),
      bodyText,
      bodyHtml,
      attachments: message.attachments,
      status,
      statusReason,
      senderUserId,
    })

    // Large messages arrive without bodies in the webhook payload — hydrate
    // from the presigned body_url (fallback: the messages API).
    if (!bodyText && !bodyHtml) {
      await ctx.scheduler.runAfter(0, internal.reportInbox.hydrateBody, {
        inboundEmailId: id,
        inboxId: message.inboxId,
        messageId: message.messageId,
        bodyUrl: message.bodyUrl,
      })
    }

    console.log(
      `[reportInbox] ingested ${message.messageId} from=${message.from} subject="${message.subject}" attachments=${message.attachments.length} status=${status}${statusReason ? ` reason=${statusReason}` : ''}`,
    )
    return id
  },
})

export const setBody = internalMutation({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    bodyText: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
  },
  handler: async (ctx, { inboundEmailId, bodyText, bodyHtml }) => {
    await ctx.db.patch('inboundEmails', inboundEmailId, { bodyText, bodyHtml })
    return null
  },
})

export const hydrateBody = internalAction({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    inboxId: v.string(),
    messageId: v.string(),
    bodyUrl: v.optional(v.string()),
  },
  handler: async (ctx, { inboundEmailId, inboxId, messageId, bodyUrl }) => {
    let text = ''
    let html = ''
    if (bodyUrl) {
      const body = await fetchBody(bodyUrl)
      text = body.text
      html = body.html
    }
    if (!text && !html) {
      const full = await getMessage(inboxId, messageId)
      if (full) {
        text = String(full.text ?? '')
        html = String(full.html ?? '')
      }
    }
    const bodyText = truncate(text)
    const bodyHtml = truncate(html)
    if (bodyText || bodyHtml) {
      await ctx.runMutation(internal.reportInbox.setBody, {
        inboundEmailId,
        bodyText,
        bodyHtml,
      })
    } else {
      console.warn(`[reportInbox] hydrateBody: no body found for ${messageId}`)
    }
    return null
  },
})

// ─── Read (review-queue page) ────────────────────────────────────────────────

/**
 * Latest inbound emails, most recent first. Cross-org surface (rows have no
 * org until matched), so access = any authenticated member of ≥1 org — same
 * boundary as the aggregated view (convex/aggregate.ts).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAppUser(ctx)
    const membership = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first()
    if (!membership) throw new ConvexError('forbidden')

    const rows = await ctx.db.query('inboundEmails').order('desc').take(100)

    return rows.map((r) => ({
      _id: r._id,
      fromEmail: r.fromEmail,
      subject: r.subject,
      receivedAt: r.receivedAt,
      status: r.status,
      statusReason: r.statusReason ?? null,
      senderVerified: Boolean(r.senderUserId),
      attachmentsCount: r.attachments.length,
      hasBody: Boolean(r.bodyText || r.bodyHtml),
    }))
  },
})
