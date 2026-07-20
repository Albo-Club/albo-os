/**
 * Common core for external platform connections.
 *
 * The registry (`convex/lib/connectors.ts`) declares WHICH platforms exist;
 * this module manages the shared lifecycle of org-scoped `credentials`
 * connections in the generic `externalConnections` table — seeding/removal
 * (CLI), listing for the platform modules, outcome stamping — plus a
 * registry-wide `status` diagnostic. Dispatch is per AUTH KIND, never per
 * platform: adding a credentials platform requires no change here.
 *
 * Rows carry secrets at rest → every listing here is INTERNAL ONLY. A public
 * query must never return a raw row (same rule as `powensUsers`).
 *
 * Platform modules (pull/push logic) consume these queries and adapt the
 * generic rows to their own shape via `parseConnection` — cf. `convex/vasco.ts`
 * as the reference module.
 */

import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { CONNECTORS, getConnector, parseConnection } from './lib/connectors'
import { connectionHealth } from './powens'
import type { Doc } from './_generated/dataModel'

// ── Listings (INTERNAL — rows carry credentials) ────────────────────────────

/**
 * Authorize the caller and return the org's ACTIVE connections for one
 * platform. Membership is checked with the caller's identity, propagated from
 * the calling action.
 */
export const authorizeAndListActive = internalQuery({
  args: { orgId: v.id('organizations'), platform: v.string() },
  handler: async (ctx, { orgId, platform }) => {
    await requireOrgMember(ctx, orgId)
    const conns = await ctx.db
      .query('externalConnections')
      .withIndex('by_org_and_platform', (q) =>
        q.eq('orgId', orgId).eq('platform', platform),
      )
      .collect()
    return conns.filter((c) => c.active)
  },
})

/**
 * Active connections of `orgId` for one platform — auth-less, for
 * system-context callers with no user identity (crons, scheduled actions,
 * e.g. `intelligence.runAnalysis`).
 */
export const listActiveForOrg = internalQuery({
  args: { orgId: v.id('organizations'), platform: v.string() },
  handler: async (ctx, { orgId, platform }) => {
    const conns = await ctx.db
      .query('externalConnections')
      .withIndex('by_org_and_platform', (q) =>
        q.eq('orgId', orgId).eq('platform', platform),
      )
      .collect()
    return conns.filter((c) => c.active)
  },
})

/**
 * Like `listActiveForOrg` but resolved by org slug and auth-less — for
 * CLI-run internal actions (`convex run`), which have no user identity.
 */
export const listActiveByOrgSlug = internalQuery({
  args: { orgSlug: v.string(), platform: v.string() },
  handler: async (ctx, { orgSlug, platform }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    const conns = await ctx.db
      .query('externalConnections')
      .withIndex('by_org_and_platform', (q) =>
        q.eq('orgId', org._id).eq('platform', platform),
      )
      .collect()
    return conns.filter((c) => c.active)
  },
})

/** All active connections of one platform across every org — auth-less, for
 * crons. */
export const listAllActive = internalQuery({
  args: { platform: v.string() },
  handler: async (ctx, { platform }) => {
    const conns = await ctx.db
      .query('externalConnections')
      .withIndex('by_platform', (q) => q.eq('platform', platform))
      .collect()
    return conns.filter((c) => c.active)
  },
})

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Record the outcome of a connection attempt (clears `lastError` on
 * success). Called by platform modules after each login/pull. */
export const markConnected = internalMutation({
  args: {
    connectionId: v.id('externalConnections'),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch('externalConnections', connectionId, {
      lastConnectedAt: Date.now(),
      lastError: error,
    })
  },
})

/**
 * Seed / upsert a connection. One-shot, run from the CLI, e.g.:
 *   npx convex run --prod connections:seedConnection \
 *     '{"orgSlug":"calte","platform":"vasco","label":"Parallel — Calte",
 *       "config":{"clientSlug":"parallel"},
 *       "credentials":{"username":"<login>","password":"<password>"}}'
 * Provide the secrets via `credentials` (plain record) or `credentialsB64`
 * (base64 of the JSON record — use this to avoid shell/paste mangling of
 * special characters). The row is validated against the registry declaration
 * before writing. Upsert key = (org, platform, label). INTERNAL — carries
 * credentials.
 */
export const seedConnection = internalMutation({
  args: {
    orgSlug: v.string(),
    platform: v.string(),
    label: v.string(),
    config: v.optional(v.record(v.string(), v.string())),
    credentials: v.optional(v.record(v.string(), v.string())),
    credentialsB64: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const def = getConnector(args.platform)
    const credentials = args.credentialsB64
      ? (JSON.parse(atob(args.credentialsB64)) as Record<string, string>)
      : args.credentials
    // Validate against the registry before writing (throws on a missing key
    // or on a platform whose connections are not credentials-managed).
    parseConnection(def, { config: args.config, credentials })
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    const existing = (
      await ctx.db
        .query('externalConnections')
        .withIndex('by_org_and_platform', (q) =>
          q.eq('orgId', org._id).eq('platform', args.platform),
        )
        .collect()
    ).find((c) => c.label === args.label)
    if (existing) {
      await ctx.db.patch('externalConnections', existing._id, {
        config: args.config,
        credentials,
        active: true,
      })
      return existing._id
    }
    return ctx.db.insert('externalConnections', {
      orgId: org._id,
      platform: args.platform,
      label: args.label,
      config: args.config,
      credentials,
      active: true,
      createdAt: Date.now(),
    })
  },
})

/**
 * Delete a connection row (e.g. remove a mistakenly-seeded one). One-shot CLI:
 *   npx convex run --prod connections:removeConnection '{"connectionId":"<id>"}'
 */
export const removeConnection = internalMutation({
  args: { connectionId: v.id('externalConnections') },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.delete('externalConnections', connectionId)
    return { deleted: connectionId }
  },
})

// ── Registry-wide status (CLI diagnostic) ───────────────────────────────────

type ConnectorStatus = {
  platform: string
  label: string
  scope: string
  auth: string
  module: string
  /** auth 'credentials' | 'webview': one entry per connection row. */
  connections?: Array<{
    orgSlug: string
    label: string
    active?: boolean
    health?: string
    lastConnectedAt?: number | null
    lastError?: string | null
  }>
  /** auth 'env': which enabling env vars are set. */
  env?: Record<string, boolean>
  /** auth 'none': always true. */
  available?: boolean
}

/**
 * One status entry per registered connector, across every org — the "no
 * hand-coded exception" view: it iterates the registry and dispatches on the
 * auth KIND only. Sanitized (no credential ever leaves), but INTERNAL — it is
 * a cross-org ops/CLI diagnostic, not an app surface:
 *   npx convex run --prod connections:status '{}'
 */
export const status = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<ConnectorStatus>> => {
    const orgs = await ctx.db.query('organizations').collect()
    const orgSlug = new Map(orgs.map((o) => [o._id, o.slug]))
    const now = Date.now()

    const out: Array<ConnectorStatus> = []
    for (const def of CONNECTORS) {
      const base: ConnectorStatus = {
        platform: def.platform,
        label: def.label,
        scope: def.scope,
        auth: def.auth,
        module: def.module,
      }
      switch (def.auth) {
        case 'credentials': {
          const rows = await ctx.db
            .query('externalConnections')
            .withIndex('by_platform', (q) => q.eq('platform', def.platform))
            .collect()
          base.connections = rows.map((r) => ({
            orgSlug: orgSlug.get(r.orgId) ?? String(r.orgId),
            label: r.label,
            active: r.active,
            lastConnectedAt: r.lastConnectedAt ?? null,
            lastError: r.lastError ?? null,
          }))
          break
        }
        case 'webview': {
          // Webview platforms own their storage; today that is Powens only,
          // whose health rows live in `powensConnections`.
          const rows: Array<Doc<'powensConnections'>> = await ctx.db
            .query('powensConnections')
            .collect()
          base.connections = rows.map((r) => ({
            orgSlug: orgSlug.get(r.orgId) ?? String(r.orgId),
            label: r.connectorName ?? r.powensConnectionId,
            health: connectionHealth(r, now),
            lastConnectedAt: r.lastSuccessfulSyncAt ?? null,
            lastError: r.errorMessage ?? null,
          }))
          break
        }
        case 'env': {
          base.env = Object.fromEntries(
            (def.envKeys ?? []).map((k) => [k, Boolean(process.env[k])]),
          )
          break
        }
        case 'none': {
          base.available = true
          break
        }
      }
      out.push(base)
    }
    return out
  },
})
