/**
 * Report pipeline orchestrator.
 *
 * Triggered by the AgentMail webhook (convex/agentmail.ts) which schedules
 * `run`. Flow: dedup → extract content → resolve company/org → Cerveau 1
 * (extraction) → store (companyReports + documents) → trigger Cerveau 3
 * (intelligence, non-blocking) → reply confirmation.
 *
 * Notes:
 * - OCR of PDF/Excel attachments is deferred (Mistral). Files are stored as-is;
 *   only the email text/html feeds the analysis for now.
 * - Single shared inbox: the orgId is derived from the matched company.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { downloadAttachment, getMessage, replyToMessage } from './agentmail'
import { detectLinks, htmlToText } from './lib/reportLinks'
import {
  buildBodyMentionText,
  extractCompanyDomain,
  extractCompanyNamesFromSubject,
  nameAppearsInText,
  normalizePeriodDisplay,
  parsePeriodToSortMs,
} from './lib/reportMatching'
import type { Doc, Id } from './_generated/dataModel'

const PIPELINE_VERSION = 'albo-os-v1'
const MAX_FILE_BYTES = 20 * 1024 * 1024 // Convex storage cap (cf. documents.ts)

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
  date: v.optional(v.number()),
  attachments: v.array(
    v.object({
      attachmentId: v.string(),
      filename: v.string(),
      contentType: v.optional(v.string()),
      size: v.optional(v.number()),
      inline: v.optional(v.boolean()),
    }),
  ),
})

const reportTypeValidator = v.union(
  v.literal('monthly'),
  v.literal('bimonthly'),
  v.literal('quarterly'),
  v.literal('semi-annual'),
  v.literal('annual'),
)

const fileValidator = v.object({
  storageId: v.id('_storage'),
  filename: v.string(),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  inline: v.boolean(),
  extractedText: v.optional(v.string()),
})

// ─── Dedup ───────────────────────────────────────────────────────────────────

export const findByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }): Promise<Id<'companyReports'> | null> => {
    const existing = await ctx.db
      .query('companyReports')
      .withIndex('by_message_id', (q) => q.eq('agentmailMessageId', messageId))
      .first()
    return existing?._id ?? null
  },
})

// ─── Company / org resolution (cross-org, single inbox) ──────────────────────

interface ResolvedCompany {
  companyId: Id<'companies'>
  orgId: Id<'organizations'>
  companyName: string
}

export const resolveCompanyInternal = internalQuery({
  args: { fromEmail: v.string(), subject: v.string(), bodyText: v.string() },
  handler: async (ctx, { fromEmail, subject, bodyText }): Promise<ResolvedCompany | null> => {
    const domain = extractCompanyDomain(bodyText, fromEmail)
    const names = extractCompanyNamesFromSubject(subject)
    const mentionText = buildBodyMentionText(subject, bodyText)

    // Collect active companies across all orgs (portfolio is small).
    const orgs = await ctx.db.query('organizations').collect()
    const all: Array<Doc<'companies'>> = []
    for (const org of orgs) {
      const cs = await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', org._id))
        .collect()
      for (const c of cs) if (!c.archivedAt) all.push(c)
    }

    const pick = (c: Doc<'companies'>): ResolvedCompany => ({
      companyId: c._id,
      orgId: c.orgId,
      companyName: c.name,
    })

    // PASS 1a — subject name (company name contains the candidate).
    for (const name of names) {
      const lname = name.toLowerCase()
      const hit = all.find((c) => c.name.toLowerCase().includes(lname))
      if (hit) return pick(hit)
    }

    // PASS 1b — body domain.
    if (domain) {
      const hit = all.find((c) => (c.domain ?? '').toLowerCase() === domain)
      if (hit) return pick(hit)
    }

    // PASS 2 — body mention, longest (most specific) name wins.
    const mentions = all
      .filter((c) => nameAppearsInText(c.name, mentionText))
      .sort((a, b) => b.name.length - a.name.length)
    if (mentions[0]) return pick(mentions[0])

    return null
  },
})

// ─── Store ───────────────────────────────────────────────────────────────────

export const storeReport = internalMutation({
  args: {
    orgId: v.id('organizations'),
    companyId: v.id('companies'),
    agentmailInboxId: v.string(),
    agentmailMessageId: v.string(),
    agentmailThreadId: v.optional(v.string()),
    fromEmail: v.string(),
    subject: v.string(),
    emailDate: v.optional(v.number()),
    title: v.string(),
    headline: v.string(),
    keyHighlights: v.array(v.string()),
    reportPeriod: v.string(),
    periodSortDate: v.optional(v.number()),
    reportType: reportTypeValidator,
    reportAbout: v.union(
      v.literal('company_self'),
      v.literal('fund_portfolio_company'),
    ),
    metrics: v.any(),
    rawContent: v.string(),
    cleanedHtml: v.string(),
    files: v.array(fileValidator),
  },
  handler: async (ctx, args): Promise<Id<'companyReports'>> => {
    const reportFields = {
      orgId: args.orgId,
      companyId: args.companyId,
      source: 'email' as const,
      agentmailInboxId: args.agentmailInboxId,
      agentmailMessageId: args.agentmailMessageId,
      agentmailThreadId: args.agentmailThreadId,
      fromEmail: args.fromEmail,
      subject: args.subject,
      emailDate: args.emailDate,
      title: args.title,
      headline: args.headline,
      keyHighlights: args.keyHighlights,
      reportPeriod: args.reportPeriod,
      periodSortDate: args.periodSortDate,
      reportType: args.reportType,
      reportAbout: args.reportAbout,
      metrics: args.metrics,
      rawContent: args.rawContent,
      cleanedHtml: args.cleanedHtml,
      status: 'completed' as const,
      pipelineVersion: PIPELINE_VERSION,
      processedAt: Date.now(),
    }

    // Dedup on (company, period): re-import updates in place.
    let reportId: Id<'companyReports'>
    const existing = args.reportPeriod
      ? await ctx.db
          .query('companyReports')
          .withIndex('by_company_period', (q) =>
            q.eq('companyId', args.companyId).eq('reportPeriod', args.reportPeriod),
          )
          .first()
      : null

    if (existing) {
      await ctx.db.patch("companyReports", existing._id, reportFields)
      reportId = existing._id
      const olds = await ctx.db
        .query('documents')
        .withIndex('by_report', (q) => q.eq('reportId', reportId))
        .collect()
      for (const o of olds) {
        await ctx.storage.delete(o.storageId)
        await ctx.db.delete('documents', o._id)
      }
    } else {
      reportId = await ctx.db.insert('companyReports', reportFields)
    }

    for (const f of args.files) {
      await ctx.db.insert('documents', {
        orgId: args.orgId,
        companyId: args.companyId,
        title: f.filename,
        kind: 'reporting',
        storageId: f.storageId,
        contentType: f.contentType,
        size: f.size,
        source: 'email',
        uploadedAt: Date.now(),
        reportId,
        inline: f.inline,
        extractedText: f.extractedText,
      })
    }

    // Keep companyIntelligence.latestReportId in sync.
    const ci = await ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', args.companyId))
      .unique()
    if (ci) await ctx.db.patch("companyIntelligence", ci._id, { latestReportId: reportId })
    else
      await ctx.db.insert('companyIntelligence', {
        orgId: args.orgId,
        companyId: args.companyId,
        latestReportId: reportId,
      })

    return reportId
  },
})

// ─── Orchestrator ────────────────────────────────────────────────────────────

export const run = internalAction({
  args: { message: messageValidator },
  handler: async (ctx, { message: m }) => {
    // 1. Dedup
    const dup = await ctx.runQuery(internal.reportPipeline.findByMessageId, {
      messageId: m.messageId,
    })
    if (dup) {
      console.log(`[reportPipeline] skip duplicate message ${m.messageId}`)
      return
    }

    // 2. Extract content (text/html only; OCR of attachments deferred)
    let text = m.text.trim() || htmlToText(m.html)
    if (!text) {
      const full = await getMessage(m.inboxId, m.messageId)
      if (full) {
        text =
          String(full.text ?? '').trim() || htmlToText(String(full.html ?? ''))
      }
    }
    const links = detectLinks(`${text} ${m.html}`)
    const linkLines = [...links.notion, ...links.googleDrive, ...links.docSend]
    const rawContent = [
      text,
      linkLines.length ? `Liens détectés:\n${linkLines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    // 3. Resolve company / org
    let company = await ctx.runQuery(internal.reportPipeline.resolveCompanyInternal, {
      fromEmail: m.from,
      subject: m.subject,
      bodyText: text,
    })
    if (!company) {
      console.warn(`[reportPipeline] company not found for ${m.from} / "${m.subject}"`)
      await replyToMessage(
        m.inboxId,
        m.messageId,
        `<p>Bonjour,</p><p>Nous n'avons pas pu rattacher ce message à une entreprise du portefeuille. Vérifiez l'expéditeur ou mentionnez le nom de l'entreprise dans l'objet.</p>`,
      )
      return
    }

    // 4. Cerveau 1 — extraction
    const emailDateIso = m.date ? new Date(m.date).toISOString() : new Date(Date.now()).toISOString()
    const analysis = await ctx.runAction(internal.reportAnalysis.analyze, {
      textContent: rawContent,
      companyName: company.companyName,
      subject: m.subject,
      fromEmail: m.from,
      emailDate: emailDateIso,
    })

    // 4b. Fund → portfolio company redirect (with a loose name guard)
    if (analysis.reportAbout === 'fund_portfolio_company' && analysis.targetCompanyName) {
      const re = await ctx.runQuery(internal.reportPipeline.resolveCompanyInternal, {
        fromEmail: m.from,
        subject: analysis.targetCompanyName,
        bodyText: text,
      })
      if (re) {
        const tl = analysis.targetCompanyName.toLowerCase()
        const rl = re.companyName.toLowerCase()
        if (rl.includes(tl) || tl.includes(rl)) company = re
      }
    }

    // 5. Download attachments → Convex storage (no OCR yet)
    const files: Array<{
      storageId: Id<'_storage'>
      filename: string
      contentType?: string
      size?: number
      inline: boolean
    }> = []
    for (const att of m.attachments) {
      const buf = await downloadAttachment(m.inboxId, m.messageId, att.attachmentId)
      if (!buf) continue
      if (buf.byteLength > MAX_FILE_BYTES) {
        console.warn(`[reportPipeline] skip oversized attachment ${att.filename} (${buf.byteLength}B)`)
        continue
      }
      const storageId = await ctx.storage.store(
        new Blob([buf], { type: att.contentType ?? 'application/octet-stream' }),
      )
      files.push({
        storageId,
        filename: att.filename,
        contentType: att.contentType,
        size: buf.byteLength,
        inline: att.inline ?? false,
      })
    }

    // 6. Store
    const reportPeriod = normalizePeriodDisplay(analysis.reportPeriod)
    const periodSortMs = reportPeriod ? parsePeriodToSortMs(reportPeriod) : null
    await ctx.runMutation(internal.reportPipeline.storeReport, {
      orgId: company.orgId,
      companyId: company.companyId,
      agentmailInboxId: m.inboxId,
      agentmailMessageId: m.messageId,
      agentmailThreadId: m.threadId,
      fromEmail: m.from,
      subject: m.subject,
      emailDate: m.date,
      title: analysis.reportTitle,
      headline: analysis.headline,
      keyHighlights: analysis.keyHighlights,
      reportPeriod,
      periodSortDate: periodSortMs ?? undefined,
      reportType: analysis.reportType,
      reportAbout: analysis.reportAbout,
      metrics: analysis.metrics,
      rawContent,
      cleanedHtml: m.html,
      files,
    })

    // 7. Cerveau 3 — synthesis (fire-and-forget)
    await ctx.scheduler.runAfter(0, internal.intelligence.runAnalysis, {
      companyId: company.companyId,
      orgId: company.orgId,
    })

    // 8. Confirmation reply
    await replyToMessage(
      m.inboxId,
      m.messageId,
      `<p>Report bien reçu pour <b>${company.companyName}</b>${
        reportPeriod ? ` — ${reportPeriod}` : ''
      }. Il est désormais disponible dans Albo OS.</p>`,
    )
  },
})
