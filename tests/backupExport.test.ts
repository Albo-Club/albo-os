/**
 * The export loop behind the nightly backup (scripts/lib/backup-export.mjs).
 *
 * What must hold: every page is walked to the end (a cursor dropped after
 * the first page would ship a silently truncated archive), every document
 * lands on its own line under `<table>/documents.jsonl`, the file storage is
 * only touched when asked, and a blob without a URL fails loudly rather than
 * leaving a hole in the `-full` archive.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  FILES_PER_PAGE,
  ROWS_PER_PAGE,
  exportDeployment,
} from '../scripts/lib/backup-export.mjs'

type Call = { fn: string; args: Record<string, unknown> }

/** In-memory deployment: tables paged `pageSize` rows at a time. */
function fakeDeployment(
  tables: Record<string, Array<Record<string, unknown>>>,
  files: Array<{ _id: string; url: string | null }> = [],
  pageSize = 2,
) {
  const calls: Array<Call> = []
  const answer = (fn: string, args: Record<string, unknown>): unknown => {
    if (fn.endsWith(':listTables')) return Object.keys(tables)
    if (fn.endsWith(':scanPage')) {
      const rows = tables[args.table as string]
      const start = args.cursor === null ? 0 : Number(args.cursor)
      const end = Math.min(start + pageSize, rows.length)
      return {
        rows: rows.slice(start, end),
        cursor: String(end),
        isDone: end >= rows.length,
      }
    }
    if (fn.endsWith(':listFilesPage')) {
      const start = args.cursor === null ? 0 : Number(args.cursor)
      const end = Math.min(start + pageSize, files.length)
      return {
        files: files
          .slice(start, end)
          .map((f) => ({ ...f, size: 3, sha256: 'x' })),
        cursor: String(end),
        isDone: end >= files.length,
      }
    }
    throw new Error(`unexpected function ${fn}`)
  }
  const runQuery = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    return Promise.resolve(answer(fn, args))
  }
  return { runQuery, calls }
}

const lines = async (path: string) =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

describe('exportDeployment', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-export-test-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('walks every page of every table and writes one document per line', async () => {
    const deals = [1, 2, 3, 4, 5].map((n) => ({
      _id: `d${n}`,
      amount: n * 100,
    }))
    const orgs = [{ _id: 'o1', slug: 'albo' }]
    const { runQuery, calls } = fakeDeployment({
      deals,
      organizations: orgs,
      todos: [],
    })

    const result = await exportDeployment({
      dir,
      includeFiles: false,
      runQuery,
    })

    assert.deepEqual(result, {
      tables: { deals: 5, organizations: 1, todos: 0 },
      files: 0,
    })
    assert.deepEqual(await lines(join(dir, 'deals', 'documents.jsonl')), deals)
    assert.deepEqual(
      await lines(join(dir, 'organizations', 'documents.jsonl')),
      orgs,
    )
    // An empty table still gets its (empty) file: `convex import --replace-all`
    // clears a schema table absent from the archive, presence says "empty on purpose".
    assert.equal((await stat(join(dir, 'todos', 'documents.jsonl'))).size, 0)
    // 5 rows at 2 per page = 3 pages, the last one asked with the previous cursor.
    const dealPages = calls.filter(
      (c) => c.fn.endsWith(':scanPage') && c.args.table === 'deals',
    )
    assert.deepEqual(
      dealPages.map((c) => c.args.cursor),
      [null, '2', '4'],
    )
    assert.ok(dealPages.every((c) => c.args.numItems === ROWS_PER_PAGE))
    await assert.rejects(
      stat(join(dir, '_storage')),
      'no _storage folder without includeFiles',
    )
  })

  it('downloads every blob and lists its metadata when asked for the files', async () => {
    const files = [
      { _id: 'kg1', url: 'https://x/kg1' },
      { _id: 'kg2', url: 'https://x/kg2' },
      { _id: 'kg3', url: 'https://x/kg3' },
    ]
    const { runQuery, calls } = fakeDeployment({ organizations: [] }, files)
    const downloaded: Array<string> = []
    const download = (url: string) => {
      downloaded.push(url)
      return Promise.resolve(Readable.from([url.slice(-3)]))
    }

    const result = await exportDeployment({
      dir,
      includeFiles: true,
      runQuery,
      download,
    })

    assert.equal(result.files, 3)
    assert.deepEqual(
      downloaded,
      files.map((f) => f.url),
    )
    assert.equal(await readFile(join(dir, '_storage', 'kg2'), 'utf8'), 'kg2')
    const meta = await lines(join(dir, '_storage', 'documents.jsonl'))
    assert.deepEqual(
      meta.map((m) => m._id),
      ['kg1', 'kg2', 'kg3'],
    )
    // The URL is a transport detail, not metadata worth archiving.
    assert.ok(meta.every((m) => !('url' in m)))
    const filePages = calls.filter((c) => c.fn.endsWith(':listFilesPage'))
    assert.equal(filePages.length, 2)
    assert.ok(filePages.every((c) => c.args.numItems === FILES_PER_PAGE))
  })

  it('fails loudly on a blob without a download URL', async () => {
    const { runQuery } = fakeDeployment({ organizations: [] }, [
      { _id: 'kg1', url: null },
    ])
    await assert.rejects(
      exportDeployment({
        dir,
        includeFiles: true,
        runQuery,
        download: () => Promise.resolve(Readable.from([])),
      }),
      /no download URL for blob kg1/,
    )
  })

  it('refuses a full export without a download port', async () => {
    const { runQuery } = fakeDeployment({ organizations: [] })
    await assert.rejects(
      exportDeployment({ dir, includeFiles: true, runQuery }),
      /download port/,
    )
  })
})
