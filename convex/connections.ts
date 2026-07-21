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
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import { requireOrgMember, requireOrgRole } from './lib/auth'
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

/** Record the outcome of a connection attempt. Success stamps
 * `lastConnectedAt` and clears `lastError`; failure records `lastError`
 * ONLY, so `lastConnectedAt` always means "last SUCCESSFUL sync" — a
 * failing connection must never display a fresh "last sync" next to its
 * red state dot. Called by platform modules after each login/pull. */
export const markConnected = internalMutation({
  args: {
    connectionId: v.id('externalConnections'),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch(
      'externalConnections',
      connectionId,
      error === undefined
        ? { lastConnectedAt: Date.now(), lastError: undefined }
        : { lastError: error },
    )
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

// ── Org-facing integrations view + connect/disconnect ───────────────────────

type IntegrationConnection = {
  /** `externalConnections` id (credentials) or the platform-side connection
   * id (webview) — what the connect/disconnect/reconnect actions take. */
  id: string
  label: string
  state: string
  lastConnectedAt: number | null
  /** Last failure message (sanitized platform-side, no secret) — lets the
   * UI say WHY a connection is red instead of a bare dot. */
  lastError: string | null
  /** auth 'credentials': the row's NON-SECRET settings (registry
   * `configKeys`, e.g. VASCO's clientSlug) — prefills the edit form.
   * Credentials never travel this way (write-only). */
  config?: Record<string, string>
}

type IntegrationItem = {
  platform: string
  scope: string
  auth: string
  /** The platform supports the on-demand `syncNow` pull. */
  manualSync?: boolean
  /** Portfolio entities can be linked to an object of this platform. */
  entityLink?: boolean
  /** auth 'credentials': the registry-declared keys, driving the generic
   * in-app connect form (labels resolved via i18n on the client). */
  configKeys?: Array<string>
  credentialKeys?: Array<string>
  /** org-scoped connectors: one entry per connection row of the org. */
  connections?: Array<IntegrationConnection>
  /** global connectors: whether the capability is operational. */
  configured?: boolean
}

/**
 * On-demand pull for a platform that declares `manualSync` in the registry
 * (e.g. VASCO — Powens is push-based, nothing to trigger). Org-member-guarded;
 * each platform module stamps the per-connection outcome
 * (`lastConnectedAt`/`lastError`), so the Intégrations page updates
 * reactively. A syncable platform = registry flag + one dispatch case below.
 */
export const syncNow = action({
  args: { orgId: v.id('organizations'), platform: v.string() },
  handler: async (ctx, { orgId, platform }): Promise<{ syncedAt: number }> => {
    const def = getConnector(platform)
    if (!def.manualSync) throw new ConvexError('sync_not_supported')
    // Guard: throws unless the caller is a member of the org.
    await ctx.runQuery(internal.connections.authorizeAndListActive, {
      orgId,
      platform,
    })
    switch (platform) {
      case 'vasco':
        await ctx.runAction(internal.vasco.refreshVascoCacheForOrg, { orgId })
        break
      case 'gmail':
        await ctx.runAction(internal.gmail.syncAll, {})
        break
      default:
        throw new ConvexError('sync_not_supported')
    }
    return { syncedAt: Date.now() }
  },
})

/**
 * Connect a credentials platform from the app (the Intégrations control
 * tower). Admin-gated — connecting an external platform is a sensitive
 * action. The row is validated against the registry declaration; the
 * credentials go straight to the internal table and are NEVER returned by
 * any public query. Duplicate label in the org+platform → error (no silent
 * credential overwrite from the UI; overwrite is a deliberate CLI
 * `connections:seedConnection`).
 */
export const createConnection = mutation({
  args: {
    orgId: v.id('organizations'),
    platform: v.string(),
    label: v.string(),
    config: v.optional(v.record(v.string(), v.string())),
    credentials: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const def = getConnector(args.platform)
    parseConnection(def, { config: args.config, credentials: args.credentials })
    const { user } = await requireOrgRole(ctx, args.orgId, 'admin')
    const label = args.label.trim()
    if (!label) throw new ConvexError('label_required')
    const siblings = await ctx.db
      .query('externalConnections')
      .withIndex('by_org_and_platform', (q) =>
        q.eq('orgId', args.orgId).eq('platform', args.platform),
      )
      .collect()
    if (siblings.some((c) => c.label === label)) {
      throw new ConvexError('label_taken')
    }
    return ctx.db.insert('externalConnections', {
      orgId: args.orgId,
      platform: args.platform,
      label,
      config: args.config,
      credentials: args.credentials,
      active: true,
      createdAt: Date.now(),
      createdBy: user._id,
    })
  },
})

/**
 * Fix a credentials connection in place (the « Modifier » button of the
 * Intégrations page): replace its label/config/credentials without losing the
 * row. Admin-gated on the row's org; validated against the registry like
 * `createConnection`. Clears `lastError` (the stored failure belonged to the
 * previous credentials) — the caller re-syncs right after to stamp a fresh
 * outcome. Credentials are write-only: the form never sees the stored ones.
 */
export const updateConnection = mutation({
  args: {
    connectionId: v.id('externalConnections'),
    label: v.string(),
    config: v.optional(v.record(v.string(), v.string())),
    credentials: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('externalConnections', args.connectionId)
    if (!row) throw new ConvexError('not_found')
    const def = getConnector(row.platform)
    parseConnection(def, { config: args.config, credentials: args.credentials })
    await requireOrgRole(ctx, row.orgId, 'admin')
    const label = args.label.trim()
    if (!label) throw new ConvexError('label_required')
    const siblings = await ctx.db
      .query('externalConnections')
      .withIndex('by_org_and_platform', (q) =>
        q.eq('orgId', row.orgId).eq('platform', row.platform),
      )
      .collect()
    if (siblings.some((c) => c._id !== row._id && c.label === label)) {
      throw new ConvexError('label_taken')
    }
    await ctx.db.patch('externalConnections', args.connectionId, {
      label,
      config: args.config,
      credentials: args.credentials,
      active: true,
      lastError: undefined,
    })
    return args.connectionId
  },
})

/**
 * Disconnect (delete) a credentials connection from the app. Admin-gated on
 * the row's org; deleting forgets the stored credentials. Webview platforms
 * (Powens) are NOT disconnectable here — their lifecycle lives on the
 * platform side.
 */
export const disconnectConnection = mutation({
  args: { connectionId: v.id('externalConnections') },
  handler: async (ctx, { connectionId }) => {
    const row = await ctx.db.get('externalConnections', connectionId)
    if (!row) throw new ConvexError('not_found')
    await requireOrgRole(ctx, row.orgId, 'admin')
    await ctx.db.delete('externalConnections', connectionId)
    return { deleted: connectionId }
  },
})

/**
 * Sanitized per-connector view feeding the Réglages → Intégrations page:
 * every registered platform with the org's connections and their state.
 * Org-member-guarded and dispatched per auth kind (like `status`), but NEVER
 * returns `config`/`credentials` — labels, states and timestamps only.
 */
export const listIntegrations = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<Array<IntegrationItem>> => {
    await requireOrgMember(ctx, orgId)
    const now = Date.now()
    const out: Array<IntegrationItem> = []
    for (const def of CONNECTORS) {
      const item: IntegrationItem = {
        platform: def.platform,
        scope: def.scope,
        auth: def.auth,
        manualSync: def.manualSync,
        entityLink: def.entityLink,
      }
      switch (def.auth) {
        case 'credentials': {
          item.configKeys = [...(def.configKeys ?? [])]
          item.credentialKeys = [...(def.credentialKeys ?? [])]
          const rows = await ctx.db
            .query('externalConnections')
            .withIndex('by_org_and_platform', (q) =>
              q.eq('orgId', orgId).eq('platform', def.platform),
            )
            .collect()
          item.connections = rows.map((r) => ({
            id: r._id,
            label: r.label,
            state: !r.active
              ? 'inactive'
              : r.lastError
                ? 'error'
                : r.lastConnectedAt
                  ? 'connected'
                  : 'pending',
            lastConnectedAt: r.lastConnectedAt ?? null,
            lastError: r.lastError ?? null,
            config: r.config ?? {},
          }))
          break
        }
        case 'webview': {
          // Webview platforms own their storage → dispatch per platform.
          if (def.platform === 'gmail') {
            // Global scope: the same mailboxes feed every org.
            const rows = await ctx.db.query('gmailAccounts').take(50)
            item.connections = rows.map((r) => ({
              id: r._id,
              label: r.email,
              state:
                r.status === 'connected'
                  ? 'connected'
                  : r.status === 'reauth_required'
                    ? 'action_required'
                    : 'error',
              lastConnectedAt: r.lastSyncAt ?? null,
              lastError: r.lastError ?? null,
            }))
            break
          }
          const rows = await ctx.db
            .query('powensConnections')
            .withIndex('by_org', (q) => q.eq('orgId', orgId))
            .collect()
          item.connections = rows.map((r) => ({
            id: r.powensConnectionId,
            label: r.connectorName ?? r.powensConnectionId,
            state: connectionHealth(r, now),
            lastConnectedAt: r.lastSuccessfulSyncAt ?? null,
            lastError: r.errorMessage ?? null,
          }))
          break
        }
        case 'env': {
          item.configured = (def.envKeys ?? []).some((k) =>
            Boolean(process.env[k]),
          )
          break
        }
        case 'none': {
          item.configured = true
          break
        }
      }
      out.push(item)
    }
    return out
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
          // Webview platforms own their storage → dispatch per platform.
          if (def.platform === 'gmail') {
            const rows = await ctx.db.query('gmailAccounts').take(50)
            base.connections = rows.map((r) => ({
              orgSlug: 'global',
              label: r.email,
              health: r.status,
              lastConnectedAt: r.lastSyncAt ?? null,
              lastError: r.lastError ?? null,
            }))
            break
          }
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
