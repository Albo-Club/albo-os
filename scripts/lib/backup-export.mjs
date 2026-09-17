/**
 * Build a backup archive's content from the application tables (ALB-234).
 *
 * Replaces `convex export`, which reads the whole deployment — components
 * included — and is billed per byte read: the RAG component's embeddings
 * (~5 GB, derivable) made every nightly export cost 25× the data it saved.
 * cf. `convex/migrations/backupExport.ts` for the why, and KNOWN_ISSUES.md
 * « `convex export` lit chaque composant ».
 *
 * Output layout mirrors a dashboard export so `convex import` still reads it:
 *   <dir>/<table>/documents.jsonl        one Convex document per line
 *   <dir>/_storage/documents.jsonl       one blob's metadata per line (full)
 *   <dir>/_storage/<storageId>           the blob's bytes            (full)
 *
 * Pure in the sense that matters: the two I/O ports (`runQuery` to reach the
 * deployment, `download` to fetch a blob) are injected, so the loop is
 * testable without a deployment (tests/backupExport.test.ts).
 */
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Rows asked per page — the byte budget in `scanPage` is the real bound. */
export const ROWS_PER_PAGE = 500
/** Blobs per metadata page (URLs are minted per blob, so keep it modest). */
export const FILES_PER_PAGE = 100

const MODULE = 'migrations/backupExport'

/**
 * Write every application table under `dir`, and the file storage too when
 * `includeFiles`. Returns per-table document counts (and the file count) so
 * the caller can log and sanity-check what was written.
 *
 * @param {object} ports
 * @param {string} ports.dir
 * @param {boolean} ports.includeFiles
 * @param {(fn: string, args: Record<string, unknown>) => Promise<any>} ports.runQuery
 * @param {(url: string) => Promise<ReadableStream | Readable>} [ports.download]
 */
export async function exportDeployment({
  dir,
  includeFiles,
  runQuery,
  download,
}) {
  const tables = await runQuery(`${MODULE}:listTables`, {})
  const counts = {}
  for (const table of tables) {
    counts[table] = await exportTable({ dir, table, runQuery })
  }
  let files = 0
  if (includeFiles) {
    if (!download)
      throw new Error('download port required when includeFiles is set')
    files = await exportFiles({ dir, runQuery, download })
  }
  return { tables: counts, files }
}

async function exportTable({ dir, table, runQuery }) {
  const folder = join(dir, table)
  await mkdir(folder, { recursive: true })
  const out = createWriteStream(join(folder, 'documents.jsonl'))
  let count = 0
  let cursor = null
  for (;;) {
    const page = await runQuery(`${MODULE}:scanPage`, {
      table,
      cursor,
      numItems: ROWS_PER_PAGE,
    })
    for (const row of page.rows) {
      if (!out.write(`${JSON.stringify(row)}\n`)) {
        await new Promise((resolve) => out.once('drain', resolve))
      }
      count++
    }
    if (page.isDone) break
    cursor = page.cursor
  }
  await new Promise((resolve, reject) =>
    out.end((err) => (err ? reject(err) : resolve())),
  )
  return count
}

async function exportFiles({ dir, runQuery, download }) {
  const folder = join(dir, '_storage')
  await mkdir(folder, { recursive: true })
  const lines = []
  let cursor = null
  for (;;) {
    const page = await runQuery(`${MODULE}:listFilesPage`, {
      cursor,
      numItems: FILES_PER_PAGE,
    })
    for (const { url, ...meta } of page.files) {
      if (!url) throw new Error(`no download URL for blob ${meta._id}`)
      const body = await download(url)
      await pipeline(
        body instanceof Readable ? body : Readable.fromWeb(body),
        createWriteStream(join(folder, meta._id)),
      )
      lines.push(JSON.stringify(meta))
    }
    if (page.isDone) break
    cursor = page.cursor
  }
  await writeFile(
    join(folder, 'documents.jsonl'),
    lines.map((l) => `${l}\n`).join(''),
  )
  return lines.length
}
