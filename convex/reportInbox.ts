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
import { identityKey, sharedDomains } from './lib/emailIdentify'
import { RETRY_BACKOFFS_MS } from './lib/modelRetry'
import { recomputeReportFreshness } from './lib/reportFreshness'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

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

/**
 * Reschedule a brick that failed on a TRANSIENT model error (brick 3 or 5).
 *
 * Returns false once the budget is spent, and the caller then records the
 * failure as before — so a definitive problem still reaches the user, just
 * not a hiccup that clears on its own. The row goes back to 'received', which
 * is exactly what each brick's claim mutation requires, so the retry re-enters
 * through the normal door. No notification is sent here on purpose: a
 * recovered hiccup must cost the user nothing, not even a mail. A premature
 * failure mail would not silence the success recap that follows —
 * `claimNotify` lets that one through — but it would announce a problem that
 * never was, and then correct itself. Two mails for a non-event.
 */
export const retryAfterTransient = internalMutation({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    step: v.union(v.literal('identify'), v.literal('analyze')),
  },
  handler: async (ctx, { inboundEmailId, step }): Promise<boolean> => {
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) return false
    // A failure on another step than the one being counted starts its own
    // budget — no reset to write anywhere else in the pipeline.
    const attempt = row.retryStep === step ? (row.retryAttempts ?? 0) + 1 : 1
    if (attempt > RETRY_BACKOFFS_MS.length) return false
    const delay = RETRY_BACKOFFS_MS[attempt - 1]

    await ctx.db.patch('inboundEmails', inboundEmailId, {
      status: 'received',
      retryStep: step,
      retryAttempts: attempt,
    })
    await ctx.scheduler.runAfter(
      delay,
      step === 'identify' ? internal.reportIdentify.run : internal.reportStore.run,
      { inboundEmailId },
    )
    console.warn(
      `[reportInbox] ${step} failed transiently for ${row.agentmailMessageId}, retry ${attempt}/${RETRY_BACKOFFS_MS.length} in ${delay / 1000}s`,
    )
    return true
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
    const user = await requireAnyMember(ctx)

    const rows = await ctx.db.query('inboundEmails').order('desc').take(100)
    // Portfolio of the caller's orgs, read once: used to spot an org left
    // out of a report it may concern (see `relatedOrgNames` below).
    const visible = await visiblePortfolio(ctx, user._id)
    const orgNames = new Map<Id<'organizations'>, string>()
    for (const org of await ctx.db.query('organizations').collect()) {
      orgNames.set(org._id, org.name)
    }

    return Promise.all(
      rows.map(async (r) => {
        // Resolve matched participation names for display (≤100 rows × a few
        // entities each — bounded).
        const matchedCompanies = await Promise.all(
          (r.matchedCompanies ?? []).map(async (m) => ctx.db.get('companies', m.companyId)),
        )
        // The suggestion flag: an organization that received NOTHING from this
        // report, while it holds a company on one of the matched domains. That
        // is the "one company, two orgs, two names" case (Oprtrs & Co /
        // OPRTRS CLUB), which no identity rule can merge on its own.
        //
        // Naming the ORG rather than counting entities is deliberate: on a
        // sponsor domain the other org holds a dozen unrelated vehicles, so a
        // count would read "+15" on every Parallel report and mean nothing.
        // And a report already stored in both orgs raises no flag at all.
        const matchedOrgs = new Set(matchedCompanies.map((c) => c?.orgId))
        const matchedDomains = new Set(
          matchedCompanies
            .map((c) => c?.domain?.toLowerCase())
            .filter((d): d is string => !!d),
        )
        const relatedOrgIds = new Set(
          visible
            .filter(
              (c) =>
                !matchedOrgs.has(c.orgId) &&
                c.domain != null &&
                matchedDomains.has(c.domain.toLowerCase()),
            )
            .map((c) => c.orgId),
        )
        const relatedOrgNames = [...relatedOrgIds]
          .map((orgId) => orgNames.get(orgId))
          .filter((n): n is string => !!n)
        // Which stored report belongs to which entity, so the queue can offer
        // to detach the one that landed on the wrong participation. Empty
        // until the row is processed — and on rows stored before `reportIds`
        // was recorded, where the fiche stays the way in.
        const reportByCompany = new Map<string, Id<'companyReports'>>()
        for (const reportId of r.reportIds ?? []) {
          const report = await ctx.db.get('companyReports', reportId)
          if (report) reportByCompany.set(report.companyId, report._id)
        }
        const sources = r.sources ?? []
        return {
          _id: r._id,
          fromEmail: r.fromEmail,
          subject: r.subject,
          receivedAt: r.receivedAt,
          status: r.status,
          statusReason: r.statusReason ?? null,
          // Raw technical message behind a failure. Dev-facing (never
          // translated), but surfaced: without it a pipeline error is only
          // readable from the Convex dashboard.
          error: r.error ?? null,
          senderVerified: Boolean(r.senderUserId),
          // One entry per attached ENTITY (not per name): two orgs holding the
          // same participation are two rows to detach independently.
          matched: matchedCompanies
            .filter((c): c is Doc<'companies'> => !!c)
            .map((c) => ({
              companyId: c._id,
              name: c.name,
              reportId: reportByCompany.get(c._id) ?? null,
            })),
          relatedOrgNames,
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

/** Active portfolio companies of every org the user belongs to. */
async function visiblePortfolio(ctx: QueryCtx, userId: Id<'users'>) {
  const memberships = await ctx.db
    .query('organizationMembers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  const out: Array<Doc<'companies'>> = []
  for (const m of memberships) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) => q.eq('orgId', m.orgId).eq('kind', 'portfolio'))
      .collect()
    for (const c of companies) {
      if (!c.archivedAt) out.push(c)
    }
  }
  return out
}

/**
 * Assignable targets: the caller's orgs' active portfolio companies. `domain`
 * comes along so the dialog can offer the entities related to the chosen one
 * (same domain, other org) — a suggestion the user ticks, never a match.
 */
export const listAssignTargets = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAnyMember(ctx)
    const orgNames = new Map<Id<'organizations'>, string>()
    const out: Array<{
      companyId: Id<'companies'>
      orgId: Id<'organizations'>
      name: string
      orgName: string
      domain: string | null
    }> = []
    for (const c of await visiblePortfolio(ctx, user._id)) {
      let orgName = orgNames.get(c.orgId)
      if (orgName === undefined) {
        orgName = (await ctx.db.get('organizations', c.orgId))?.name ?? ''
        orgNames.set(c.orgId, orgName)
      }
      out.push({
        companyId: c._id,
        orgId: c.orgId,
        name: c.name,
        orgName,
        domain: c.domain?.toLowerCase() ?? null,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

/**
 * Every entity representing the same participation as `company`, across all
 * orgs — same identity key as automatic identification
 * (convex/lib/emailIdentify.ts): the domain when it carries a single
 * participation, else the name. A sponsor domain shared by several vehicles
 * (Sezame Immo 2 / 6) therefore fans out to the chosen vehicle only.
 */
async function sameParticipation(
  ctx: MutationCtx,
  company: Doc<'companies'>,
): Promise<Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }>> {
  const all: Array<{
    companyId: Id<'companies'>
    orgId: Id<'organizations'>
    name: string
    domain: string | null
  }> = []
  const orgs = await ctx.db.query('organizations').collect()
  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) => q.eq('orgId', org._id).eq('kind', 'portfolio'))
      .collect()
    for (const c of companies) {
      // The chosen company is kept even when archived — it is an explicit pick.
      if (c.archivedAt && c._id !== company._id) continue
      all.push({
        companyId: c._id,
        orgId: c.orgId,
        name: c.name,
        domain: c.domain?.toLowerCase() ?? null,
      })
    }
  }
  const shared = sharedDomains(all)
  const key = identityKey(
    { name: company.name, domain: company.domain?.toLowerCase() ?? null },
    shared,
  )
  return all
    .filter((c) => identityKey(c, shared) === key)
    .map(({ companyId, orgId }) => ({ companyId, orgId }))
}

/**
 * Manually attach a reviewed email to one or several participations, then
 * resume the pipeline where it stopped (extraction if not done, else
 * storage). Each pick fans out to every entity representing it — the same
 * identity rule as automatic identification.
 *
 * On an ALREADY PROCESSED row the call is ADDITIVE: the picks are added to
 * the entities already attached, never replacing them. That is the only way
 * to serve one company held by both orgs under different names (Oprtrs & Co
 * / OPRTRS CLUB), which no identity rule can merge on its own. Re-running
 * the storage is safe — it upserts per (company, period), so the entities
 * already stored are updated in place while the new ones are created.
 */
export const assignCompany = mutation({
  args: {
    inboundEmailId: v.id('inboundEmails'),
    companyIds: v.array(v.id('companies')),
  },
  handler: async (ctx, { inboundEmailId, companyIds }) => {
    const user = await requireAppUser(ctx)
    if (companyIds.length === 0) throw new ConvexError('invalid_args')
    const row = await ctx.db.get('inboundEmails', inboundEmailId)
    if (!row) throw new ConvexError('not_found')
    const additive = row.status === 'processed'
    if (!additive && row.status !== 'needs_review' && row.status !== 'rejected') {
      throw new ConvexError('invalid_status')
    }

    const matched = new Map<string, { companyId: Id<'companies'>; orgId: Id<'organizations'> }>()
    if (additive) {
      for (const m of row.matchedCompanies ?? []) matched.set(m.companyId, m)
    }
    for (const companyId of companyIds) {
      const company = await ctx.db.get('companies', companyId)
      if (!company || company.kind !== 'portfolio') throw new ConvexError('not_found')
      await requireOrgMember(ctx, company.orgId)
      for (const m of await sameParticipation(ctx, company)) matched.set(m.companyId, m)
    }

    await ctx.db.patch('inboundEmails', inboundEmailId, {
      status: 'received',
      statusReason: undefined,
      error: undefined,
      matchedCompanies: [...matched.values()],
      matchMethod: 'manual',
      reportIds: undefined,
      // `notifiedAt` is deliberately left alone: the forwarder already had
      // their answer, and attaching a participation by hand is OUR gesture,
      // not theirs. A row that had failed still gets the one recovery mail
      // when the replay succeeds — that call lives in `claimNotify`.
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

/**
 * The row a report came from. Recent reports carry the back-link; older ones
 * are found again through the AgentMail message id they share with their
 * email. An upload stored before the back-link existed has no way home — the
 * detach below still runs, only the queue row keeps its stale mention.
 */
async function sourceInbound(
  ctx: MutationCtx,
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

/**
 * Detach a stored report from ONE entity — the mirror of `assignCompany`, for
 * a report attached to a participation it does not concern.
 *
 * The scope is that entity alone: the other entities of the fan-out keep
 * their own report. What goes with it is everything `reportStore.storeForCompany`
 * wrote for this entity — the report row, its document rows, the KPI
 * snapshots it sourced, its slot in `companyIntelligence`, its semantic-index
 * entry — so the participation reads as if the report had never landed on it.
 *
 * Storage blobs are deliberately NOT deleted: one blob backs the document
 * rows of EVERY fan-out entity and the source email's attachment. Detaching
 * one participation must not blank the files of the others.
 *
 * The source row is corrected in the same transaction: the review queue stops
 * claiming the participation, and a later replay does not put the report back.
 */
export const detachCompany = mutation({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) throw new ConvexError('not_found')
    await requireOrgMember(ctx, report.orgId)

    // Document rows of this entity only — the blob stays (see above).
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()
    for (const doc of docs) {
      if (doc.companyId === report.companyId) await ctx.db.delete('documents', doc._id)
    }

    // KPI snapshots this report sourced (same tag as reportStore).
    const sourceTag = `report:${reportId}`
    const snapshots = await ctx.db
      .query('kpiSnapshots')
      .withIndex('by_company_metric', (q) => q.eq('companyId', report.companyId))
      .collect()
    for (const snap of snapshots) {
      if (snap.source === sourceTag) await ctx.db.delete('kpiSnapshots', snap._id)
    }

    await ctx.db.delete('companyReports', reportId)

    // Freshness copy on the entity: rebuilt from what is left, since the
    // ingestion side only ever moves it forward (cf. lib/reportFreshness.ts).
    // Detaching the last report must put the participation back in silence.
    await recomputeReportFreshness(ctx, report.companyId)

    // The synthesis pointed here: fall back on the most recent report left on
    // the entity, or clear the pointer when it was the last one.
    const intelligence = await ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', report.companyId))
      .unique()
    if (intelligence && intelligence.latestReportId === reportId) {
      const next = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', report.companyId))
        .order('desc')
        .first()
      await ctx.db.patch('companyIntelligence', intelligence._id, {
        latestReportId: next?._id,
      })
    }

    const inbound = await sourceInbound(ctx, report)
    if (inbound) {
      const matched = (inbound.matchedCompanies ?? []).filter(
        (m) => m.companyId !== report.companyId,
      )
      const remaining = (inbound.reportIds ?? []).filter((id) => id !== reportId)
      await ctx.db.patch('inboundEmails', inbound._id, {
        matchedCompanies: matched.length > 0 ? matched : undefined,
        reportIds: remaining.length > 0 ? remaining : undefined,
      })
    }

    // Drop the semantic-index entry (no-op if the report was never indexed).
    await ctx.scheduler.runAfter(0, internal.vectorize.removeEntry, {
      orgId: report.orgId,
      key: `report:${reportId}`,
    })
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
      // Not reset — see `assignCompany` above and `reportNotify.claimNotify`:
      // replaying a row is silent, except for the recovery mail on success.
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

// ─── Manual upload (company sheet) ───────────────────────────────────────────

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // project storage cap (cf. files.ts)
/** Recent rows scanned for the company sheet's in-progress banner. */
const UPLOAD_SCAN = 50

/**
 * Add a report by hand from a company sheet: the uploaded file(s) enter the
 * SAME pipeline as an emailed report, starting at content extraction. The
 * participation is chosen by the user, so identification (brick 3) is skipped
 * — the match is preset here, with the usual multi-org fan-out.
 *
 * The row is not an email: `origin: 'upload'` marks it, the AgentMail ids are
 * placeholders, and no recap mail goes out (cf. `reportNotify.send`).
 */
export const createFromUpload = mutation({
  args: {
    companyId: v.id('companies'),
    storageIds: v.array(v.id('_storage')),
    filenames: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { companyId, storageIds, filenames, note },
  ): Promise<Id<'inboundEmails'>> => {
    const user = await requireAppUser(ctx)
    if (storageIds.length === 0 || storageIds.length !== filenames.length) {
      throw new ConvexError('invalid_args')
    }
    const company = await ctx.db.get('companies', companyId)
    if (!company || company.kind !== 'portfolio') throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    // Content type and size come from the stored blob, never from the client.
    const attachments = []
    for (const [i, storageId] of storageIds.entries()) {
      const meta = await ctx.db.system.get('_storage', storageId)
      if (!meta) throw new ConvexError('not_found')
      if (meta.size > MAX_UPLOAD_BYTES) {
        await ctx.storage.delete(storageId)
        throw new ConvexError('too_large')
      }
      attachments.push({
        // The storage id is unique per upload — a fine attachment key here.
        attachmentId: storageId,
        filename: filenames[i],
        contentType: meta.contentType ?? undefined,
        size: meta.size,
        storageId,
      })
    }

    const matched = await sameParticipation(ctx, company)
    const trimmedNote = note?.trim()

    const id = await ctx.db.insert('inboundEmails', {
      origin: 'upload',
      agentmailInboxId: 'manual-upload',
      agentmailMessageId: `upload:${storageIds[0]}`,
      fromEmail: user.email,
      toEmails: [],
      ccEmails: [],
      subject: filenames.join(', '),
      receivedAt: Date.now(),
      bodyText: trimmedNote || undefined,
      attachments,
      status: 'received',
      senderUserId: user._id,
      matchedCompanies: matched,
      matchMethod: 'manual_upload',
    })

    await ctx.scheduler.runAfter(0, internal.reportExtract.run, { inboundEmailId: id })
    return id
  },
})

/**
 * Manual uploads of this company still in the pipeline (or stuck in review),
 * for the progress line on its Reports tab. Scans the most recent rows rather
 * than an index: `matchedCompanies` is an array, and manual uploads are rare
 * and short-lived — an older failure stays visible in the review queue.
 */
export const listUploadsInProgress = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const rows = await ctx.db.query('inboundEmails').order('desc').take(UPLOAD_SCAN)
    return rows
      .filter(
        (r) =>
          r.origin === 'upload' &&
          r.status !== 'processed' &&
          r.status !== 'rejected' &&
          (r.matchedCompanies ?? []).some((m) => m.companyId === companyId),
      )
      .map((r) => ({
        _id: r._id,
        subject: r.subject,
        status: r.status,
        statusReason: r.statusReason ?? null,
        receivedAt: r.receivedAt,
      }))
  },
})
