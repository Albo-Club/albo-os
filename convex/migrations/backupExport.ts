/**
 * Leaf queries behind the nightly backup (`scripts/convex-backup.mjs`).
 *
 * Why not `convex export`: a snapshot export reads the WHOLE deployment,
 * components included, and Convex bills every byte read. The RAG component
 * alone — 4096-float embeddings per chunk, every replaced version kept — is
 * ~5 GB, so each nightly export read ~5 GB for ~200 MB of application data
 * (42 GB in eight nights, 83 % of the month's Database I/O — cf.
 * KNOWN_ISSUES.md « `convex export` lit chaque composant »). The embeddings
 * are derivable (`vectorize:backfillAll` rebuilds them from the documents),
 * so they have no place in a backup. Neither do the other components' tables:
 * the agent's chat threads, the Better Auth sessions (a user logs in again),
 * the resend queue and the rate limiter are all transient or rebuildable.
 *
 * So the archive is built from the APPLICATION tables only, one page at a
 * time, in the layout of a dashboard export (`<table>/documents.jsonl`,
 * `_storage/documents.jsonl` + one file per blob) so `convex import` still
 * reads it — cf. MIGRATIONS.md § « Backup automatique Convex → Drive ».
 *
 * The pagination loop lives in the script, not in an action: the module only
 * exposes leaf functions so it never references itself through `internal.*`
 * (cf. KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer
 * lui-même hors déploiement »), same shape as `storageAudit.ts`.
 *
 * `scanPage` bounds each page in BYTES, not just in rows: `inboundEmails` and
 * `companyReports` carry up to ~500 KB of text per row, and a query may read
 * 8 MiB at most. Half of that per page keeps every table under the cap
 * whatever its row size; a page always holds at least one document.
 */
import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import schema from '../schema'

import type { TableNames } from '../_generated/dataModel'

/** Read budget per page — half the 8 MiB per-query limit. */
const PAGE_BYTES = 4 * 1024 * 1024

const TABLES = Object.keys(schema.tables) as Array<TableNames>

function isTable(name: string): name is TableNames {
  return (TABLES as Array<string>).includes(name)
}

/** Every application table, so the script never keeps a list of its own. */
export const listTables = internalQuery({
  args: {},
  handler: () => TABLES,
})

/** One page of a table's documents, whole rows, `_id` and `_creationTime` included. */
export const scanPage = internalQuery({
  args: {
    table: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  handler: async (ctx, { table, cursor, numItems }) => {
    if (!isTable(table)) throw new Error(`unknown table: ${table}`)
    const res = await ctx.db
      .query(table)
      .paginate({ cursor, numItems, maximumBytesRead: PAGE_BYTES })
    return { rows: res.page, cursor: res.continueCursor, isDone: res.isDone }
  },
})

/**
 * One page of `_storage` metadata with a download URL per blob. The bytes
 * themselves leave through the URL, never through a function result.
 */
export const listFilesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.system
      .query('_storage')
      .paginate({ cursor, numItems })
    const files = []
    for (const f of res.page) {
      files.push({
        _id: f._id,
        _creationTime: f._creationTime,
        size: f.size,
        contentType: f.contentType ?? null,
        sha256: f.sha256,
        url: await ctx.storage.getUrl(f._id),
      })
    }
    return { files, cursor: res.continueCursor, isDone: res.isDone }
  },
})
