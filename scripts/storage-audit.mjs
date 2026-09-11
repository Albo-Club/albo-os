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
 * It also groups blobs by `sha256`: identical bytes are provable, not
 * guessed from a matching size. Deduplicating is the one saving that costs no
 * quality — unlike compressing a scan. But a duplicate is not automatically
 * waste: the same PDF legitimately attached to two companies is two
 * references, not a mistake. So the report names WHO points at each copy;
 * deciding what to remove is a separate, human step.
 *
 * And "who points at it" is the whole question, because a blob is reachable
 * from SIX places in the schema. Having no `documents` row proves nothing: an
 * attachment on a received email is in use and invisible to that join. The
 * script therefore sweeps every holder table once and builds the reverse
 * index blob → holders, which splits the storage into what a fiche shows,
 * what only a mail still holds, what the RETIRED email timeline still pins
 * down, and what nothing points at at all — the only bucket that is free to
 * delete.
 *
 * `documentTexts` is deliberately NOT counted as a holder: it is the text
 * extracted FROM a blob, so it cannot be the reason to keep one. It is
 * reported separately, as the row a deletion would have to take along.
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

import {
  HOLDER_LABEL,
  HOLDER_TABLES,
  classify as classifyBlob,
  extraCopies,
  tally as tallyBlobs,
} from './lib/storage-holders.mjs'

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

/** How many duplicate groups get every one of their copies named. */
const TOP_DUPLICATE_GROUPS = 10

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
  /** sha256 → { size, ids[] }. Same hash = same bytes, no heuristic. */
  bySha: new Map(),
  /** storageId → { size, createdAt }, for every blob. */
  meta: new Map(),
  /** storageId → Set(table). Absent key = nothing points at that blob. */
  holders: new Map(),
  /** storageId set carrying an extracted-text row (derived, not a holder). */
  texts: new Set(),
}

// Thin bindings over the tested helpers, so the sweep reads plainly below.
const classify = (id) => classifyBlob(id, state.holders)
const tally = (ids) => tallyBlobs(ids, state.holders, state.meta)

/** Print a category breakdown, heaviest first, against a reference total. */
function printTally(counts, total) {
  const rows = [...counts.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [key, s] of rows) {
    console.log(
      `    ${(HOLDER_LABEL[key] ?? key).padEnd(30)} ${String(s.count).padStart(5)} fichiers  ${human(s.bytes).padStart(10)}  ${pct(s.bytes, total).padStart(5)}`,
    )
  }
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
  state.meta.set(row.storageId, { size: row.size, createdAt: row.createdAt })

  // A blob with no hash cannot be compared: counted in the totals, never
  // grouped — otherwise every unhashed blob would collide with the others.
  if (row.sha256) {
    const group = state.bySha.get(row.sha256) ?? { size: row.size, ids: [] }
    group.ids.push(row.storageId)
    state.bySha.set(row.sha256, group)
  }
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

  // ── Qui pointe sur quoi ────────────────────────────────────────────────
  // One sweep per holder table. `documentTexts` is swept too, but into its
  // own set: it is derived from a blob, never a reason to keep it.
  for (const table of [...HOLDER_TABLES, 'documentTexts']) {
    let hCursor = null
    let hDone = false
    let read = 0
    while (!hDone) {
      process.stdout.write(`\r  ${table} — ${read} références lues…`.padEnd(58))
      const res = await convex('migrations/storageAudit:scanHolders', {
        table,
        cursor: hCursor,
        numItems: PAGE,
      })
      for (const id of res.storageIds) {
        read += 1
        if (table === 'documentTexts') {
          state.texts.add(id)
          continue
        }
        const held = state.holders.get(id) ?? new Set()
        held.add(table)
        state.holders.set(id, held)
      }
      hCursor = res.cursor
      hDone = res.isDone
    }
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

  // ── Qui référence quoi, sur TOUT le stockage ────────────────────────────
  const allIds = [...state.meta.keys()]
  const orphanIds = allIds.filter((id) => classify(id) === 'none')
  const orphanBytes = orphanIds.reduce((n, id) => n + state.meta.get(id).size, 0)

  console.log('\n── Qui référence les fichiers ──')
  printTally(tally(allIds), state.totalBytes)
  console.log(
    `\n  Sans aucune référence : ${orphanIds.length} fichiers, ${human(orphanBytes)} — ${pct(orphanBytes, state.totalBytes)} du stockage`,
  )
  const orphanTexts = orphanIds.filter((id) => state.texts.has(id)).length
  if (orphanTexts) {
    console.log(`  dont ${orphanTexts} traînent encore leur texte extrait (à supprimer avec).`)
  }

  // ── Doublons ────────────────────────────────────────────────────────────
  // Groups of two or more blobs sharing a hash. What a group WASTES is
  // `size × (n − 1)`: one copy has to exist.
  const dupGroups = [...state.bySha.entries()]
    .filter(([, g]) => g.ids.length > 1)
    .map(([sha, g]) => ({ sha, size: g.size, ids: g.ids, wasted: g.size * (g.ids.length - 1) }))
    .sort((a, b) => b.wasted - a.wasted)
  const dupWasted = dupGroups.reduce((sum, g) => sum + g.wasted, 0)
  const dupCopies = dupGroups.reduce((sum, g) => sum + g.ids.length - 1, 0)

  console.log('\n── Doublons exacts (même sha256) ──')
  if (dupGroups.length === 0) {
    console.log('  aucun')
  } else {
    console.log(
      `  ${dupGroups.length} contenus en plusieurs exemplaires, ${dupCopies} copies en trop`,
    )
    console.log(
      `  récupérable sans perte : ${human(dupWasted)} — ${pct(dupWasted, state.totalBytes)} du stockage`,
    )

    // What the extra copies are held by decides what is safe to delete: a
    // copy nothing points at goes freely, one a mail still holds is a choice.
    // Per group, the extra copies are all but the best-referenced one — that
    // one has to survive.
    const extraIds = dupGroups.flatMap((g) =>
      extraCopies(g.ids, state.holders, state.meta),
    )
    console.log('\n  Ce qui retient les copies en trop :')
    printTally(tally(extraIds), dupWasted)

    // Has it stopped? A month histogram of the extra copies answers it: if
    // the tail dries up at a date, the leak is closed; if it reaches today,
    // something still duplicates.
    const byMonth = new Map()
    for (const id of extraIds) {
      const key = new Date(state.meta.get(id).createdAt).toISOString().slice(0, 7)
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
    }
    console.log('\n  Quand les copies en trop ont été créées :')
    for (const [month, n] of [...byMonth.entries()].sort()) {
      console.log(`    ${month}  ${String(n).padStart(4)}  ${'█'.repeat(Math.min(50, n))}`)
    }

    // Name every copy of the heaviest groups: who points at which tells the
    // story (two channels? a re-import? a manual upload of a mailed file?).
    const shown = dupGroups.slice(0, TOP_DUPLICATE_GROUPS)
    const ids = shown.flatMap((g) => g.ids)
    const info = new Map(
      (await convex('migrations/storageAudit:describe', { storageIds: ids })).map((d) => [
        d.storageId,
        d,
      ]),
    )
    console.log(`\n  Les ${shown.length} plus lourds :`)
    for (const g of shown) {
      console.log(`\n  ${human(g.size)} × ${g.ids.length} exemplaires (${human(g.wasted)} en trop)`)
      for (const id of g.ids) {
        const d = info.get(id) ?? {}
        const tags = [d.kind, d.source, d.inline ? 'inline' : null].filter(Boolean).join('/')
        const held = HOLDER_LABEL[classify(id)]
        console.log(
          `      ${(tags || '—').padEnd(22)} ${held.padEnd(28)} ${String(d.title ?? '').slice(0, 40)}`,
        )
      }
    }
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
