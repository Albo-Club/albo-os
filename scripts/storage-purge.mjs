#!/usr/bin/env node
/**
 * Delete the Convex file-storage blobs that nothing points at (ALB-234).
 *
 * The audit found 501 MB — 28 % of file storage — held by NOTHING, of which
 * 564 out of 565 were the exact twin of a file still present elsewhere. Their
 * cause was a download proxy that stored a copy per click and never removed
 * it; that leak was fixed FIRST, deliberately, because purging a leak that
 * still flows buys a few weeks and nothing more.
 *
 * DESTRUCTIVE — read MIGRATIONS.md § « Purge des fichiers orphelins » before
 * running it. Dry run by default; `--apply` is what actually deletes.
 *
 * How it decides, and what it refuses to trust:
 *
 * 1. Sweep `_storage`, then the five holder tables, and keep the blobs no
 *    table points at. `documentTexts` is not a holder — it is text extracted
 *    FROM a blob, so it goes along rather than saves it.
 * 2. Drop anything younger than a day. An upload PUTs its bytes BEFORE the row
 *    pointing at them exists, so a fresh unheld blob is somebody's file
 *    mid-flight, not an orphan. This is the guard that protects a user.
 * 3. Hand the ids over in batches — and the mutation re-checks both the age
 *    and the `documents` claim itself, because this sweep finished minutes
 *    ago and the base has not stopped moving.
 *
 * Idempotent: a second run finds nothing left to do.
 *
 * Usage:
 *   node scripts/storage-purge.mjs               # dry run, deletes nothing
 *   node scripts/storage-purge.mjs --apply       # after the snapshot
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  HOLDER_LABEL,
  HOLDER_TABLES,
  MIN_ORPHAN_AGE_MS,
  classify,
  purgeableOrphans,
  tally,
} from './lib/storage-holders.mjs'

const run = promisify(execFile)
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const PAGE = 500
/** Ids per mutation call — a batch is one transaction, so it stays modest. */
const BATCH = 100

const GB = 1024 * 1024 * 1024
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const human = (bytes) =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} Go` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`

/** `convex run --prod <fn> <json>` → parsed stdout, retried on a flaky link. */
async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 32 * 1024 * 1024 },
    )
    const candidates = [stdout.indexOf('['), stdout.indexOf('{')].filter((i) => i !== -1)
    return JSON.parse(stdout.slice(Math.min(...candidates)))
  } catch (err) {
    // A failed READ is retried; a failed WRITE is not, because a batch that
    // timed out may well have committed — replaying it is safe (the mutation
    // is idempotent), but a silent retry would blur what actually happened.
    if (attempt >= 3 || fn.includes('deleteOrphans')) throw err
    const wait = attempt * 4000
    console.log(`    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`)
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

/** Paginate one Convex query to exhaustion, feeding each page to `onPage`. */
async function sweep(fn, payload, onPage, label) {
  let cursor = null
  let isDone = false
  let seen = 0
  while (!isDone) {
    process.stdout.write(`\r  ${label} — ${seen}…`.padEnd(58))
    const res = await convex(fn, { ...payload, cursor, numItems: PAGE })
    seen += onPage(res)
    cursor = res.cursor
    isDone = res.isDone
  }
  return seen
}

async function main() {
  /** storageId → { size, createdAt } */
  const meta = new Map()
  /** storageId → Set(table) */
  const holders = new Map()

  await sweep(
    'migrations/storageAudit:scanPage',
    {},
    (res) => {
      for (const row of res.rows) meta.set(row.storageId, { size: row.size, createdAt: row.createdAt })
      return res.rows.length
    },
    'fichiers',
  )

  for (const table of HOLDER_TABLES) {
    await sweep(
      'migrations/storageAudit:scanHolders',
      { table },
      (res) => {
        for (const id of res.storageIds) {
          const held = holders.get(id) ?? new Set()
          held.add(table)
          holders.set(id, held)
        }
        return res.storageIds.length
      },
      table,
    )
  }
  process.stdout.write('\r'.padEnd(60) + '\r')

  const total = [...meta.values()].reduce((n, m) => n + m.size, 0)
  const victims = purgeableOrphans(meta, holders)
  const victimBytes = victims.reduce((n, id) => n + meta.get(id).size, 0)

  // Young orphans are not a mistake to report, they are the age floor doing
  // its job — but saying how many makes the number reconcile with the audit.
  const unheld = [...meta.keys()].filter((id) => classify(id, holders) === 'none')
  const tooYoung = unheld.length - victims.length

  console.log('\n═══ Purge des fichiers orphelins ═══\n')
  console.log(`  ${meta.size} fichiers au total — ${human(total)}`)
  console.log('\n── Ce qui reste en place ──')
  const kept = [...meta.keys()].filter((id) => classify(id, holders) !== 'none')
  for (const [key, s] of [...tally(kept, holders, meta).entries()].sort(
    (a, b) => b[1].bytes - a[1].bytes,
  )) {
    console.log(
      `  ${(HOLDER_LABEL[key] ?? key).padEnd(30)} ${String(s.count).padStart(5)} fichiers  ${human(s.bytes).padStart(10)}`,
    )
  }

  console.log('\n── Ce qui part ──')
  console.log(`  ${victims.length} fichiers — ${human(victimBytes)}`)
  if (tooYoung > 0) {
    console.log(
      `  (${tooYoung} orphelins de moins de ${MIN_ORPHAN_AGE_MS / 3600000} h épargnés : un upload en cours leur ressemble)`,
    )
  }

  if (victims.length === 0) {
    console.log('\n  Rien à faire.\n')
    return
  }

  if (!APPLY) {
    console.log('\n  Répétition à blanc — rien n\'a été supprimé.')
    console.log('  Snapshot puis `--apply` pour exécuter (cf. MIGRATIONS.md).\n')
    return
  }

  console.log('\n── Suppression ──')
  let deleted = 0
  let bytes = 0
  let spared = 0
  for (let i = 0; i < victims.length; i += BATCH) {
    const batch = victims.slice(i, i + BATCH)
    const res = await convex('migrations/storagePurge:deleteOrphans', {
      storageIds: batch,
      dryRun: false,
    })
    deleted += res.deleted
    bytes += res.bytes
    spared += res.spared
    process.stdout.write(`\r  ${deleted} supprimés — ${human(bytes)}`.padEnd(58))
  }
  console.log(`\n\n  ${deleted} fichiers supprimés, ${human(bytes)} libérés.`)
  if (spared > 0) {
    // The server refused some of what the sweep proposed. Not an error: the
    // base moved between the two, which is exactly why it re-checks.
    console.log(`  ${spared} épargnés par le contrôle serveur (réclamés ou trop jeunes).`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
