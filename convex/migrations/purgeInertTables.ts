/**
 * Empty the four inert tables left behind by retired features, so a follow-up
 * PR can drop them from the schema (MIGRATIONS.md « Purge des tables
 * inertes ») — a deploy refuses to drop a table that still holds rows.
 *
 *   - `gmailAccounts` / `gmailOAuthStates` — the retired Gmail-synced email
 *     timeline (its two content tables went on 18/09/2026).
 *   - `userEmailAliases` — secondary report-forwarding addresses, retired in
 *     09/2026 (cf. KNOWN_ISSUES.md « Adresses d'envoi des reports »).
 *   - `vascoConnections` — superseded by `externalConnections` via
 *     `migrations/externalConnections:migrateVascoConnections`.
 *
 * All four are declared, written by nothing and read by nothing. They are
 * tiny (a handful of rows for two users), so each is read whole in one
 * transaction — no pagination, no script. Two of them hold secrets at rest
 * (`refreshToken`, `password`): the mutation returns COUNTS only, never a row.
 *
 * `dryRun: true` counts and touches nothing. Idempotent: a second run finds
 * every table empty.
 *
 *   pnpm exec convex run --prod migrations/purgeInertTables:run '{"dryRun":true}'
 *   pnpm exec convex run --prod migrations/purgeInertTables:run '{"dryRun":false}'
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

const INERT_TABLES = [
  'userEmailAliases',
  'gmailAccounts',
  'gmailOAuthStates',
  'vascoConnections',
] as const

export const run = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const rows: Record<string, number> = {}
    for (const table of INERT_TABLES) {
      const docs = await ctx.db.query(table).collect()
      rows[table] = docs.length
      if (dryRun) continue
      for (const doc of docs) {
        await ctx.db.delete(table, doc._id)
      }
    }
    const total = Object.values(rows).reduce((s, n) => s + n, 0)
    return { dryRun, rows, total }
  },
})
