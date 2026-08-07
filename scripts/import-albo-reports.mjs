#!/usr/bin/env node
/**
 * One-shot import of the Albo app investor reports: Supabase → Convex.
 *
 * Reads the frozen decisions `scripts/data/albo-reports-albo.json` (company
 * mapping, 18 verified duplicates to skip, 6 rows allowed to share a period),
 * pulls the matching rows from Supabase, then for each report:
 *   1. downloads its attachments from Supabase Storage
 *   2. asks Convex for upload URLs  (migrations/alboReportsImport:startUploads)
 *   3. POSTs each file to its URL
 *   4. writes the row               (migrations/alboReportsImport:importOne)
 *
 * The bytes go straight from Supabase to Convex storage — they never transit
 * through a Convex function.
 *
 * `--dry` (the default) writes nothing: it resolves the decisions, queries
 * Convex for what each participation already holds, and prints the plan. Run
 * it first — the collision check then runs against LIVE data rather than the
 * snapshot the decision file was reviewed on.
 *
 * Idempotent: `importOne` anchors `companyReports.alboReportId`, so a re-run
 * is free and an interrupted run resumes by being re-run. Nothing is deleted,
 * nothing is overwritten — a report already present is skipped, never patched.
 *
 * A file that cannot be fetched does NOT cost its report: Albo app holds
 * `report_files` rows whose blob is absent from Storage, and the analysis and
 * the text live on the report itself. Those reports are imported without the
 * attachment, and the gaps are listed apart from the failures at the end.
 *
 * Prerequisites:
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read access to Albote Prod)
 *   - the Convex prod deploy key already configured for `convex run --prod`
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-albo-reports.mjs [--dry|--apply] [--limit N]
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DECISIONS = new URL('./data/albo-reports-albo.json', import.meta.url)
const BUCKET = 'report-files'
const MAX_BYTES = 20 * 1024 * 1024 // storage cap, cf. convex/documents.ts

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const limitFlag = args.indexOf('--limit')
const limit = limitFlag === -1 ? Infinity : Number(args[limitFlag + 1])

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants. Voir MIGRATIONS.md § « Import reportings Albo app ».',
  )
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** `convex run --prod <fn> <json>` → parsed stdout, retried on network faults. */
async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    const i = [stdout.indexOf('['), stdout.indexOf('{')].filter((n) => n !== -1)
    if (i.length === 0) return null
    return JSON.parse(stdout.slice(Math.min(...i)))
  } catch (err) {
    if (attempt >= 3) throw err
    const wait = attempt * 4000
    console.log(
      `    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`,
    )
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

/** PostgREST read. Supabase caps a page at 1000 rows; these tables are smaller. */
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

async function download(storagePath) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(storagePath)}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  )
  if (!res.ok) throw new Error(`storage ${res.status} sur ${storagePath}`)
  return Buffer.from(await res.arrayBuffer())
}

async function upload(url, bytes, contentType) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: bytes,
  })
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`)
  const { storageId } = await res.json()
  return storageId
}

// Albo app's `report_type` vocabulary is wider than ours; anything outside the
// union is dropped rather than guessed (the period carries the information).
const TYPES = new Set([
  'monthly',
  'bimonthly',
  'quarterly',
  'semi-annual',
  'annual',
])

const decisions = JSON.parse(await readFile(DECISIONS, 'utf8'))
const byCompanyName = new Map(decisions.companies.map((c) => [c.source, c]))
const duplicates = new Set(decisions.duplicates.map((d) => d.id))
const allowCollision = new Set(decisions.allowPeriodCollision.map((d) => d.id))
const excluded = new Set(decisions.excludedCompanies.map((c) => c.name))

console.log(
  `\nDécisions : ${decisions.companies.length} participations, ${duplicates.size} doublons écartés, ${allowCollision.size} collisions de période autorisées`,
)

// ── Source side ────────────────────────────────────────────────────────────
const ws = decisions.sourceWorkspace.id
const companies = await sb(
  `portfolio_companies?select=id,company_name&workspace_id=eq.${ws}`,
)
const companyById = new Map(companies.map((c) => [c.id, c.company_name]))

const reports = await sb(
  `company_reports?select=*&is_duplicate=eq.false&is_archived=eq.false&company_id=in.(${companies.map((c) => c.id).join(',')})&order=period_sort_date.desc`,
)
const files = await sb(
  `report_files?select=id,report_id,file_name,original_file_name,storage_path,mime_type,original_text_report&report_id=in.(${reports.map((r) => r.id).join(',')})`,
)
const filesByReport = new Map()
for (const f of files) {
  const list = filesByReport.get(f.report_id) ?? []
  list.push(f)
  filesByReport.set(f.report_id, list)
}

const plan = []
const skippedDuplicate = []
const skippedExcluded = []
const unmapped = []
for (const r of reports) {
  const name = companyById.get(r.company_id)
  if (excluded.has(name)) {
    skippedExcluded.push(`${name} — ${r.report_period ?? '(sans période)'}`)
    continue
  }
  if (duplicates.has(r.id)) {
    skippedDuplicate.push(`${name} — ${r.report_period ?? '(sans période)'}`)
    continue
  }
  const target = byCompanyName.get(name)
  if (!target) {
    unmapped.push(`${name} — ${r.report_period ?? '(sans période)'}`)
    continue
  }
  plan.push({
    report: r,
    company: target,
    files: filesByReport.get(r.id) ?? [],
  })
}

console.log(
  `Source : ${reports.length} reports lus — ${plan.length} à importer, ${skippedDuplicate.length} doublons, ${skippedExcluded.length} sur participations écartées`,
)
if (unmapped.length > 0) {
  console.error(`\n⚠️  ${unmapped.length} reports sans participation cible :`)
  for (const u of unmapped) console.error(`  - ${u}`)
  process.exit(1)
}

// ── Target side: what Albo OS already holds, read live ─────────────────────
const existing = await convex('migrations/alboReportsImport:plan', {
  companyIds: decisions.companies.map((c) => c.companyId),
})
const osByCompany = new Map((existing ?? []).map((e) => [e.companyId, e]))
const missing = (existing ?? []).filter((e) => e.missing)
if (missing.length > 0) {
  console.error(
    `\n⚠️  participations introuvables dans Albo OS : ${missing.map((m) => m.companyId).join(', ')}`,
  )
  process.exit(1)
}

// Same normalisation as the mutation, so the dry run predicts its verdict.
const MONTHS_FR = {
  janvier: 'January',
  février: 'February',
  fevrier: 'February',
  mars: 'March',
  avril: 'April',
  mai: 'May',
  juin: 'June',
  juillet: 'July',
  août: 'August',
  aout: 'August',
  septembre: 'September',
  octobre: 'October',
  novembre: 'November',
  décembre: 'December',
  decembre: 'December',
}
const normalizePeriod = (raw) =>
  raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => MONTHS_FR[w.toLowerCase()] ?? w)
    .join(' ')

let willCreate = 0
const willCollide = []
for (const item of plan) {
  const os = osByCompany.get(item.company.companyId)
  const period = item.report.report_period
    ? normalizePeriod(item.report.report_period)
    : null
  const anchored = os.reports.some((r) => r.alboReportId === item.report.id)
  if (anchored) continue
  const taken = period && os.reports.some((r) => r.period === period)
  if (taken && !allowCollision.has(item.report.id)) {
    willCollide.push(
      `${item.company.target} — ${period} — « ${item.report.report_title} »`,
    )
    continue
  }
  willCreate += 1
}

console.log(
  `\nPlan : ${willCreate} à créer, ${willCollide.length} bloqués par une période déjà occupée`,
)
if (willCollide.length > 0) {
  console.log(
    '\n⚠️  Périodes déjà occupées et non autorisées — À ARBITRER avant --apply :',
  )
  for (const c of willCollide) console.log(`  - ${c}`)
}

if (!apply) {
  console.log(
    '\n(dry run — rien n’a été écrit. Relancer avec --apply pour importer.)',
  )
  process.exit(0)
}

// ── Apply ──────────────────────────────────────────────────────────────────
let created = 0
let already = 0
let blocked = 0
const failures = []
// Attachments that could not be fetched. Kept apart from `failures`: the
// report itself landed, only a file is missing.
const fileWarnings = []

for (const [i, item] of plan
  .slice(0, limit === Infinity ? plan.length : limit)
  .entries()) {
  const r = item.report
  const label = `${item.company.target} — ${r.report_period ?? '(sans période)'}`
  try {
    const usable = item.files.filter((f) => f.storage_path)
    const uploaded = []
    if (usable.length > 0) {
      const urls = await convex('migrations/alboReportsImport:startUploads', {
        count: usable.length,
      })
      for (const [n, f] of usable.entries()) {
        // A file that cannot be fetched must NOT cost the report. Albo app
        // carries `report_files` rows whose blob is absent from Storage (the
        // upload never landed, or the object was removed) — the analysis and
        // the text live on the report itself, so it is imported without that
        // attachment and the gap is reported at the end.
        try {
          const bytes = await download(f.storage_path)
          if (bytes.length > MAX_BYTES) {
            fileWarnings.push(
              `${label} — ${f.file_name} : ${Math.round(bytes.length / 1e6)} Mo > cap 20 Mo`,
            )
            continue
          }
          const storageId = await upload(urls[n], bytes, f.mime_type)
          uploaded.push({
            storageId,
            filename: f.original_file_name || f.file_name,
            contentType: f.mime_type || undefined,
            size: bytes.length,
            text: f.original_text_report || undefined,
          })
        } catch (err) {
          fileWarnings.push(`${label} — ${f.file_name} : ${err.message}`)
        }
      }
    }

    const res = await convex('migrations/alboReportsImport:importOne', {
      alboReportId: r.id,
      companyId: item.company.companyId,
      allowPeriodCollision: allowCollision.has(r.id),
      title: r.report_title || r.email_subject || label,
      headline: r.headline || undefined,
      keyHighlights: r.key_highlights || undefined,
      reportPeriod: r.report_period || undefined,
      periodSortDate: r.period_sort_date
        ? Date.parse(`${r.period_sort_date}T00:00:00Z`)
        : undefined,
      reportType: TYPES.has(r.report_type) ? r.report_type : undefined,
      metrics: r.metrics || undefined,
      rawContent: r.raw_content || undefined,
      cleanedHtml: r.cleaned_content || undefined,
      fromEmail: r.email_from || r.sender_email || undefined,
      subject: r.email_subject || undefined,
      emailDate: r.email_date ? Date.parse(r.email_date) : undefined,
      files: uploaded,
    })

    if (res.status === 'created') created += 1
    else if (res.status === 'already_imported') already += 1
    else blocked += 1
  } catch (err) {
    failures.push(`${label} : ${err.message}`)
  }

  if ((i + 1) % 10 === 0 || i + 1 === plan.length) {
    console.log(
      `  ${i + 1}/${plan.length} — créés ${created}, déjà là ${already}, bloqués ${blocked}, échecs ${failures.length}, pièces jointes manquantes ${fileWarnings.length}`,
    )
  }
}

console.log(
  `\nTerminé — créés : ${created}, déjà présents : ${already}, bloqués : ${blocked}, échecs : ${failures.length}`,
)
if (fileWarnings.length > 0) {
  console.log(
    `\nPièces jointes non récupérées (${fileWarnings.length}) — le report est importé sans elles :`,
  )
  for (const w of fileWarnings) console.log(`  - ${w}`)
}
if (failures.length > 0) {
  console.log('\nÉchecs :')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
console.log(
  "\nEnsuite : convex run --prod migrations/alboReportsImport:verify '{}'",
)
console.log("Puis    : convex run --prod vectorize:backfillAll '{}'")
