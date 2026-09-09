#!/usr/bin/env node
/**
 * Automated Convex backup to a Google Drive shared drive (ALB-234).
 *
 * Convex has no scheduled export to a destination we choose (the built-in
 * daily backup is Pro-only and caps at 7 days), so an outside scheduler runs
 * the CLI. Here that scheduler is GitHub Actions
 * (`.github/workflows/convex-backup.yml`).
 *
 * ONE export per day, and its kind depends on the date:
 *   - every day        → data only
 *   - Sunday, and the 1st of the month → data + file storage ("full")
 *
 * Files are not in the daily archive on purpose. A stored PDF never changes
 * after upload, so re-exporting the whole file storage 365 times a year
 * protects nothing and is billed every time — Convex charges data EGRESS on
 * every export (0,132 $/GB beyond 1 GB included per month). The daily archive
 * covers what actually moves: bank sync, incoming reports, manual entry.
 * Restoring therefore means: today's data + the files of the last full one.
 *
 * Retention (7 daily / 4 weekly / 12 monthly) is recomputed from the archives
 * present in the folder on every run — see `lib/backup-retention.mjs` for why
 * that is stateless and tolerant to missed runs.
 *
 * Safety, in order:
 *   1. the archive is verified (CRC + expected tables) BEFORE it is uploaded;
 *   2. the purge only runs after the upload is confirmed;
 *   3. a name this script did not write is never deleted.
 * A corrupt archive pushed silently is worse than no backup at all.
 *
 * Prerequisites (all set as GitHub Actions secrets):
 *   - CONVEX_DEPLOY_KEY       prod deploy key, read by the Convex CLI
 *   - GDRIVE_SERVICE_ACCOUNT  the service-account JSON, verbatim
 *   - GDRIVE_BACKUP_FOLDER_ID the target folder on the shared drive
 *
 * ⚠️ The service account has NO storage quota of its own: the target must be
 * a folder on a SHARED DRIVE it is a member of ("Gestionnaire de contenu"),
 * never a personal My Drive. Its reach is exactly that membership, which is
 * what keeps the broad `drive` scope contained.
 *
 * Usage:
 *   node scripts/convex-backup.mjs            # decides the kind from the date
 *   node scripts/convex-backup.mjs --dry      # says what it would do, writes nothing
 *   node scripts/convex-backup.mjs --full     # force data + files
 *   node scripts/convex-backup.mjs --data-only
 */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createSign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { planRetention } from './lib/backup-retention.mjs'

const run = promisify(execFile)

const args = process.argv.slice(2)
const dry = args.includes('--dry')

/**
 * Tables whose presence proves the archive is a real export of THIS app and
 * not an empty or truncated file. Both are core and can never be absent.
 * The layout is `<table>/documents.jsonl` inside the ZIP.
 */
const EXPECTED_TABLES = ['organizations', 'deals']

/** An export smaller than this is not plausible — treat it as a failed run. */
const MIN_PLAUSIBLE_BYTES = 1024 * 1024

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const FILES_URL = 'https://www.googleapis.com/drive/v3/files'

const human = (b) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} Go` : `${(b / 1024 ** 2).toFixed(1)} Mo`

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} manquant. Voir MIGRATIONS.md § « Backup automatique Convex → Drive ».`)
    process.exit(1)
  }
  return value
}

/**
 * Data only most days; data + file storage on Sunday and on the 1st, so the
 * weekly and monthly restore points carry the files. UTC, like the cron.
 */
function decideKind(now) {
  if (args.includes('--full')) return true
  if (args.includes('--data-only')) return false
  return now.getUTCDay() === 0 || now.getUTCDate() === 1
}

// ── Google auth ───────────────────────────────────────────────────────────
// A service-account JWT signed locally, exchanged for an access token. Node's
// crypto signs RS256 out of the box, so this needs no googleapis dependency —
// same choice as scripts/import-legal-docs.mjs, which talks to Drive over
// plain fetch.
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getAccessToken(serviceAccountJson) {
  let sa
  try {
    sa = JSON.parse(serviceAccountJson)
  } catch {
    throw new Error('GDRIVE_SERVICE_ACCOUNT n\'est pas du JSON valide (colle le fichier entier).')
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GDRIVE_SERVICE_ACCOUNT : client_email ou private_key manquant.')
  }

  const iat = Math.floor(Date.now() / 1000)
  const claims = {
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const jwt = `${unsigned}.${b64url(signer.sign(sa.private_key))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`Auth Google refusée (${res.status}) : ${await res.text()}`)
  return (await res.json()).access_token
}

// ── Export + verification ─────────────────────────────────────────────────
async function exportSnapshot(path, includeFiles) {
  const flags = ['exec', 'convex', 'export', '--prod', '--path', path]
  if (includeFiles) flags.push('--include-file-storage')
  await run('pnpm', flags, { maxBuffer: 32 * 1024 * 1024 })
}

/**
 * Refuse an archive that would be useless on the day it is needed. `unzip -t`
 * walks every entry and checks its CRC, so it catches a truncated or
 * corrupted file — the failure mode a size check alone would wave through.
 */
async function verifyArchive(path, includeFiles) {
  const { size } = await stat(path)
  if (size < MIN_PLAUSIBLE_BYTES) {
    throw new Error(`Archive suspecte : ${human(size)}, sous le plancher de ${human(MIN_PLAUSIBLE_BYTES)}.`)
  }

  try {
    await run('unzip', ['-t', '-qq', path], { maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
    throw new Error(`Archive corrompue (unzip -t a échoué) : ${err.message}`)
  }

  const { stdout } = await run('unzip', ['-Z1', path], { maxBuffer: 128 * 1024 * 1024 })
  const entries = stdout.split('\n')
  for (const table of EXPECTED_TABLES) {
    // `unzip -Z1` lists directory markers too ("deals/"), so require a real
    // entry underneath: an empty folder is not an exported table.
    if (!entries.some((e) => e.startsWith(`${table}/`) && e.length > table.length + 1)) {
      throw new Error(`Archive incomplète : la table « ${table} » est absente ou vide.`)
    }
  }
  if (includeFiles && !entries.some((e) => e.startsWith('_storage'))) {
    throw new Error('Archive « full » sans dossier _storage : les fichiers manquent.')
  }
  return { size, entries: entries.length }
}

// ── Drive ─────────────────────────────────────────────────────────────────
async function uploadArchive(token, folderId, path, name, size) {
  const start = await fetch(`${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, parents: [folderId] }),
  })
  if (!start.ok) throw new Error(`Ouverture de l'upload refusée (${start.status}) : ${await start.text()}`)
  const location = start.headers.get('location')
  if (!location) throw new Error("Drive n'a pas renvoyé d'URL d'upload.")

  // Streamed in one PUT rather than chunked: on failure the whole run fails
  // and the next day's cron produces a fresh archive, which is a fine outcome
  // for a backup and keeps this script small.
  const res = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip', 'Content-Length': String(size) },
    body: Readable.toWeb(createReadStream(path)),
    duplex: 'half',
  })
  if (!res.ok) throw new Error(`Upload refusé (${res.status}) : ${await res.text()}`)
  return await res.json()
}

async function listArchives(token, folderId) {
  const files = []
  let pageToken
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Listing refusé (${res.status}) : ${await res.text()}`)
    const body = await res.json()
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)
  return files
}

async function deleteArchive(token, id) {
  const res = await fetch(`${FILES_URL}/${id}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 = already gone: a previous run purged it, nothing to report.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Suppression refusée (${res.status}) : ${await res.text()}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const includeFiles = decideKind(now)
  const name = `albo-os-${date}${includeFiles ? '-full' : ''}.zip`

  console.log(`Archive du jour : ${name} (${includeFiles ? 'données + fichiers' : 'données seules'})`)

  const folderId = requireEnv('GDRIVE_BACKUP_FOLDER_ID')
  const serviceAccount = requireEnv('GDRIVE_SERVICE_ACCOUNT')

  const dir = await mkdtemp(join(tmpdir(), 'albo-backup-'))
  const path = join(dir, name)
  try {
    console.log('  export en cours…')
    await exportSnapshot(path, includeFiles)

    const { size, entries } = await verifyArchive(path, includeFiles)
    console.log(`  archive vérifiée : ${human(size)}, ${entries} entrées`)

    const token = await getAccessToken(serviceAccount)
    const existing = await listArchives(token, folderId)
    const { keep, drop, unknown } = planRetention([...existing.map((f) => f.name), name])

    if (dry) {
      console.log(`\n[--dry] rien n'est envoyé ni supprimé.`)
      console.log(`  garderait  : ${keep.length} archives`)
      console.log(`  supprimerait : ${drop.length ? drop.join(', ') : '(aucune)'}`)
      if (unknown.length) console.log(`  ignorerait : ${unknown.join(', ')}`)
      return
    }

    await uploadArchive(token, folderId, path, name, size)
    console.log(`  envoyée sur le Drive`)

    // Only now, with today's archive safely stored.
    if (unknown.length) {
      console.log(`  ${unknown.length} fichier(s) hors convention, laissés en place : ${unknown.join(', ')}`)
    }
    if (keep.length === 0) {
      // Cannot happen (today's archive is always kept), so if it does the
      // rotation is wrong and deleting would be the worst possible move.
      console.log('  ⚠️ rétention vide — purge annulée par sécurité.')
      return
    }
    const byName = new Map(existing.map((f) => [f.name, f.id]))
    for (const stale of drop) {
      const id = byName.get(stale)
      if (!id) continue
      await deleteArchive(token, id)
      console.log(`  purgée : ${stale}`)
    }
    console.log(`\n${keep.length} archives conservées, ${drop.length} purgées.`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
