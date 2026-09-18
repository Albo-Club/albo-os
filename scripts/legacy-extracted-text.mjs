#!/usr/bin/env node
/**
 * Empty the legacy `documents.extractedText` field in prod (MIGRATIONS.md
 * « Chantier : retrait du champ legacy `documents.extractedText` »).
 *
 * The field is dead weight: written by nothing, read by nothing since the
 * text moved to `documentTexts`, yet paid for on every read of a `documents`
 * row. The text is kept — a blob with no `documentTexts` row yet gets one
 * from the legacy copy, sparing an OCR pass — and the field is then removed
 * from the row. Once prod is at zero, a follow-up PR drops the field from the
 * schema.
 *
 * Dry run by default (counts, touches nothing); `--apply` migrates. The loop
 * lives here rather than in a Convex action so the module needs no
 * `internal.*` self-reference (cf. KNOWN_ISSUES.md « Un nouveau module Convex
 * ne peut pas se citer lui-même hors déploiement »).
 *
 * Batches are small on purpose: a `documents` row and the `documentTexts`
 * row it is checked against can each approach 1 MiB, and a mutation may read
 * 16 MiB at most.
 *
 * Idempotent: a second `--apply` finds nothing left.
 *
 * Usage:
 *   node scripts/legacy-extracted-text.mjs            # dry run
 *   node scripts/legacy-extracted-text.mjs --apply    # after the snapshot
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

/** Rows asked per scan page — the byte budget in `scanPage` is the real bound. */
const PAGE = 50
/** Documents per mutation: ≤ 4 × (1 MiB row + 1 MiB text) under the 16 MiB cap. */
const BATCH = 4

const MODULE = 'migrations/legacyExtractedText'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const human = (chars) =>
  chars >= 1024 * 1024
    ? `${(chars / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.round(chars / 1024)} Ko`

/** `convex run --prod <fn> <json>` → parsed stdout, reads retried on a flaky link. */
async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 32 * 1024 * 1024 },
    )
    const candidates = [stdout.indexOf('['), stdout.indexOf('{')].filter(
      (i) => i !== -1,
    )
    return JSON.parse(stdout.slice(Math.min(...candidates)))
  } catch (err) {
    // A failed WRITE is not retried: a batch that timed out may have
    // committed. Replaying it is safe (idempotent), but explicit.
    if (attempt >= 3 || fn.includes('migrateBatch')) throw err
    const wait = attempt * 4000
    console.log(
      `    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`,
    )
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

async function main() {
  const legacy = []
  let seen = 0
  let cursor = null
  let isDone = false
  while (!isDone) {
    process.stdout.write(`\r  balayage des documents — ${seen}…`.padEnd(58))
    const res = await convex(`${MODULE}:scanPage`, { cursor, numItems: PAGE })
    legacy.push(...res.legacy)
    seen += res.seen
    cursor = res.cursor
    isDone = res.isDone
  }
  process.stdout.write('\r'.padEnd(60) + '\r')

  const chars = legacy.reduce((n, d) => n + d.chars, 0)
  console.log('═══ Champ legacy documents.extractedText ═══\n')
  console.log(`  ${seen} documents balayés`)
  console.log(
    `  ${legacy.length} portent encore le champ — ${human(chars)} de texte`,
  )

  if (legacy.length === 0) {
    console.log(
      '\nRien à faire : la prod est à zéro, le champ peut quitter le schéma.',
    )
    return
  }
  if (!APPLY) {
    console.log(
      '\n[à blanc] rien n’est modifié. Relancer avec --apply après le snapshot.',
    )
    return
  }

  const totals = { copied: 0, dropped: 0, skipped: 0 }
  for (let i = 0; i < legacy.length; i += BATCH) {
    const documentIds = legacy.slice(i, i + BATCH).map((d) => d.documentId)
    const res = await convex(`${MODULE}:migrateBatch`, { documentIds })
    for (const k of Object.keys(totals)) totals[k] += res[k]
    process.stdout.write(
      `\r  migration — ${Math.min(i + BATCH, legacy.length)} / ${legacy.length}`.padEnd(
        58,
      ),
    )
  }
  process.stdout.write('\r'.padEnd(60) + '\r')
  console.log(
    `\n  ${totals.copied} textes recopiés dans documentTexts (à indexer : vectorize:backfillAll)`,
  )
  console.log(`  ${totals.dropped} doublons ou textes vides simplement effacés`)
  if (totals.skipped)
    console.log(`  ${totals.skipped} lignes déjà migrées entre-temps`)
  console.log('\nRelancer sans --apply : le compte doit être à zéro.')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
