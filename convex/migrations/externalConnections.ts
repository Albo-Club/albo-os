/**
 * One-shot: copy the legacy `vascoConnections` rows into the generic
 * `externalConnections` table (platform 'vasco'), managed by the connections
 * core (`convex/connections.ts`). Additive and idempotent — a legacy row
 * already present in the new table (same clientSlug + username) is skipped;
 * the legacy table is left untouched (declared-but-inert until the
 * purge-then-narrow cleanup, cf. `MIGRATIONS.md`).
 *
 * ⚠️ Run RIGHT AFTER deploying the connections-core refactor: until this has
 * run, the VASCO module sees zero connections (the new table is empty).
 *
 *   npx convex run --prod migrations/externalConnections:migrateVascoConnections
 */
import { internalMutation } from '../_generated/server'

export const migrateVascoConnections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const legacy = await ctx.db.query('vascoConnections').collect()
    const existing = await ctx.db
      .query('externalConnections')
      .withIndex('by_platform', (q) => q.eq('platform', 'vasco'))
      .collect()
    const seen = new Set(
      existing.map(
        (c) => `${c.config?.clientSlug ?? ''}:${c.credentials?.username ?? ''}`,
      ),
    )
    let migrated = 0
    let skipped = 0
    for (const row of legacy) {
      if (seen.has(`${row.clientSlug}:${row.username}`)) {
        skipped++
        continue
      }
      await ctx.db.insert('externalConnections', {
        orgId: row.orgId,
        platform: 'vasco',
        label: row.label,
        config: { clientSlug: row.clientSlug },
        credentials: { username: row.username, password: row.password },
        active: row.active,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        lastConnectedAt: row.lastConnectedAt,
        lastError: row.lastError,
      })
      migrated++
    }
    return { migrated, skipped }
  },
})
