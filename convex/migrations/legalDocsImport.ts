/**
 * One-shot import of the Albo Club legal documentation from Google Drive into
 * `documents` (org `albo`, 42 portfolio companies, ~320 files).
 *
 * Why a migration and not the app's upload form: the files live in the Drive
 * tree « ⚠️ Investissements », one folder per participation, nested up to five
 * levels. Depositing them through the UI means ~50 passes; the mapping work
 * (which document belongs to which company, under which `kind`) was done once,
 * reviewed, and frozen in `scripts/data/legal-docs-albo.json`.
 *
 * Split of responsibilities — the model never carries the bytes:
 *   - `scripts/import-legal-docs.mjs` reads the frozen mapping, pulls each file
 *     from the Drive API and POSTs it to a Convex upload URL;
 *   - this module only mints those URLs and writes the rows.
 * `ctx.storage.generateUploadUrl()` returns a URL that accepts an
 * unauthenticated POST, which is what lets a CLI-driven script upload without
 * a user session.
 *
 * Idempotency: `attachBatch` skips a row when the company already carries a
 * document with the same title AND the same byte size. That triple is the same
 * key the mapping was deduplicated on, and it is what already protected the six
 * Wheelee documents deposited by hand before this import. Re-running is a
 * no-op; an interrupted run resumes by simply re-running.
 *
 * What the mapping deliberately leaves out (all motivated in the reviewed
 * spreadsheet): documents naming another investor, signature certificates,
 * RIBs, decks, Google-native files, anything above the 20 MB storage cap, and
 * the lighter of two versions of the same document.
 *
 * ⚠️ MERGE FIRST. `convex run --prod` calls the code DEPLOYED in prod, and
 * prod is deployed by the Vercel build on `main`. These functions do not exist
 * in prod until this PR is merged — running them before that fails with
 * "Could not find function". Merging is safe: nothing here runs on deploy, the
 * module only becomes callable.
 *
 * Execution (prod, manual — cf. MIGRATIONS.md), AFTER the merge has deployed:
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/legalDocsImport:dryRun
 *   # STOP: check the per-company counts against the spreadsheet, then:
 *   GDRIVE_TOKEN=... node scripts/import-legal-docs.mjs
 *   pnpm exec convex run --prod migrations/legalDocsImport:verify
 */
import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'

import type { Id } from '../_generated/dataModel'

const MAX_BYTES = 20 * 1024 * 1024 // storage cap, cf. convex/documents.ts
const MAX_BATCH = 200 // upload URLs minted per call

/** Same union as `documents.kind` — kept local so a schema drift breaks here. */
const kindValidator = v.union(
  v.literal('reporting'),
  v.literal('bp'),
  v.literal('legal'),
  v.literal('other'),
  v.literal('term_sheet'),
  v.literal('pacte'),
  v.literal('subscription'),
  v.literal('attestation'),
)

/**
 * Mints upload URLs for the script. Auth-less by design: run through
 * `convex run --prod`, which has no user identity — the admin key is the
 * authorisation. Never exposed to the client.
 */
export const startUploads = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    if (count < 1 || count > MAX_BATCH) {
      throw new ConvexError(`count_out_of_range:1..${MAX_BATCH}`)
    }
    const urls: Array<string> = []
    for (let i = 0; i < count; i++) {
      urls.push(await ctx.storage.generateUploadUrl())
    }
    return urls
  },
})

/**
 * Writes the rows for files the script has already uploaded. Each row carries
 * the `storageId` returned by the upload POST.
 *
 * A row whose company already has a same-title, same-size document is skipped
 * and its blob deleted, so a partial re-run does not leave orphan storage.
 */
export const attachBatch = internalMutation({
  args: {
    rows: v.array(
      v.object({
        companyId: v.id('companies'),
        storageId: v.id('_storage'),
        title: v.string(),
        kind: kindValidator,
        period: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let created = 0
    const skipped: Array<string> = []
    const failed: Array<string> = []

    for (const row of rows) {
      const company = await ctx.db.get('companies', row.companyId)
      if (!company) {
        failed.push(`${row.title}: company_not_found`)
        continue
      }
      const title = row.title.trim()
      if (!title) {
        failed.push(`${row.storageId}: empty_title`)
        continue
      }

      const meta = await ctx.db.system.get('_storage', row.storageId)
      if (!meta) {
        failed.push(`${title}: storage_not_found`)
        continue
      }
      if (meta.size > MAX_BYTES) {
        await ctx.storage.delete(row.storageId)
        failed.push(`${title}: too_large`)
        continue
      }

      // Idempotency guard: same company + same title + same byte size.
      const existing = await ctx.db
        .query('documents')
        .withIndex('by_company', (q) => q.eq('companyId', row.companyId))
        .collect()
      const already = existing.some(
        (doc) => doc.title === title && doc.size === meta.size,
      )
      if (already) {
        await ctx.storage.delete(row.storageId) // drop the freshly uploaded twin
        skipped.push(title)
        continue
      }

      const documentId = await ctx.db.insert('documents', {
        orgId: company.orgId,
        companyId: row.companyId,
        title,
        kind: row.kind,
        period: row.period,
        storageId: row.storageId,
        contentType: meta.contentType ?? undefined,
        size: meta.size,
        source: 'upload',
        uploadedAt: Date.now(),
        ocrState: 'pending',
      })
      // Same tail as `documents:create` — reading then semantic indexing.
      await ctx.scheduler.runAfter(0, internal.documentsExtract.run, {
        documentId,
      })
      created++
    }

    return { created, skipped: skipped.length, failed }
  },
})

/**
 * Read-only preview: what the org carries today, per company. Run it before
 * the script to know the starting point, and compare with `verify` after.
 */
export const dryRun = internalQuery({
  args: { orgSlug: v.optional(v.string()) },
  handler: async (ctx, { orgSlug }) => {
    const slug = orgSlug ?? 'albo'
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
    if (!org) throw new ConvexError(`org_not_found:${slug}`)

    const docs = await ctx.db
      .query('documents')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()

    const perCompany = new Map<Id<'companies'>, number>()
    for (const doc of docs) {
      perCompany.set(doc.companyId, (perCompany.get(doc.companyId) ?? 0) + 1)
    }
    const rows = await Promise.all(
      [...perCompany.entries()].map(async ([companyId, count]) => {
        const company = await ctx.db.get('companies', companyId)
        return { company: company?.name ?? '(supprimée)', count }
      }),
    )
    rows.sort((a, b) => b.count - a.count)

    return {
      org: slug,
      documentsTotal: docs.length,
      companiesWithDocuments: rows.length,
      bySource: {
        upload: docs.filter((d) => d.source === 'upload').length,
        email: docs.filter((d) => d.source === 'email').length,
      },
      perCompany: rows,
    }
  },
})

/**
 * Post-import check: counts, reading state, and anything that failed to be
 * read. `ocrState: 'pending'` right after the run is expected — extraction is
 * scheduled, not synchronous. Re-run a few minutes later.
 */
export const verify = internalQuery({
  args: { orgSlug: v.optional(v.string()) },
  handler: async (ctx, { orgSlug }) => {
    const slug = orgSlug ?? 'albo'
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
    if (!org) throw new ConvexError(`org_not_found:${slug}`)

    const docs = await ctx.db
      .query('documents')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const uploads = docs.filter((d) => d.source === 'upload')

    const byKind: Record<string, number> = {}
    const byOcr: Record<string, number> = {}
    for (const doc of uploads) {
      byKind[doc.kind] = (byKind[doc.kind] ?? 0) + 1
      byOcr[doc.ocrState ?? 'none'] = (byOcr[doc.ocrState ?? 'none'] ?? 0) + 1
    }

    // Same-title + same-size pairs should not exist after an idempotent run.
    const seen = new Set<string>()
    const duplicates: Array<string> = []
    for (const doc of uploads) {
      const key = `${doc.companyId}|${doc.title}|${doc.size ?? 0}`
      if (seen.has(key)) duplicates.push(doc.title)
      seen.add(key)
    }

    return {
      org: slug,
      uploads: uploads.length,
      byKind,
      byOcr,
      duplicates,
      failedReading: uploads
        .filter((d) => d.ocrState === 'failed')
        .map((d) => ({ title: d.title, detail: d.ocrDetail ?? null })),
    }
  },
})
