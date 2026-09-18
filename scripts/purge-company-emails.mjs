#!/usr/bin/env node
/**
 * Empty the retired email timeline in prod: `companyEmails` and
 * `companyEmailLinks` (MIGRATIONS.md « Purge de l'ancienne timeline
 * d'e-mails »).
 *
 * Both tables are dead weight — written by nothing, read by nothing — and
 * they pin attachments in file storage. Once emptied, a follow-up PR drops
 * them from the schema, and `scripts/storage-purge.mjs` removes the
 * attachments that no longer have a holder.
 *
 * Dry run by default (counts, touches nothing); `--apply` deletes. The loop
 * lives here rather than in a Convex action so the module needs no
 * `internal.*` self-reference (cf. KNOWN_ISSUES.md « Un nouveau module Convex
 * ne peut pas se citer lui-même hors déploiement »).
 *
 * Idempotent: a second `--apply` finds nothing left.
 *
 * Usage:
 *   node scripts/purge-company-emails.mjs            # dry run
 *   node scripts/purge-company-emails.mjs --apply    # after the FULL snapshot
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

/** Rows asked per page — the byte budget in the module is the real bound. */
const PAGE = 200

const MODULE = 'migrations/purgeCompanyEmails'
/** Links first: they point at emails, so the join table never outlives them. */
const TABLES = ['companyEmailLinks', 'companyEmails']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    if (attempt >= 3 || fn.includes('purgeBatch')) throw err
    const wait = attempt * 4000
    console.log(
      `    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`,
    )
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

async function count(table) {
  let seen = 0
  let cursor = null
  let isDone = false
  while (!isDone) {
    const res = await convex(`${MODULE}:scanPage`, {
      table,
      cursor,
      numItems: PAGE,
    })
    seen += res.seen
    cursor = res.cursor
    isDone = res.isDone
  }
  return seen
}

async function purge(table) {
  let deleted = 0
  let isDone = false
  while (!isDone) {
    const res = await convex(`${MODULE}:purgeBatch`, { table, numItems: PAGE })
    deleted += res.deleted
    isDone = res.isDone
    process.stdout.write(`\r  ${table} — ${deleted} supprimées…`.padEnd(58))
  }
  process.stdout.write('\r'.padEnd(60) + '\r')
  return deleted
}

async function main() {
  console.log('═══ Ancienne timeline d’e-mails ═══\n')
  const counts = {}
  for (const table of TABLES) {
    process.stdout.write(`\r  comptage ${table}…`.padEnd(58))
    counts[table] = await count(table)
  }
  process.stdout.write('\r'.padEnd(60) + '\r')
  for (const table of TABLES) console.log(`  ${table}: ${counts[table]} lignes`)

  const total = Object.values(counts).reduce((n, c) => n + c, 0)
  if (total === 0) {
    console.log(
      '\nRien à faire : les deux tables sont vides, elles peuvent quitter le schéma.',
    )
    return
  }
  if (!APPLY) {
    console.log(
      '\n[à blanc] rien n’est modifié. Relancer avec --apply après le snapshot COMPLET (données + fichiers).',
    )
    return
  }

  for (const table of TABLES) {
    const deleted = await purge(table)
    console.log(`  ${table}: ${deleted} lignes supprimées`)
  }
  console.log(
    '\nRelancer sans --apply : les deux comptes doivent être à zéro. Puis les pièces jointes orphelines : node scripts/storage-purge.mjs (à blanc), puis --apply.',
  )
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
