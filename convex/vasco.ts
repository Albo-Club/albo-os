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
 * denied. Holdings are therefore read via
 *   JWT `id` → GetUser(id).accounts → GetAccount(id).accountSecurityContracts.
 */

import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { requireOrgMember } from './lib/auth'
import type { Doc } from './_generated/dataModel'

// ── HTTP / GraphQL helpers ──────────────────────────────────────────────────

type VascoCreds = Pick<
  Doc<'vascoConnections'>,
  'clientSlug' | 'username' | 'password'
>

function vascoBaseUrl(clientSlug: string): string {
  return `https://api.${clientSlug}.vasco.fund`
}

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  })
  if (!res.ok) throw new ConvexError('vasco_login_failed')
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

const GET_ACCOUNT = `query($id: ID!) {
  GetAccount(id: $id) {
    id
    label
    accountSecurityContracts {
      id
      redeemableSecuritiesNumber
      currentWithdrawalPrice
      security { id name }
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

type GetAccountResult = {
  GetAccount: {
    id: string
    label: string
    accountSecurityContracts: Array<{
      id: string
      redeemableSecuritiesNumber: number | null
      currentWithdrawalPrice: number | null
      security: { id: string; name: string }
    }> | null
    accountDocuments: Array<{ __typename: string }> | null
  } | null
}

export type VascoAccountParticipations = {
  accountId: string
  accountLabel: string
  accountType: string
  documentsCount: number
  holdings: Array<{
    contractId: string
    securityId: string
    securityName: string
    redeemableSecuritiesNumber: number | null
    currentWithdrawalPrice: number | null
  }>
}

/** Log in for one connection and read every account's holdings. */
async function pullParticipations(
  creds: VascoCreds,
): Promise<Array<VascoAccountParticipations>> {
  const { token, userId } = await vascoLogin(creds)
  const userData = await vascoGraphql<GetUserResult>(
    creds.clientSlug,
    token,
    GET_USER,
    { id: userId },
  )
  const accounts = userData.GetUser?.accounts ?? []
  const out: Array<VascoAccountParticipations> = []
  for (const acc of accounts) {
    const accData = await vascoGraphql<GetAccountResult>(
      creds.clientSlug,
      token,
      GET_ACCOUNT,
      { id: acc.id },
    )
    const a = accData.GetAccount
    if (!a) continue
    out.push({
      accountId: a.id,
      accountLabel: a.label,
      accountType: acc.__typename,
      documentsCount: (a.accountDocuments ?? []).length,
      holdings: (a.accountSecurityContracts ?? []).map((c) => ({
        contractId: c.id,
        securityId: c.security.id,
        securityName: c.security.name,
        redeemableSecuritiesNumber: c.redeemableSecuritiesNumber,
        currentWithdrawalPrice: c.currentWithdrawalPrice,
      })),
    })
  }
  return out
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

// ── Proof action (étape 1) ──────────────────────────────────────────────────

/**
 * For every active VASCO connection of `orgId`, log in and return the accounts
 * and their holdings (+ a reportings count). Org-member-guarded. Read-only:
 * nothing is written to the portfolio tables yet — the deal bridge, valuations
 * and documents land in later steps.
 */
export const fetchParticipations = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.authorizeAndListConnections,
      { orgId },
    )
    const connections: Array<{
      clientSlug: string
      label: string
      accounts: Array<VascoAccountParticipations>
      error?: string
    }> = []
    for (const conn of conns) {
      try {
        const accounts = await pullParticipations(conn)
        connections.push({
          clientSlug: conn.clientSlug,
          label: conn.label,
          accounts,
        })
        await ctx.runMutation(internal.vasco.markConnected, {
          connectionId: conn._id,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        connections.push({
          clientSlug: conn.clientSlug,
          label: conn.label,
          accounts: [],
          error: message,
        })
        await ctx.runMutation(internal.vasco.markConnected, {
          connectionId: conn._id,
          error: message,
        })
      }
    }
    return { orgId, connections }
  },
})
