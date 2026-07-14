/**
 * VASCO integration — investor-side pull.
 *
 * VASCO (https://vasco.fund) is the fund-admin platform backing vehicles such
 * as Parallel Invest (`parallel.vasco.fund`). Albo OS pulls the data that only
 * lives on the platform — positions, valuations, documents/reportings — since
 * nothing arrives by email (distinct from the AgentMail report pipeline).
 *
 * Runs in the default Convex runtime (global `fetch`, no "use node"). Each
 * VASCO client exposes a GraphQL API at `https://api.<clientSlug>.vasco.fund/
 * graphql/` behind a JWT (POST /auth/login → { token }).
 *
 * Investor scoping (see KNOWN_ISSUES.md "VASCO API"): introspection is
 * disabled, and the investor persona (ROLE_DISTRIBUTED_CUSTOMER) only sees a
 * subset — `GetAccounts` / `GetSecurities` / `GetParticipationsSummary` are
 * denied, and the monetary fields on `accountSecurityContracts` come back
 * masked (zeroed). The real invested amounts live on `Account.investments`,
 * read via  JWT `id` → GetUser(id).accounts → GetAccount(id).investments.
 */

import { ConvexError, v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import { requireOrgMember } from './lib/auth'
import type { GenericActionCtx } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'

type ActionCtx = GenericActionCtx<DataModel>

// ── HTTP / GraphQL helpers ──────────────────────────────────────────────────

type VascoCreds = Pick<
  Doc<'vascoConnections'>,
  'clientSlug' | 'username' | 'password'
>

function vascoBaseUrl(clientSlug: string): string {
  return `https://api.${clientSlug}.vasco.fund`
}

// Identify the integration; some WAFs reject requests with an empty/unknown UA.
const USER_AGENT = 'Albo-OS VASCO integration (+https://alboteam.com)'

/** Decode a base64url JWT segment to UTF-8 (same primitives as powens.ts). */
function decodeBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bytes = Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** POST /auth/login → JWT, plus the user `id` decoded from its claims. */
async function vascoLogin(
  creds: VascoCreds,
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${vascoBaseUrl(creds.clientSlug)}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ConvexError(
      `vasco_login_failed: HTTP ${res.status} ${body.slice(0, 160)}`,
    )
  }
  const json = (await res.json()) as { token?: string }
  if (!json.token) throw new ConvexError('vasco_login_no_token')
  const claims = JSON.parse(
    decodeBase64Url(json.token.split('.')[1] ?? ''),
  ) as { id?: number | string }
  if (claims.id == null) throw new ConvexError('vasco_jwt_no_id')
  return { token: json.token, userId: String(claims.id) }
}

/** Authenticated GraphQL call. Throws on top-level GraphQL errors. */
async function vascoGraphql<T>(
  clientSlug: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${vascoBaseUrl(clientSlug)}/graphql/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new ConvexError(
      `vasco_graphql_error: ${json.errors.map((e) => e.message).join('; ')}`,
    )
  }
  if (json.data === undefined) throw new ConvexError('vasco_graphql_no_data')
  return json.data
}

// ── Investor read path (hand-written queries — introspection is disabled) ────

const GET_USER = `query($id: ID!) {
  GetUser(id: $id) { id accounts { __typename id label } }
}`

// `amount` is the custom scalar `Amount`, serialized as { amountInCents,
// currency } — it takes no sub-selection.
const GET_ACCOUNT = `query($id: ID!) {
  GetAccount(id: $id) {
    id
    label
    investments {
      id
      securityName
      vehicleName
      amount
      securitiesNumber
      priceBySecurity
      effectiveDate
      capitalCallPercentage
    }
    accountDocuments { __typename }
  }
}`

type GetUserResult = {
  GetUser: {
    id: string
    accounts: Array<{ __typename: string; id: string; label?: string | null }>
  } | null
}

type VascoAmount = { amountInCents?: number | null; currency?: string | null }

type InvestmentNode = {
  id: string
  securityName?: string | null
  vehicleName?: string | null
  amount?: VascoAmount | null
  securitiesNumber?: number | null
  priceBySecurity?: number | null
  effectiveDate?: string | null
  capitalCallPercentage?: number | null
}

type GetAccountResult = {
  GetAccount: {
    id: string
    label: string
    investments: Array<InvestmentNode | null> | null
    accountDocuments: Array<{ __typename: string }> | null
  } | null
}

export type VascoInvestment = {
  investmentId: string
  securityName: string | null
  vehicleName: string | null
  investedCents: number | null
  currency: string | null
  securitiesNumber: number | null
  priceBySecurity: number | null
  effectiveDate: string | null
  capitalCallPercentage: number | null
}

export type VascoAccountPositions = {
  accountId: string
  accountLabel: string
  accountType: string
  documentsCount: number
  totalInvestedCents: number
  investments: Array<VascoInvestment>
}

/** Log in for one connection and read every account's investments. */
async function pullPositions(
  creds: VascoCreds,
): Promise<Array<VascoAccountPositions>> {
  const { token, userId } = await vascoLogin(creds)
  const userData = await vascoGraphql<GetUserResult>(
    creds.clientSlug,
    token,
    GET_USER,
    { id: userId },
  )
  const accounts = userData.GetUser?.accounts ?? []
  const out: Array<VascoAccountPositions> = []
  for (const acc of accounts) {
    const accData = await vascoGraphql<GetAccountResult>(
      creds.clientSlug,
      token,
      GET_ACCOUNT,
      { id: acc.id },
    )
    const a = accData.GetAccount
    if (!a) continue
    const investments: Array<VascoInvestment> = (a.investments ?? [])
      .filter((inv): inv is InvestmentNode => inv != null)
      .map((inv) => ({
        investmentId: inv.id,
        securityName: inv.securityName ?? null,
        vehicleName: inv.vehicleName ?? null,
        investedCents: inv.amount?.amountInCents ?? null,
        currency: inv.amount?.currency ?? null,
        securitiesNumber: inv.securitiesNumber ?? null,
        priceBySecurity: inv.priceBySecurity ?? null,
        effectiveDate: inv.effectiveDate ?? null,
        capitalCallPercentage: inv.capitalCallPercentage ?? null,
      }))
    const totalInvestedCents = investments.reduce(
      (s, i) => s + (i.investedCents ?? 0),
      0,
    )
    out.push({
      accountId: a.id,
      accountLabel: a.label,
      accountType: acc.__typename,
      documentsCount: (a.accountDocuments ?? []).length,
      totalInvestedCents,
      investments,
    })
  }
  return out
}

type ConnectionResult = {
  clientSlug: string
  label: string
  totalInvestedCents: number
  accounts: Array<VascoAccountPositions>
  error?: string
}

/** Log in and read each connection, recording the outcome. Shared by the two
 * read entry points (public action + CLI internal action). */
async function runConnections(
  ctx: ActionCtx,
  conns: Array<Doc<'vascoConnections'>>,
): Promise<Array<ConnectionResult>> {
  const results: Array<ConnectionResult> = []
  for (const conn of conns) {
    try {
      const accounts = await pullPositions(conn)
      const totalInvestedCents = accounts.reduce(
        (s, a) => s + a.totalInvestedCents,
        0,
      )
      results.push({
        clientSlug: conn.clientSlug,
        label: conn.label,
        totalInvestedCents,
        accounts,
      })
      await ctx.runMutation(internal.vasco.markConnected, {
        connectionId: conn._id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        clientSlug: conn.clientSlug,
        label: conn.label,
        totalInvestedCents: 0,
        accounts: [],
        error: message,
      })
      await ctx.runMutation(internal.vasco.markConnected, {
        connectionId: conn._id,
        error: message,
      })
    }
  }
  return results
}

// ── Connection registry (internal-only — rows carry credentials) ────────────

/**
 * Authorize the caller and return the org's ACTIVE connections. Membership is
 * checked with the caller's identity, propagated from the calling action
 * (same pattern as powens.powensAuthProbe). Returns raw rows including
 * credentials — INTERNAL ONLY, never expose to a public query.
 */
export const authorizeAndListConnections = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const conns = await ctx.db
      .query('vascoConnections')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return conns.filter((c) => c.active)
  },
})

/**
 * Like `authorizeAndListConnections` but resolved by org slug and WITHOUT an
 * auth check — for CLI-run internal actions (`convex run`), which have no user
 * identity. INTERNAL ONLY (never exposed publicly); rows carry credentials.
 */
export const getConnectionsByOrgSlug = internalQuery({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    const conns = await ctx.db
      .query('vascoConnections')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    return conns.filter((c) => c.active)
  },
})

/** Record the outcome of a connection attempt (clears `lastError` on success). */
export const markConnected = internalMutation({
  args: {
    connectionId: v.id('vascoConnections'),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch('vascoConnections', connectionId, {
      lastConnectedAt: Date.now(),
      lastError: error,
    })
  },
})

/**
 * Seed / upsert a connection. One-shot, run from the CLI, e.g.:
 *   npx convex run --prod vasco:seedConnection \
 *     '{"orgSlug":"calte","clientSlug":"parallel","label":"Parallel — Calte",
 *       "username":"<login>","password":"<password>"}'
 * Upsert key = (clientSlug, username). INTERNAL — carries credentials.
 */
export const seedConnection = internalMutation({
  args: {
    orgSlug: v.string(),
    clientSlug: v.string(),
    label: v.string(),
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    const existing = await ctx.db
      .query('vascoConnections')
      .withIndex('by_client_and_username', (q) =>
        q.eq('clientSlug', args.clientSlug).eq('username', args.username),
      )
      .unique()
    if (existing) {
      await ctx.db.patch('vascoConnections', existing._id, {
        orgId: org._id,
        label: args.label,
        password: args.password,
        active: true,
      })
      return existing._id
    }
    return ctx.db.insert('vascoConnections', {
      orgId: org._id,
      clientSlug: args.clientSlug,
      label: args.label,
      username: args.username,
      password: args.password,
      active: true,
      createdAt: Date.now(),
    })
  },
})

/**
 * Delete a connection row (e.g. remove a mistakenly-seeded one). One-shot CLI:
 *   npx convex run --prod vasco:deleteConnection '{"connectionId":"<id>"}'
 */
export const deleteConnection = internalMutation({
  args: { connectionId: v.id('vascoConnections') },
  handler: async (ctx, { connectionId }) => {
    await ctx.db.delete('vascoConnections', connectionId)
    return { deleted: connectionId }
  },
})

// ── Read actions ────────────────────────────────────────────────────────────

/**
 * For every active VASCO connection of `orgId`, log in and return the accounts
 * and their investments. Org-member-guarded. Read-only — nothing is written to
 * the portfolio tables yet (the deal bridge + valuations land in a later step).
 */
export const fetchParticipations = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.authorizeAndListConnections,
      { orgId },
    )
    return { orgId, connections: await runConnections(ctx, conns) }
  },
})

/**
 * Same read as `fetchParticipations`, resolved by org slug and runnable from
 * the CLI without an auth session (internal action):
 *   npx convex run --prod vasco:verifyConnection '{"orgSlug":"calte"}'
 * Handy to confirm a seeded connection actually reaches VASCO in prod.
 */
export const verifyConnection = internalAction({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getConnectionsByOrgSlug,
      { orgSlug },
    )
    return { orgSlug, connections: await runConnections(ctx, conns) }
  },
})

/**
 * Diagnostic (CLI): why does the VASCO login fail from Convex prod when the
 * same creds work elsewhere? Returns Convex's egress IP + the RAW login
 * response (status + body) per connection — no throwing, token redacted.
 *   npx convex run --prod vasco:debugVascoLogin '{"orgSlug":"calte"}'
 */
export const debugVascoLogin = internalAction({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getConnectionsByOrgSlug,
      { orgSlug },
    )
    const egressIp = await fetch('https://api.ipify.org')
      .then((r) => r.text())
      .catch(
        (e) => `ipify_failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    const results: Array<{
      label: string
      clientSlug: string
      status: number
      ok: boolean
      hasToken: boolean
      bodySnippet: string
    }> = []
    for (const conn of conns) {
      try {
        const res = await fetch(`${vascoBaseUrl(conn.clientSlug)}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            username: conn.username,
            password: conn.password,
          }),
        })
        const body = await res.text().catch(() => '')
        let hasToken = false
        try {
          hasToken = Boolean((JSON.parse(body) as { token?: string }).token)
        } catch {
          hasToken = false
        }
        results.push({
          label: conn.label,
          clientSlug: conn.clientSlug,
          status: res.status,
          ok: res.ok,
          hasToken,
          // Redact the token on success; surface the error body on failure.
          bodySnippet: res.ok ? '(token received)' : body.slice(0, 200),
        })
      } catch (err) {
        results.push({
          label: conn.label,
          clientSlug: conn.clientSlug,
          status: 0,
          ok: false,
          hasToken: false,
          bodySnippet: `fetch_threw: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
    return { orgSlug, egressIp, results }
  },
})
