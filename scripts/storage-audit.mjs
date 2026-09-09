#!/usr/bin/env node
/**
 * Where do the bytes of Convex FILE storage actually sit? (ALB-234)
 *
 * Automated backups are billed as EGRESS: Convex charges the bytes leaving
 * the platform on every `convex export`, so the size of the base is
 * multiplied by the number of exports. Before compressing anything at
 * import, this says whether the weight is a handful of scanned PDFs or a
 * long tail — which decides whether the lever is compression on the way in,
 * a one-shot re-compression of what is already stored, or neither.
 *
 * Read-only end to end: it calls two internal QUERIES
 * (`migrations/storageAudit`), never a mutation, and downloads no file.
 * Running it twice changes nothing.
 *
 * The pagination loop and all the aggregation live here rather than in a
 * Convex action, so the audit needs no `internal.*` self-reference and
 * therefore no regeneration of `convex/_generated/*`.
 *
 * Prerequisite: the Convex prod deploy key already configured for
 * `convex run --prod` (same as the other scripts here).
 *
 * Usage:
 *   node scripts/storage-audit.mjs
 *   node scripts/storage-audit.mjs --top 50 --page 1000
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const args = process.argv.slice(2)
const numArg = (flag, fallback) => {
  const i = args.indexOf(flag)
  if (i === -1) return fallback
  const n = Number(args[i + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const TOP = Math.min(numArg('--top', 30), 100)
const PAGE = numArg('--page', 500)

/** Convex data egress beyond the monthly allowance, cf. convex.dev/pricing. */
const EGRESS_USD_PER_GB = 0.132
const EGRESS_FREE_GB_PER_MONTH = 1

/** Above this, a PDF is worth looking at for compression. */
const COMPRESSIBLE_THRESHOLD = 1024 * 1024

/** Size buckets, ascending. A file lands in the first one it fits under. */
const BUCKETS = [
  { label: '< 100 Ko', max: 100 * 1024 },
  { label: '100 Ko - 1 Mo', max: 1024 * 1024 },
  { label: '1 - 5 Mo', max: 5 * 1024 * 1024 },
  { label: '5 - 10 Mo', max: 10 * 1024 * 1024 },
  { label: '> 10 Mo', max: Number.POSITIVE_INFINITY },
]

const GB = 1024 * 1024 * 1024
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const human = (bytes) =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} Go` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
const pct = (part, whole) => (whole === 0 ? '0 %' : `${Math.round((part / whole) * 100)} %`)

/**
 * `convex run --prod <fn> <json>` → parsed stdout, retried. Same shape as
 * scripts/import-legal-docs.mjs: the CLI shells out and can die on a
 * transient network fault, which without this would abort the sweep.
 */
async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 32 * 1024 * 1024 },
    )
    // The CLI prints a banner before the JSON payload on some versions.
    const candidates = [stdout.indexOf('['), stdout.indexOf('{')].filter((i) => i !== -1)
    return JSON.parse(stdout.slice(Math.min(...candidates)))
  } catch (err) {
    if (attempt >= 3) throw err
    const wait = attempt * 4000
    console.log(`    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`)
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

const state = {
  files: 0,
  totalBytes: 0,
  byType: new Map(),
  buckets: BUCKETS.map((b) => ({ label: b.label, count: 0, bytes: 0 })),
  pdfCount: 0,
  pdfBytes: 0,
  fatPdfCount: 0,
  fatPdfBytes: 0,
  largest: [],
}

function absorb(row) {
  state.files += 1
  state.totalBytes += row.size

  const type = row.contentType ?? '(inconnu)'
  const seen = state.byType.get(type) ?? { count: 0, bytes: 0 }
  seen.count += 1
  seen.bytes += row.size
  state.byType.set(type, seen)

  const bucket = state.buckets[BUCKETS.findIndex((b) => row.size < b.max)]
  bucket.count += 1
  bucket.bytes += row.size

  if (type === 'application/pdf') {
    state.pdfCount += 1
    state.pdfBytes += row.size
    if (row.size > COMPRESSIBLE_THRESHOLD) {
      state.fatPdfCount += 1
      state.fatPdfBytes += row.size
    }
  }

  state.largest.push(row)
}

async function main() {
  let cursor = null
  let isDone = false
  let page = 0

  while (!isDone) {
    page += 1
    process.stdout.write(`\r  page ${page} — ${state.files} fichiers lus…`)
    const res = await convex('migrations/storageAudit:scanPage', { cursor, numItems: PAGE })
    for (const row of res.rows) absorb(row)
    // Trimmed every page so the accumulator stays bounded whatever the
    // table grows to.
    state.largest.sort((a, b) => b.size - a.size)
    state.largest = state.largest.slice(0, TOP)
    cursor = res.cursor
    isDone = res.isDone
  }
  process.stdout.write('\r'.padEnd(60) + '\r')

  const named = state.largest.length
    ? await convex('migrations/storageAudit:describe', {
        storageIds: state.largest.map((f) => f.storageId),
      })
    : []

  console.log('\n═══ Stockage de fichiers Convex ═══\n')
  console.log(`  ${state.files} fichiers — ${human(state.totalBytes)}\n`)

  console.log('── Par type ──')
  for (const [type, s] of [...state.byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)) {
    console.log(
      `  ${type.padEnd(34)} ${String(s.count).padStart(6)} fichiers  ${human(s.bytes).padStart(10)}  ${pct(s.bytes, state.totalBytes).padStart(5)}`,
    )
  }

  console.log('\n── Par tranche de taille ──')
  for (const b of state.buckets) {
    console.log(
      `  ${b.label.padEnd(34)} ${String(b.count).padStart(6)} fichiers  ${human(b.bytes).padStart(10)}  ${pct(b.bytes, state.totalBytes).padStart(5)}`,
    )
  }

  console.log('\n── Gisement compressible ──')
  console.log(`  PDF au total            : ${state.pdfCount} fichiers, ${human(state.pdfBytes)}`)
  console.log(
    `  dont PDF > 1 Mo         : ${state.fatPdfCount} fichiers, ${human(state.fatPdfBytes)} — ${pct(state.fatPdfBytes, state.totalBytes)} du stockage`,
  )

  console.log(`\n── Les ${state.largest.length} plus gros fichiers ──`)
  state.largest.forEach((f, i) => {
    const d = named[i] ?? {}
    const tags = [d.kind, d.source, d.inline ? 'inline' : null].filter(Boolean).join('/')
    console.log(`  ${human(f.size).padStart(9)}  ${tags.padEnd(22)} ${String(d.title ?? '').slice(0, 70)}`)
  })

  // Files only — the database is billed on the same egress line and has to
  // be added from Convex → Settings → Usage before this is the real figure.
  const yearlyGb = ((state.totalBytes * 365) / GB) - EGRESS_FREE_GB_PER_MONTH * 12
  console.log('\n── Projection egress (fichiers seuls, 1 export/jour) ──')
  console.log(
    `  ${((state.totalBytes * 365) / GB).toFixed(0)} Go/an → ~${Math.max(0, yearlyGb * EGRESS_USD_PER_GB).toFixed(0)} $/an`,
  )
  console.log('  ⚠️  À ajouter : la taille de la BASE (Convex → Settings → Usage).\n')
}

main().catch((err) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
