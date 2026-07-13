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
import { internalAction, internalMutation, mutation, query } from './_generated/server'
import { fetchBody, getMessage } from './agentmail'
import { requireAppUser, requireOrgMember } from './lib/auth'
import type { QueryCtx } from './_generated/server'
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

/** The user id when `email` belongs to a member of ≥1 org, else null. */
async function memberUserIdFor(ctx: QueryCtx, email: string): Promise<Id<'users'> | null> {
  if (!email) return null
  const user = await ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
  if (!user) return null
  const membership = await ctx.db
    .query('organizationMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .first()
  return membership ? user._id : null
}

/** Same access boundary as the aggregated view: any member of ≥1 org. */
async function requireAnyMember(ctx: QueryCtx) {
  const user = await requireAppUser(ctx)
  const membership = await ctx.db
    .query('organizationMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .first()
  if (!membership) throw new ConvexError('forbidden')
  return user
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
      const memberId = await memberUserIdFor(ctx, message.from)
      if (memberId) {
        senderUserId = memberId
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
    // from the presigned body_url (fallback: the messages API). For an
    // authenticated sender, identification (brick 3) runs right after the
    // body is available: directly, or chained after hydration.
    const authenticated = Boolean(senderUserId)
    if (!bodyText && !bodyHtml) {
      await ctx.scheduler.runAfter(0, internal.reportInbox.hydrateBody, {
        inboundEmailId: id,
        inboxId: message.inboxId,
        messageId: message.messageId,
        bodyUrl: message.bodyUrl,
        thenIdentify: authenticated,
      })
    } else if (authenticated) {
      await ctx.scheduler.runAfter(0, internal.reportIdentify.run, {
        inboundEmailId: id,
      })
    }

    // Quarantine notice (brick 6): a FRESH email to the members — never any
    // reply to the unknown sender (anti-enumeration).
    if (status === 'needs_review' && statusReason) {
      await ctx.scheduler.runAfter(0, internal.reportNotify.send, {
        inboundEmailId: id,
        kind: 'quarantine',
        reason: statusReason,
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
    // Chain identification (brick 3) once the body is in — only set for
    // authenticated senders.
    thenIdentify: v.optional(v.boolean()),
  },
  handler: async (ctx, { inboundEmailId, inboxId, messageId, bodyUrl, thenIdentify }) => {
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
    // Identify even with an empty body: subject + attachments may still be
    // enough, and a failed match lands in the review queue (never silent).
    if (thenIdentify) {
      await ctx.scheduler.runAfter(0, internal.reportIdentify.run, { inboundEmailId })
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
    await requireAnyMember(ctx)

    const rows = await ctx.db.query('inboundEmails').order('desc').take(100)

    return Promise.all(
      rows.map(async (r) => {
        // Resolve matched participation names for display (≤100 rows × a few
        // entities each — bounded).
        const matched = await Promise.all(
          (r.matchedCompanies ?? []).map(async (m) => {
            const company = await ctx.db.get('companies', m.companyId)
            return company?.name ?? null
          }),
        )
        const sources = r.sources ?? []
        return {
          _id: r._id,
          fromEmail: r.fromEmail,
          subject: r.subject,
          receivedAt: r.receivedAt,
          status: r.status,
          statusReason: r.statusReason ?? null,
          senderVerified: Boolean(r.senderUserId),
          matchedNames: [...new Set(matched.filter((n): n is string => !!n))],
          attachmentsCount: r.attachments.length,
          hasBody: Boolean(r.bodyText || r.bodyHtml),
          sourcesSummary: r.sources
            ? {
                extracted: sources.filter((s) => s.state === 'extracted').length,
                stored: sources.filter((s) => s.state === 'stored').length,
                failed: sources.filter((s) => s.state === 'failed').length,
              }
            : null,
        }
      }),
    )
  },
})

// ─── Review-queue actions (brick 6, public) ──────────────────────────────────

/** Assignable targets: the caller's orgs' active portfolio companies. */
export const listAssignTargets = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAnyMember(ctx)
    const memberships = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const out: Array<{ companyId: Id<'companies'>; name: string; orgName: string }> = []
    for (const m of memberships) {
      const org = await ctx.db.get('organizations', m.orgId)
      if (!org) continue
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) => q.eq('orgId', m.orgId).eq('kind', 'portfolio'))
        .collect()
      for (const c of companies) {
        if (c.archivedAt) continue
        out.push({ companyId: c._id, name: c.name, orgName: org.name })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

/**
 * Manually attach a reviewed email to a participation, then resume the
 * pipeline where it stopped (extraction if not done, else storage). The
 * match fans out to every entity sharing the chosen company's domain or
 * exact name — the same rule as automatic identification.
 */
export const assignCompany = mutation({
  args: { inboundEmailId: v.id('inboundEmails'), companyId: v.id('companies') },
  handler: async (ctx, { inboundEmailId, companyId }) => {
    const user = await requireAppUser(ctx)
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) throw new ConvexError('not_found')
    if (row.status !== 'needs_review' && row.status !== 'rejected') {
      throw new ConvexError('invalid_status')
    }
    const company = await ctx.db.get('companies', companyId)
    if (!company || company.kind !== 'portfolio') throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const domain = company.domain?.toLowerCase() ?? null
    const nameLc = company.name.toLowerCase()
    const matched: Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }> = []
    const orgs = await ctx.db.query('organizations').collect()
    for (const org of orgs) {
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) => q.eq('orgId', org._id).eq('kind', 'portfolio'))
        .collect()
      for (const c of companies) {
        if (c.archivedAt) continue
        const same =
          c._id === companyId ||
          (domain !== null && (c.domain ?? '').toLowerCase() === domain) ||
          c.name.toLowerCase() === nameLc
        if (same) matched.push({ companyId: c._id, orgId: c.orgId })
      }
    }

    await ctx.db.patch('inboundEmails', inboundEmailId, {
      status: 'received',
      statusReason: undefined,
      error: undefined,
      matchedCompanies: matched,
      matchMethod: 'manual',
      reportIds: undefined,
      notifiedAt: undefined,
      // Manual assignment vouches for the mail. Recap routing still
      // re-checks the ORIGINAL sender at send time (anti-enumeration).
      senderUserId: row.senderUserId ?? user._id,
    })
    await ctx.scheduler.runAfter(
      0,
      row.sources ? internal.reportStore.run : internal.reportExtract.run,
      { inboundEmailId },
    )
    return null
  },
})

/** Replay the whole pipeline for a row (auth re-checked, state reset). */
export const reprocess = mutation({
  args: { inboundEmailId: v.id('inboundEmails') },
  handler: async (ctx, { inboundEmailId }) => {
    await requireAnyMember(ctx)
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) throw new ConvexError('not_found')
    if (row.status === 'processing') throw new ConvexError('invalid_status')

    const senderUserId = await memberUserIdFor(ctx, row.fromEmail)
    await ctx.db.patch('inboundEmails', inboundEmailId, {
      status: senderUserId ? 'received' : 'needs_review',
      statusReason: senderUserId ? undefined : 'unknown_sender',
      senderUserId: senderUserId ?? undefined,
      matchedCompanies: undefined,
      matchMethod: undefined,
      realSenderEmail: undefined,
      sources: undefined,
      extractedText: undefined,
      reportIds: undefined,
      error: undefined,
      notifiedAt: undefined,
      processedAt: undefined,
    })
    if (senderUserId) {
      await ctx.scheduler.runAfter(0, internal.reportIdentify.run, { inboundEmailId })
    }
    return null
  },
})

/** Discard a reviewed email (kept in the list, never processed). */
export const reject = mutation({
  args: { inboundEmailId: v.id('inboundEmails') },
  handler: async (ctx, { inboundEmailId }) => {
    await requireAnyMember(ctx)
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) throw new ConvexError('not_found')
    if (row.status !== 'needs_review' && row.status !== 'received') {
      throw new ConvexError('invalid_status')
    }
    await ctx.db.patch('inboundEmails', inboundEmailId, {
      status: 'rejected',
      statusReason: 'manual_reject',
    })
    return null
  },
})
