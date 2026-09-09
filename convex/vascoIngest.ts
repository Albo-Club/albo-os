/**
 * Portal publication → report: the door that lets a VASCO/Parallel
 * communication be DIGESTED like a forwarded report instead of merely
 * displayed.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * A participation reaches us through two channels: a mail forwarded to the
 * AgentMail inbox, and a publication on the fund admin's portal. Only the
 * first was digested — read, summarised, its metrics extracted, its files
 * stored, its text indexed, its content visible to the agent. The second was
 * cached and shown as a title and a date, and nothing else: `listCompanyReports`,
 * the MCP tool and the agent tools read `companyReports` alone, so they answered
 * EMPTY on an entity whose news arrives by portal — the 14 Parallel SPVs of
 * `calte` hold 128 publications and zero report.
 *
 * ── How ────────────────────────────────────────────────────────────────────
 * No second pipeline. `inboundEmails` already accepts a row that never was an
 * email — that is what a manual upload is (`origin: 'upload'`, company already
 * matched, pipeline entered at extraction). A publication is the same shape:
 * a body, attachments, and an entity known from the VASCO link. So it enters
 * through a third origin, `'vasco'`, and everything downstream runs unchanged.
 *
 * The attachments are DOWNLOADED and stored, not linked. The portal's download
 * endpoint is authenticated, and the substance of a publication is usually in
 * its PDF rather than in its cover note — without the bytes the analysis would
 * read an envelope. `reportExtract` already knows how to read an attachment
 * that is already in storage (the path built for the rows bridged from the
 * retired Gmail timeline), so handing it a `storageId` is all it takes.
 *
 * ── What it must never do ──────────────────────────────────────────────────
 * OVERWRITE A REPORT THAT CAME BY MAIL. Storage dedups on (company, period)
 * and updates in place — right for a corrected re-send, catastrophic here: a
 * publication whose body is a cover note and whose PDF failed to OCR would
 * replace a rich mail report, attachments included, and a backfill would do it
 * by the hundred, silently. The rule is enforced in `reportStore.storeForCompany`:
 * a portal publication takes a free slot, never an occupied one.
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * `agentmailMessageId` holds `vasco:<clientSlug>:<communicationId>` — the
 * portal's own id, stable across pulls. Re-running an ingestion is free, an
 * interrupted one resumes, and the cron cannot re-ingest what it re-lists. The
 * key is namespaced by `clientSlug` for the same reason the announcement
 * memory is: a second portal reusing an id must not mask a publication.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import type { Id } from './_generated/dataModel'

/** Placeholder inbox id, mirroring the manual upload's 'manual-upload'. It is
 *  what `reportNotify` reads to know there is no outbound thread here. */
const INBOX_MARKER = 'vasco-portal'

/** Dedup key of the inbound row standing for one publication. */
export function inboundKey(
  clientSlug: string,
  communicationId: string,
): string {
  return `vasco:${clientSlug}:${communicationId}`
}

/** Publication date as a ms epoch, falling back on now: `receivedAt` is
 *  required and feeds the report's own date. */
function receivedAtOf(publishDate: string | undefined): number {
  if (!publishDate) return Date.now()
  const ms = Date.parse(publishDate)
  return Number.isNaN(ms) ? Date.now() : ms
}

/**
 * What is left to ingest for one issuer: the publications with no inbound row
 * yet, and the entities they belong to.
 *
 * Archived entities are excluded — the portal keeps publishing on a position
 * we stopped following, and digesting it would revive a fiche on purpose left
 * quiet. An issuer no entity is linked to yields no company, and the caller
 * then ingests nothing: a publication with nowhere to land is not a report.
 *
 * ⚠️ Entities are looked up across **every** org, not just `orgId`. The same
 * SPV is often held by two of the group's companies — CALTE and Albo Club both
 * subscribed to Bernay — and each keeps its own fiche for it. The publication
 * concerns the operation, so it concerns both investors, and it must land on
 * both fiches: the very fan-out a letter covering two Sezame vehicles already
 * gets. Org-scoping this read is what left CALTE's Bernay fiche empty while
 * Albo's carried all eight publications — the anchor is keyed by portal, not
 * by org, so the first org to run claimed the ids and the second found nothing
 * left to do. `orgId` still decides which cached copy is read and whose
 * connection downloads the files; only the fan-out is group-wide.
 */
export const pendingForIssuer = internalQuery({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (ctx, { orgId, clientSlug, issuerId }) => {
    // Full scan: the VASCO link carries no index, and the lookup is group-wide
    // by design (see above). `companies` rows are light — nothing of
    // `rawContent` size lives here — and this runs once per issuer, from a
    // refresh or a migration, never from a user-facing query.
    const companies = (await ctx.db.query('companies').collect())
      .filter(
        (c) =>
          c.kind === 'portfolio' &&
          c.archivedAt == null &&
          c.vascoClientSlug === clientSlug &&
          c.vascoIssuerId === issuerId,
      )
      .map((c) => ({ companyId: c._id, orgId: c.orgId }))
    if (companies.length === 0) return { companies, communications: [] }

    const rows = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const communications = []
    for (const row of rows) {
      if (row.clientSlug !== clientSlug || row.issuerId !== issuerId) continue
      const existing = await ctx.db
        .query('inboundEmails')
        .withIndex('by_message_id', (q) =>
          q.eq('agentmailMessageId', inboundKey(clientSlug, row.communicationId)),
        )
        .first()
      if (existing) continue
      communications.push({
        communicationId: row.communicationId,
        title: row.title,
        bodyText: row.bodyText,
        publishDate: row.publishDate,
        documents: row.documents,
      })
    }
    return { companies, communications }
  },
})

/**
 * Create the inbound row of one publication and start the pipeline on it.
 *
 * The dedup key is re-read here, inside the transaction: the caller checked it
 * before downloading, and a concurrent pull may have ingested the same
 * publication in between. Returns null in that case — the blobs already stored
 * are then orphaned, which is the cheap side of the trade (Convex storage has
 * no transactional rollback, and a duplicate report would be the expensive one).
 */
export const createInbound = internalMutation({
  args: {
    clientSlug: v.string(),
    communicationId: v.string(),
    subject: v.string(),
    bodyText: v.optional(v.string()),
    receivedAt: v.number(),
    companies: v.array(
      v.object({
        companyId: v.id('companies'),
        orgId: v.id('organizations'),
      }),
    ),
    attachments: v.array(
      v.object({
        attachmentId: v.string(),
        filename: v.string(),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        storageId: v.id('_storage'),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<'inboundEmails'> | null> => {
    const key = inboundKey(args.clientSlug, args.communicationId)
    const existing = await ctx.db
      .query('inboundEmails')
      .withIndex('by_message_id', (q) => q.eq('agentmailMessageId', key))
      .first()
    if (existing) return null

    const id = await ctx.db.insert('inboundEmails', {
      origin: 'vasco',
      agentmailInboxId: INBOX_MARKER,
      agentmailMessageId: key,
      // Not a mailbox anyone writes to: the portal has no sender. It is never
      // replied to (`reportNotify` refuses a non-email origin) and never
      // matched to a member — it exists because the field is required.
      fromEmail: `portail@${args.clientSlug}.vasco.fund`,
      toEmails: [],
      ccEmails: [],
      subject: args.subject,
      receivedAt: args.receivedAt,
      bodyText: args.bodyText,
      attachments: args.attachments,
      status: 'received',
      // The entity is known from the VASCO link, so identification (brick 3)
      // is skipped exactly as it is for an upload.
      matchedCompanies: args.companies,
      matchMethod: 'vasco_link',
    })
    await ctx.scheduler.runAfter(0, internal.reportExtract.run, {
      inboundEmailId: id,
    })
    return id
  },
})

/**
 * Ingest every publication of one issuer that has no inbound row yet.
 *
 * One action per issuer, never per org: the loop downloads files and each
 * publication starts an independent pipeline run, so a long issuer cannot
 * drag the others down and a failure never buries them.
 *
 * A document that will not download is skipped with its siblings kept — the
 * publication is still worth digesting for its body, and the pipeline records
 * what it could not read.
 */
export const ingestIssuer = internalAction({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (
    ctx,
    { orgId, clientSlug, issuerId },
  ): Promise<{ ingested: number; skipped: number }> => {
    const pending: {
      companies: Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }>
      communications: Array<{
        communicationId: string
        title?: string
        bodyText?: string
        publishDate?: string
        documents: Array<{
          documentId: string
          name?: string
          contentType?: string
        }>
      }>
    } = await ctx.runQuery(internal.vascoIngest.pendingForIssuer, {
      orgId,
      clientSlug,
      issuerId,
    })
    if (pending.companies.length === 0) return { ingested: 0, skipped: 0 }

    let ingested = 0
    let skipped = 0
    for (const comm of pending.communications) {
      const attachments = []
      for (const doc of comm.documents) {
        const stored: {
          storageId: Id<'_storage'>
          contentType?: string
          size?: number
        } | null = await ctx.runAction(
          internal.vasco.storeCommunicationDocument,
          { orgId, clientSlug, documentId: doc.documentId },
        )
        if (!stored) continue
        attachments.push({
          attachmentId: doc.documentId,
          filename: doc.name ?? `document-${doc.documentId}`,
          contentType: doc.contentType ?? stored.contentType,
          size: stored.size,
          storageId: stored.storageId,
        })
      }

      const created: Id<'inboundEmails'> | null = await ctx.runMutation(
        internal.vascoIngest.createInbound,
        {
          clientSlug,
          communicationId: comm.communicationId,
          subject: comm.title ?? 'Communication Parallel',
          bodyText: comm.bodyText,
          receivedAt: receivedAtOf(comm.publishDate),
          companies: pending.companies,
          attachments,
        },
      )
      if (created) ingested += 1
      else skipped += 1
    }
    return { ingested, skipped }
  },
})
