/**
 * Reporting ingestion — inbound portfolio reports (investor updates).
 *
 * Albo OS is the DESTINATION here: the heavy lifting (parse email, OCR PDF/
 * Excel/Notion, LLM analysis, metric extraction) runs in a separate pipeline
 * (the "machine"). That pipeline pushes an already-structured report; this
 * module stores it, dedups it, and resolves its target company.
 *
 * Flow:
 *   1. `reportsUploadUrl` (httpAction, HMAC) → a Convex storage upload URL.
 *      The machine uploads each file, gets a `storageId`.
 *   2. `reportsIngest` (httpAction, HMAC) → `ingestReport` (internalMutation):
 *      org resolution by slug, company resolution (id/attio/domain/name),
 *      idempotency by `(orgId, emailMessageId)`, then insert of the
 *      `companyReports` envelope + one `reportMetrics` row per metric.
 *
 * Unresolved company → the report lands as `unresolved` for manual triage
 * (`assignCompany`). Reads (`listByCompany`, `get`, `listUnresolved`) are the
 * human surface.
 *
 * Webhook security mirrors Powens/Attio: HMAC-SHA256 (hex) over
 * `${timestamp}.${rawBody}` (headers `X-Albo-Signature` + `X-Albo-Timestamp`),
 * verified via Web Crypto (`crypto.subtle.verify` — the Convex runtime has no
 * Node `timingSafeEqual`). The timestamp is checked against a 5-minute window
 * to blunt replays. Secret: `REPORTS_WEBHOOK_SECRET`.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  httpAction,
  internalMutation,
  mutation,
  query,
} from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { normalizeSearch } from './lib/searchText'
import {
  reportFileType,
  reportMetricValueType,
  reportSource,
  reportType,
} from './schema'
import type { Infer } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const MAX_BYTES = 20 * 1024 * 1024 // project storage cap (cf. files.ts)
const REPLAY_WINDOW_MS = 5 * 60 * 1000

// ─── HMAC signature verification ─────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error('bad_hex')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('bad_hex')
    bytes[i] = byte
  }
  return bytes
}

async function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
): Promise<boolean> {
  const secret = process.env.REPORTS_WEBHOOK_SECRET
  if (!secret) throw new ConvexError('missing_reports_webhook_secret')
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  let sigBytes: Uint8Array<ArrayBuffer>
  try {
    sigBytes = hexToBytes(signature.trim())
  } catch {
    return false
  }
  const messageBytes: Uint8Array<ArrayBuffer> = new Uint8Array(
    enc.encode(`${timestamp}.${rawBody}`),
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, messageBytes)
}

// ─── Org + company resolution ────────────────────────────────────────────────

async function orgBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<'organizations'>> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${slug}`)
  return org
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/**
 * Resolve the report's target company within the org, trying the strongest
 * signal first: explicit id → Attio bridge → domain → name. Returns undefined
 * when nothing matches (the report is then stored as `unresolved`).
 */
async function resolveCompanyId(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  hints: {
    companyId?: Id<'companies'>
    attioCompanyId?: string
    companyDomain?: string
    companyName?: string
  },
): Promise<Id<'companies'> | undefined> {
  if (hints.companyId) {
    const company = await ctx.db.get('companies', hints.companyId)
    if (company && company.orgId === orgId) return company._id
  }
  if (hints.attioCompanyId) {
    const attioId = hints.attioCompanyId
    const matches = await ctx.db
      .query('companies')
      .withIndex('by_attio_company_id', (q) => q.eq('attioCompanyId', attioId))
      .collect()
    const inOrg = matches.find((c) => c.orgId === orgId)
    if (inOrg) return inOrg._id
  }
  if (hints.companyDomain || hints.companyName) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    if (hints.companyDomain) {
      const domain = normalizeDomain(hints.companyDomain)
      const byDomain = companies.find(
        (c) => c.domain && normalizeDomain(c.domain) === domain,
      )
      if (byDomain) return byDomain._id
    }
    if (hints.companyName) {
      const name = normalizeSearch(hints.companyName)
      const byName = companies.find(
        (c) =>
          normalizeSearch(c.name) === name ||
          (c.legalName != null && normalizeSearch(c.legalName) === name),
      )
      if (byName) return byName._id
    }
  }
  return undefined
}

// ─── Payload validators (shared between httpAction and internalMutation) ─────

const fileInput = v.object({
  storageId: v.id('_storage'),
  fileName: v.string(),
  fileType: reportFileType,
  sourceUrl: v.optional(v.string()),
})

const metricInput = v.object({
  metricKey: v.string(),
  canonicalKey: v.optional(v.string()), // defaults to a slug of metricKey
  category: v.optional(v.string()),
  valueType: reportMetricValueType,
  value: v.optional(v.number()),
  textValue: v.optional(v.string()),
  unit: v.optional(v.string()),
  reportPeriod: v.optional(v.string()),
  periodSortDate: v.optional(v.number()),
})

const reportInput = v.object({
  reportType: v.optional(reportType),
  reportPeriod: v.optional(v.string()),
  periodStart: v.optional(v.number()),
  periodEnd: v.optional(v.number()),
  reportDate: v.optional(v.number()),
  headline: v.optional(v.string()),
  keyHighlights: v.optional(v.array(v.string())),
  rawContent: v.optional(v.string()),
  cleanedContent: v.optional(v.string()),
  emailSubject: v.optional(v.string()),
  emailFrom: v.optional(v.string()),
  emailDate: v.optional(v.number()),
  emailMessageId: v.optional(v.string()),
  sourceThreadId: v.optional(v.string()),
  pipelineVersion: v.optional(v.string()),
})

const ingestArgs = {
  orgSlug: v.string(),
  // Company resolution hints (any subset; strongest wins).
  companyId: v.optional(v.id('companies')),
  attioCompanyId: v.optional(v.string()),
  companyDomain: v.optional(v.string()),
  companyName: v.optional(v.string()),
  source: v.optional(reportSource),
  report: reportInput,
  files: v.optional(v.array(fileInput)),
  metrics: v.optional(v.array(metricInput)),
}
type IngestArgs = Infer<ReturnType<typeof v.object<typeof ingestArgs>>>

type FileInput = Infer<typeof fileInput>

async function buildFiles(
  ctx: MutationCtx,
  input: Array<FileInput> | undefined,
): Promise<Doc<'companyReports'>['files']> {
  if (!input || input.length === 0) return undefined
  const out: NonNullable<Doc<'companyReports'>['files']> = []
  for (const f of input) {
    const meta = await ctx.db.system.get('_storage', f.storageId)
    if (!meta) throw new ConvexError(`file_not_found:${f.fileName}`)
    if (meta.size > MAX_BYTES) {
      await ctx.storage.delete(f.storageId)
      throw new ConvexError(`file_too_large:${f.fileName}`)
    }
    out.push({
      storageId: f.storageId,
      fileName: f.fileName,
      mimeType: meta.contentType ?? undefined,
      size: meta.size,
      fileType: f.fileType,
      sourceUrl: f.sourceUrl,
    })
  }
  return out
}

function canonicalize(metricKey: string, canonicalKey?: string): string {
  const explicit = canonicalKey?.trim()
  if (explicit) return explicit
  return normalizeSearch(metricKey).replace(/\s+/g, '_')
}

// ─── Ingestion (internal mutation, called by the webhook) ────────────────────

export const ingestReport = internalMutation({
  args: ingestArgs,
  handler: async (ctx, args) => {
    const org = await orgBySlug(ctx, args.orgSlug)

    // Idempotency: a re-pushed email returns the existing row.
    const messageId = args.report.emailMessageId
    if (messageId) {
      const existing = await ctx.db
        .query('companyReports')
        .withIndex('by_email_message_id', (q) =>
          q.eq('orgId', org._id).eq('emailMessageId', messageId),
        )
        .first()
      if (existing) {
        return {
          reportId: existing._id,
          duplicate: true,
          resolutionStatus: existing.resolutionStatus,
          metricsCount: 0,
        }
      }
    }

    const companyId = await resolveCompanyId(ctx, org._id, args)
    const files = await buildFiles(ctx, args.files)
    const now = Date.now()

    const reportId = await ctx.db.insert('companyReports', {
      orgId: org._id,
      companyId,
      resolutionStatus: companyId ? 'resolved' : 'unresolved',
      companyHintName: args.companyName,
      companyHintDomain: args.companyDomain,
      reportType: args.report.reportType,
      reportPeriod: args.report.reportPeriod,
      periodStart: args.report.periodStart,
      periodEnd: args.report.periodEnd,
      reportDate: args.report.reportDate,
      headline: args.report.headline,
      keyHighlights: args.report.keyHighlights,
      rawContent: args.report.rawContent,
      cleanedContent: args.report.cleanedContent,
      emailSubject: args.report.emailSubject,
      emailFrom: args.report.emailFrom,
      emailDate: args.report.emailDate,
      emailMessageId: messageId,
      sourceThreadId: args.report.sourceThreadId,
      files,
      source: args.source ?? 'email',
      pipelineVersion: args.report.pipelineVersion,
      ingestedAt: now,
    })

    const metrics = args.metrics ?? []
    for (const m of metrics) {
      await ctx.db.insert('reportMetrics', {
        orgId: org._id,
        reportId,
        companyId,
        metricKey: m.metricKey,
        canonicalKey: canonicalize(m.metricKey, m.canonicalKey),
        category: m.category,
        valueType: m.valueType,
        value: m.value,
        textValue: m.textValue,
        unit: m.unit,
        reportPeriod: m.reportPeriod ?? args.report.reportPeriod,
        periodSortDate: m.periodSortDate ?? args.report.periodEnd,
      })
    }

    return {
      reportId,
      duplicate: false,
      resolutionStatus: companyId ? 'resolved' : 'unresolved',
      metricsCount: metrics.length,
    }
  },
})

// ─── HTTP actions (webhooks called by the ingestion pipeline) ────────────────

export const reportsUploadUrl = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('X-Albo-Signature')
  const timestamp = request.headers.get('X-Albo-Timestamp')
  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 400 })
  }
  const ok = await verifySignature(rawBody, timestamp, signature)
  if (!ok) return new Response('Invalid signature', { status: 401 })
  const url = await ctx.storage.generateUploadUrl()
  return Response.json({ url })
})

export const reportsIngest = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('X-Albo-Signature')
  const timestamp = request.headers.get('X-Albo-Timestamp')
  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 400 })
  }
  const ok = await verifySignature(rawBody, timestamp, signature)
  if (!ok) return new Response('Invalid signature', { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  try {
    const result = await ctx.runMutation(
      internal.reports.ingestReport,
      payload as IngestArgs,
    )
    return Response.json(result)
  } catch (err) {
    const data = err instanceof ConvexError ? err.data : 'ingest_failed'
    return Response.json({ error: data }, { status: 400 })
  }
})

// ─── Reads + triage (human surface) ──────────────────────────────────────────

function pickReportSummary(row: Doc<'companyReports'>) {
  return {
    _id: row._id,
    companyId: row.companyId ?? null,
    resolutionStatus: row.resolutionStatus,
    companyHintName: row.companyHintName ?? null,
    companyHintDomain: row.companyHintDomain ?? null,
    reportType: row.reportType ?? null,
    reportPeriod: row.reportPeriod ?? null,
    periodStart: row.periodStart ?? null,
    periodEnd: row.periodEnd ?? null,
    reportDate: row.reportDate ?? null,
    headline: row.headline ?? null,
    emailFrom: row.emailFrom ?? null,
    emailSubject: row.emailSubject ?? null,
    source: row.source,
    fileCount: row.files?.length ?? 0,
    ingestedAt: row.ingestedAt,
  }
}

/** A company's reports, most recent period first. */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    const rows = await ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(200)
    return rows.map(pickReportSummary)
  },
})

/** Full report with its metrics and file download URLs. */
export const get = query({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) throw new ConvexError('not_found')
    await requireOrgMember(ctx, report.orgId)
    const metrics = await ctx.db
      .query('reportMetrics')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()
    const files = await Promise.all(
      (report.files ?? []).map(async (f) => ({
        ...f,
        url: await ctx.storage.getUrl(f.storageId),
      })),
    )
    return { ...report, files, metrics }
  },
})

/** Reports whose target company could not be resolved — triage queue. */
export const listUnresolved = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('companyReports')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('resolutionStatus', 'unresolved'),
      )
      .order('desc')
      .take(200)
    return rows.map(pickReportSummary)
  },
})

/** Manual triage: attach an unresolved report to a company. */
export const assignCompany = mutation({
  args: {
    reportId: v.id('companyReports'),
    companyId: v.id('companies'),
  },
  handler: async (ctx, { reportId, companyId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) throw new ConvexError('not_found')
    await requireOrgMember(ctx, report.orgId)
    const company = await ctx.db.get('companies', companyId)
    if (!company || company.orgId !== report.orgId) {
      throw new ConvexError('invalid_company')
    }
    await ctx.db.patch('companyReports', reportId, {
      companyId,
      resolutionStatus: 'resolved',
    })
    // Backfill the mirrored companyId on the report's metrics.
    const metrics = await ctx.db
      .query('reportMetrics')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()
    for (const m of metrics) {
      if (m.companyId !== companyId) {
        await ctx.db.patch('reportMetrics', m._id, { companyId })
      }
    }
    return null
  },
})

/** Manual triage: discard a report (spam / off-topic). */
export const ignoreReport = mutation({
  args: { reportId: v.id('companyReports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get('companyReports', reportId)
    if (!report) throw new ConvexError('not_found')
    await requireOrgMember(ctx, report.orgId)
    await ctx.db.patch('companyReports', reportId, {
      resolutionStatus: 'ignored',
    })
    return null
  },
})
