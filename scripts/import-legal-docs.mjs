#!/usr/bin/env node
/**
 * One-shot upload of the Albo Club legal documentation: Google Drive → Convex.
 *
 * Reads the frozen mapping `scripts/data/legal-docs-albo.json` (one row per
 * document: company, title, kind, date, Drive id), then for each batch:
 *   1. asks Convex for upload URLs   (migrations/legalDocsImport:startUploads)
 *   2. streams the file from Drive and POSTs it to its URL
 *   3. writes the rows               (migrations/legalDocsImport:attachBatch)
 *
 * The bytes go straight from Drive to Convex storage — they never transit
 * through a Convex function, which is what keeps this within the platform's
 * limits for ~300 MB of PDFs.
 *
 * Idempotent: `attachBatch` skips any document the company already carries
 * with the same title and byte size, so an interrupted run resumes by simply
 * being re-run. Nothing is ever deleted.
 *
 * Prerequisites:
 *   - a Google Drive read token in GDRIVE_TOKEN (see MIGRATIONS.md for how to
 *     mint one — it lasts one hour, which is enough for the whole run)
 *   - the Convex prod deploy key already configured for `convex run --prod`
 *
 * Usage:
 *   GDRIVE_TOKEN=ya29.… node scripts/import-legal-docs.mjs [--limit N] [--dry]
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAPPING = new URL('./data/legal-docs-albo.json', import.meta.url)
const BATCH = 25
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const limitFlag = args.indexOf('--limit')
const limit = limitFlag === -1 ? Infinity : Number(args[limitFlag + 1])

const token = process.env.GDRIVE_TOKEN
if (!token && !dry) {
  console.error(
    'GDRIVE_TOKEN manquant. Voir MIGRATIONS.md § « Import documents juridiques Albo ».',
  )
  process.exit(1)
}

/** `convex run --prod <fn> <json>` → parsed stdout. */
async function convex(fn, payload) {
  const { stdout } = await run(
    'pnpm',
    ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  // The CLI prints a banner before the JSON payload on some versions.
  const start = stdout.indexOf('[') === -1 ? stdout.indexOf('{') : Math.min(
    ...[stdout.indexOf('['), stdout.indexOf('{')].filter((i) => i !== -1),
  )
  return JSON.parse(stdout.slice(start))
}

async function fetchFromDrive(fileId) {
  const res = await fetch(`${DRIVE}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`drive_${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function uploadToConvex(url, bytes, contentType) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
  })
  if (!res.ok) throw new Error(`convex_upload_${res.status}`)
  const { storageId } = await res.json()
  return storageId
}

/** The stored title drops the extension, so the mapping keeps `sourceExt`. */
const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function contentTypeOf(sourceExt) {
  return CONTENT_TYPES[sourceExt] ?? 'application/octet-stream'
}

const { rows: all } = JSON.parse(await readFile(MAPPING, 'utf8'))
const rows = all.slice(0, limit)
console.log(`${rows.length} documents à importer (sur ${all.length} dans le mapping)`)
if (dry) {
  const perCompany = {}
  for (const r of rows) perCompany[r.company] = (perCompany[r.company] ?? 0) + 1
  console.table(perCompany)
  process.exit(0)
}

let created = 0
let skipped = 0
const failures = []

for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH)
  const urls = await convex('migrations/legalDocsImport:startUploads', {
    count: slice.length,
  })

  const attach = []
  for (const [j, row] of slice.entries()) {
    try {
      const bytes = await fetchFromDrive(row.driveFileId)
      const storageId = await uploadToConvex(
        urls[j],
        bytes,
        contentTypeOf(row.sourceExt),
      )
      attach.push({
        companyId: row.companyId,
        storageId,
        title: row.title,
        kind: row.kind,
        ...(row.period ? { period: row.period } : {}),
      })
    } catch (err) {
      failures.push(`${row.company} — ${row.title} : ${err.message}`)
    }
  }

  if (attach.length > 0) {
    const res = await convex('migrations/legalDocsImport:attachBatch', {
      rows: attach,
    })
    created += res.created
    skipped += res.skipped
    failures.push(...res.failed)
  }
  console.log(
    `  ${Math.min(i + BATCH, rows.length)}/${rows.length} — créés ${created}, déjà présents ${skipped}, échecs ${failures.length}`,
  )
}

console.log(`\nTerminé — créés : ${created}, déjà présents : ${skipped}, échecs : ${failures.length}`)
if (failures.length > 0) {
  console.log('\nÉchecs :')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
