/**
 * Empty the two tables of the retired email timeline, `companyEmails` and
 * `companyEmailLinks` (MIGRATIONS.md « Purge de l'ancienne timeline
 * d'e-mails »).
 *
 * Both are declared but inert: written by nothing, read by nothing but the
 * storage audit that sweeps every holder of a blob. Their rows still carry
 * message bodies and pin a few dozen attachments in file storage. "Purge
 * first, tighten later": this module empties them; a follow-up PR drops the
 * tables from the schema (a deploy refuses to drop a table that still holds
 * rows) and takes them out of the audit tooling. The attachments are not
 * deleted here — once no row points at them, `scripts/storage-purge.mjs`
 * treats them as the orphans they have become.
 *
 * Leaf functions only; the loop lives in `scripts/purge-company-emails.mjs`
 * (cf. KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer
 * lui-même hors déploiement »). Pages are bounded in bytes, not only in
 * rows: an email row carries its body.
 *
 * Idempotent: a second pass finds both tables empty.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'

/** Read budget per page — half the 8 MiB per-query limit. */
const PAGE_BYTES = 4 * 1024 * 1024

const tableArg = v.union(
  v.literal('companyEmails'),
  v.literal('companyEmailLinks'),
)

/** One page of a table, reduced to its row count. */
export const scanPage = internalQuery({
  args: {
    table: tableArg,
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  handler: async (ctx, { table, cursor, numItems }) => {
    const res = await ctx.db
      .query(table)
      .paginate({ cursor, numItems, maximumBytesRead: PAGE_BYTES })
    return {
      seen: res.page.length,
      cursor: res.continueCursor,
      isDone: res.isDone,
    }
  },
})

/** Delete the first page of a table. `isDone` says whether a next call is needed. */
export const purgeBatch = internalMutation({
  args: { table: tableArg, numItems: v.number() },
  handler: async (ctx, { table, numItems }) => {
    const res = await ctx.db
      .query(table)
      .paginate({ cursor: null, numItems, maximumBytesRead: PAGE_BYTES })
    for (const row of res.page) {
      await ctx.db.delete(table, row._id)
    }
    return { deleted: res.page.length, isDone: res.isDone }
  },
})
