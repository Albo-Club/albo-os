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
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import { requireOrgMember } from './lib/auth'
import type { GenericActionCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

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

/** First 12 hex chars of the SHA-256 of `input` — a non-reversible fingerprint
 * to compare a stored secret against an expected one without exposing it. */
async function sha256Hex12(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
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
  gqlQuery: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${vascoBaseUrl(clientSlug)}/graphql/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query: gqlQuery, variables }),
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

/**
 * Like `vascoGraphql` but non-throwing and diagnostic: returns the FULL parsed
 * response (`data` + `errors` + `extensions`) plus the HTTP status. Access
 * denial on this API arrives as `extensions.warnings` with the field nulled
 * (NOT a top-level `errors` entry), so a probe must surface the raw body to be
 * useful — hence no throwing and no `data`-only unwrap.
 */
async function vascoGraphqlRaw(
  clientSlug: string,
  token: string,
  gqlQuery: string,
  variables: Record<string, unknown> = {},
): Promise<{ httpStatus: number; body: unknown }> {
  const res = await fetch(`${vascoBaseUrl(clientSlug)}/graphql/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query: gqlQuery, variables }),
  })
  const text = await res.text().catch(() => '')
  try {
    return { httpStatus: res.status, body: JSON.parse(text) as unknown }
  } catch {
    return { httpStatus: res.status, body: text }
  }
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

// Investor-side communications (per-issuer, dated, with attached documents).
// Selection kept to fields whose kind is known from the docs (introspection is
// off): `period`/`publishDate` are Date/DateTime scalars, `issuer` a Company,
// `communicationDocuments` wrap a Document. `communicationType`/`state` are left
// out of the probe to avoid an object-without-subselection validation error
// before we've confirmed their kind live.
const GET_COMMUNICATIONS = `query($accountId: ID, $userId: ID, $issuerId: ID) {
  GetCommunications(accountId: $accountId, userId: $userId, issuerId: $issuerId) {
    id
    title
    htmlContent
    period
    publishDate
    issuer { id label }
    communicationDocuments { id document { id name createdAt contentType downloadUrl } }
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

/**
 * Active connections of `orgId` — auth-less, keyed by orgId. Mirrors
 * `getConnectionsByOrgSlug` but for system-context callers that already hold an
 * orgId (e.g. `intelligence.runAnalysis`, which runs with no user identity, so
 * `requireOrgMember` can't apply). INTERNAL ONLY (never exposed publicly); rows
 * carry credentials.
 */
export const getActiveConnectionsByOrgId = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
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
    // Provide exactly one: `password` (plain) or `passwordB64` (base64 — use
    // this to avoid shell/paste mangling of special characters).
    password: v.optional(v.string()),
    passwordB64: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const password = args.passwordB64 ? atob(args.passwordB64) : args.password
    if (!password) throw new ConvexError('password_required')
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
        password,
        active: true,
      })
      return existing._id
    }
    return ctx.db.insert('vascoConnections', {
      orgId: org._id,
      clientSlug: args.clientSlug,
      label: args.label,
      username: args.username,
      password,
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
      storedUsername: string
      storedPasswordLen: number
      storedPasswordSha12: string
      status: number
      ok: boolean
      hasToken: boolean
      bodySnippet: string
    }> = []
    for (const conn of conns) {
      const storedUsername = conn.username
      const storedPasswordLen = conn.password.length
      const storedPasswordSha12 = await sha256Hex12(conn.password)
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
          storedUsername,
          storedPasswordLen,
          storedPasswordSha12,
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
          storedUsername,
          storedPasswordLen,
          storedPasswordSha12,
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

/**
 * Diagnostic (CLI): can the investor persona actually READ `GetCommunications`,
 * and under what scoping? Introspection is off and `accountComments` is refused
 * to the investor persona (KNOWN_ISSUES "VASCO API"), so reachability is unknown
 * until probed live. Per connection: logs in, lists the accounts, then runs
 * `GetCommunications` under each candidate scope (by user, then by each account)
 * and returns the RAW response (`data` + `errors` + `extensions.warnings`) so
 * access-denial stays visible. Non-throwing — a bad connection is recorded, not
 * fatal.
 *   npx convex run --prod vasco:probeCommunications '{"orgSlug":"calte"}'
 */
export const probeCommunications = internalAction({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getConnectionsByOrgSlug,
      { orgSlug },
    )
    const connections: Array<{
      label: string
      clientSlug: string
      error?: string
      userId?: string
      accounts?: Array<{ id: string; label?: string | null; type: string }>
      probes?: Array<{ scope: string; httpStatus: number; body: unknown }>
    }> = []
    for (const conn of conns) {
      try {
        const { token, userId } = await vascoLogin(conn)
        const userData = await vascoGraphql<GetUserResult>(
          conn.clientSlug,
          token,
          GET_USER,
          { id: userId },
        )
        const accounts = (userData.GetUser?.accounts ?? []).map((a) => ({
          id: a.id,
          label: a.label,
          type: a.__typename,
        }))
        const probes: Array<{
          scope: string
          httpStatus: number
          body: unknown
        }> = []
        // Candidate investor scopings: by user, then by each account id.
        probes.push({
          scope: `userId=${userId}`,
          ...(await vascoGraphqlRaw(conn.clientSlug, token, GET_COMMUNICATIONS, {
            userId,
          })),
        })
        for (const acc of accounts) {
          probes.push({
            scope: `accountId=${acc.id} (${acc.label ?? acc.type})`,
            ...(await vascoGraphqlRaw(
              conn.clientSlug,
              token,
              GET_COMMUNICATIONS,
              { accountId: acc.id },
            )),
          })
        }
        connections.push({
          label: conn.label,
          clientSlug: conn.clientSlug,
          userId,
          accounts,
          probes,
        })
      } catch (err) {
        connections.push({
          label: conn.label,
          clientSlug: conn.clientSlug,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { orgSlug, connections }
  },
})

// ── Communications (per-issuer investor updates) ────────────────────────────

export type VascoCommunicationDoc = {
  documentId: string
  name: string | null
  contentType: string | null
  createdAt: string | null
}

export type VascoCommunication = {
  communicationId: string
  issuerId: string
  issuerLabel: string | null
  title: string | null
  // `htmlContent` stripped to plain text — it is raw HTML from an external
  // source, never rendered as markup (see stripHtml).
  bodyText: string | null
  period: string | null
  publishDate: string | null
  documents: Array<VascoCommunicationDoc>
}

type CommunicationNode = {
  id: string
  title?: string | null
  htmlContent?: string | null
  period?: string | null
  publishDate?: string | null
  issuer?: { id: string; label?: string | null } | null
  communicationDocuments?: Array<{
    id: string
    document?: {
      id: string
      name?: string | null
      contentType?: string | null
      createdAt?: string | null
      downloadUrl?: string | null
    } | null
  } | null> | null
}

type GetCommunicationsResult = {
  GetCommunications: Array<CommunicationNode | null> | null
}

/**
 * Strip HTML tags/entities to plain text. Communications carry `htmlContent` as
 * raw HTML from an external source, so we never render it as markup (the in-app
 * markdown renderer drops raw HTML anyway, and rendering it would be an XSS
 * vector). Block tags become newlines so the text keeps its paragraphs.
 */
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

function shapeCommunication(node: CommunicationNode): VascoCommunication {
  return {
    communicationId: node.id,
    issuerId: node.issuer?.id ?? '',
    issuerLabel: node.issuer?.label ?? null,
    title: node.title ?? null,
    bodyText: stripHtml(node.htmlContent),
    period: node.period ?? null,
    publishDate: node.publishDate ?? null,
    documents: (node.communicationDocuments ?? [])
      .filter(
        (d): d is NonNullable<typeof d> => d != null && d.document != null,
      )
      .map((d) => ({
        documentId: d.document!.id,
        name: d.document!.name ?? null,
        contentType: d.document!.contentType ?? null,
        createdAt: d.document!.createdAt ?? null,
      })),
  }
}

/** Log in and return ALL communications for the user (investor scope — the
 * `userId` scoping returns the full set; see KNOWN_ISSUES.md "VASCO API"). */
async function pullCommunications(
  creds: VascoCreds,
): Promise<Array<VascoCommunication>> {
  const { token, userId } = await vascoLogin(creds)
  const data = await vascoGraphql<GetCommunicationsResult>(
    creds.clientSlug,
    token,
    GET_COMMUNICATIONS,
    { userId },
  )
  return (data.GetCommunications ?? [])
    .filter((c): c is CommunicationNode => c != null)
    .map(shapeCommunication)
}

/** Active connections of `orgId` matching `clientSlug`. Org-member-guarded via
 * the caller's identity (propagated from the calling action). */
async function activeConnectionsForClient(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
  clientSlug: string,
): Promise<Array<Doc<'vascoConnections'>>> {
  const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
    internal.vasco.authorizeAndListConnections,
    { orgId },
  )
  return conns.filter((c) => c.clientSlug === clientSlug)
}

// ── Communications cache (stored, cron-refreshed) ───────────────────────────
//
// VASCO has no webhook for the investor persona (pull-only), and reading live
// on every UI open is slow (login + full GetCommunications). So we cache the
// communications in `vascoCommunicationsCache` and refresh on a cron (+ a manual
// button). The UI reads the cache via reactive queries (instant); freshness is
// bounded by the cron cadence. cf. KNOWN_ISSUES.md "VASCO API".

/** All active connections across every org — auth-less, for the cron. INTERNAL
 * ONLY (rows carry credentials). */
export const getAllActiveConnections = internalQuery({
  args: {},
  handler: async (ctx) => {
    const conns = await ctx.db.query('vascoConnections').collect()
    return conns.filter((c) => c.active)
  },
})

/** Atomically replace the cached communications of one (org, clientSlug): drop
 * the stale rows, insert the freshly pulled set. One transaction, so a reader
 * never sees a half-empty cache. */
export const replaceCommunicationsCache = internalMutation({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    communications: v.array(
      v.object({
        communicationId: v.string(),
        issuerId: v.string(),
        issuerLabel: v.union(v.string(), v.null()),
        title: v.union(v.string(), v.null()),
        bodyText: v.union(v.string(), v.null()),
        period: v.union(v.string(), v.null()),
        publishDate: v.union(v.string(), v.null()),
        documents: v.array(
          v.object({
            documentId: v.string(),
            name: v.union(v.string(), v.null()),
            contentType: v.union(v.string(), v.null()),
            createdAt: v.union(v.string(), v.null()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { orgId, clientSlug, communications }) => {
    const existing = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const row of existing) {
      if (row.clientSlug === clientSlug)
        await ctx.db.delete('vascoCommunicationsCache', row._id)
    }
    const fetchedAt = Date.now()
    for (const c of communications) {
      await ctx.db.insert('vascoCommunicationsCache', {
        orgId,
        clientSlug,
        issuerId: c.issuerId,
        communicationId: c.communicationId,
        issuerLabel: c.issuerLabel ?? undefined,
        title: c.title ?? undefined,
        bodyText: c.bodyText ?? undefined,
        period: c.period ?? undefined,
        publishDate: c.publishDate ?? undefined,
        documents: c.documents.map((d) => ({
          documentId: d.documentId,
          name: d.name ?? undefined,
          contentType: d.contentType ?? undefined,
          createdAt: d.createdAt ?? undefined,
        })),
        fetchedAt,
      })
    }
  },
})

/** Pull every active connection of `orgId` and refresh its cache. Best-effort
 * per client: if all of a client's connections fail to log in, the existing
 * cache is KEPT (not wiped). System-context safe (auth-less connection query),
 * so it serves both the cron and the manual "refresh". */
export const refreshVascoCacheForOrg = internalAction({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getActiveConnectionsByOrgId,
      { orgId },
    )
    // Group by client so a stale duplicate connection can't wipe a good cache.
    const byClient = new Map<string, Array<Doc<'vascoConnections'>>>()
    for (const conn of conns) {
      const list = byClient.get(conn.clientSlug) ?? []
      list.push(conn)
      byClient.set(conn.clientSlug, list)
    }
    for (const [clientSlug, clientConns] of byClient) {
      let communications: Array<VascoCommunication> | null = null
      for (const conn of clientConns) {
        try {
          communications = await pullCommunications(conn)
          break
        } catch (err) {
          console.warn(
            `[vasco] cache refresh pull failed for ${conn.clientSlug}:`,
            err instanceof Error ? err.message : String(err),
          )
        }
      }
      if (communications == null) continue // all failed → keep existing cache
      await ctx.runMutation(internal.vasco.replaceCommunicationsCache, {
        orgId,
        clientSlug,
        communications,
      })
    }
  },
})

/** Cron entry point: refresh the cache of every org that has an active VASCO
 * connection. */
export const refreshAllVascoCaches = internalAction({
  args: {},
  handler: async (ctx) => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getAllActiveConnections,
      {},
    )
    const orgIds = Array.from(new Set(conns.map((c) => c.orgId)))
    for (const orgId of orgIds) {
      await ctx.runAction(internal.vasco.refreshVascoCacheForOrg, { orgId })
    }
  },
})

/** Manual "refresh now" — org-member-guarded. Pulls Parallel live and updates
 * the cache; the reactive read queries then update on their own. */
export const refreshVascoCacheNow = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<{ refreshedAt: number }> => {
    // Guard: throws unless the caller is a member of the org.
    await ctx.runQuery(internal.vasco.authorizeAndListConnections, { orgId })
    await ctx.runAction(internal.vasco.refreshVascoCacheForOrg, { orgId })
    return { refreshedAt: Date.now() }
  },
})

/**
 * Distinct cached issuers (Parallel SPVs) for `orgId`, each annotated with its
 * most recent communication title so the entity↔issuer link is pickable (labels
 * alone are opaque "SPVn"). Reactive — reads the cache, no live call.
 * `lastFetchedAt` is null when the cache has never been filled (bootstrap hint).
 */
export const listCachedVascoIssuers = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const byKey = new Map<
      string,
      {
        clientSlug: string
        issuerId: string
        issuerLabel: string | null
        sampleTitle: string | null
        latest: string
      }
    >()
    let lastFetchedAt: number | null = null
    for (const r of rows) {
      lastFetchedAt =
        lastFetchedAt == null
          ? r.fetchedAt
          : Math.max(lastFetchedAt, r.fetchedAt)
      if (!r.issuerId) continue
      const key = `${r.clientSlug}:${r.issuerId}`
      const stamp = r.publishDate ?? r.period ?? ''
      const existing = byKey.get(key)
      if (!existing || stamp > existing.latest) {
        byKey.set(key, {
          clientSlug: r.clientSlug,
          issuerId: r.issuerId,
          issuerLabel: r.issuerLabel ?? null,
          sampleTitle: r.title ?? null,
          latest: stamp,
        })
      }
    }
    const issuers = Array.from(byKey.values())
      .sort((a, b) => (a.issuerLabel ?? '').localeCompare(b.issuerLabel ?? ''))
      .map((i) => ({
        clientSlug: i.clientSlug,
        issuerId: i.issuerId,
        issuerLabel: i.issuerLabel,
        sampleTitle: i.sampleTitle,
      }))
    return { issuers, lastFetchedAt }
  },
})

/**
 * Cached communications for one entity's linked issuer, date-desc. Reactive.
 * `lastFetchedAt` is the org-level cache stamp (null = never filled) so the UI
 * can distinguish "issuer has no communications" from "cache not yet built".
 */
export const getCachedCommunications = query({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (ctx, { orgId, clientSlug, issuerId }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const lastFetchedAt = rows.reduce<number | null>(
      (acc, r) => (acc == null ? r.fetchedAt : Math.max(acc, r.fetchedAt)),
      null,
    )
    const communications: Array<VascoCommunication> = rows
      .filter((r) => r.clientSlug === clientSlug && r.issuerId === issuerId)
      .map((r) => ({
        communicationId: r.communicationId,
        issuerId: r.issuerId,
        issuerLabel: r.issuerLabel ?? null,
        title: r.title ?? null,
        bodyText: r.bodyText ?? null,
        period: r.period ?? null,
        publishDate: r.publishDate ?? null,
        documents: r.documents.map((d) => ({
          documentId: d.documentId,
          name: d.name ?? null,
          contentType: d.contentType ?? null,
          createdAt: d.createdAt ?? null,
        })),
      }))
      .sort((a, b) => (b.publishDate ?? '').localeCompare(a.publishDate ?? ''))
    return { communications, lastFetchedAt }
  },
})

/**
 * Live issuer-scoped read for the AI-synthesis runner (`intelligence.runAnalysis`),
 * which runs in system context (no user identity → can't go through the
 * org-member-guarded path) and wants the freshest communications rather than the
 * cache. Resolves the org's active connections for `clientSlug` via the
 * auth-less internal query, logs in, and returns the issuer's communications
 * date-desc. Best-effort: returns `[]` if no connection logs in, so the
 * synthesis still runs on the company/report context alone.
 */
export const pullCommunicationsForSynthesis = internalAction({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
  },
  handler: async (
    ctx,
    { orgId, clientSlug, issuerId },
  ): Promise<Array<VascoCommunication>> => {
    const conns: Array<Doc<'vascoConnections'>> = await ctx.runQuery(
      internal.vasco.getActiveConnectionsByOrgId,
      { orgId },
    )
    const matching = conns.filter((c) => c.clientSlug === clientSlug)
    // Try each matching connection until one logs in (tolerates a stale dup).
    for (const conn of matching) {
      try {
        const all = await pullCommunications(conn)
        return all
          .filter((c) => c.issuerId === issuerId)
          .sort((a, b) =>
            (b.publishDate ?? '').localeCompare(a.publishDate ?? ''),
          )
      } catch (err) {
        console.warn(
          `[vasco] synthesis comms pull failed for ${conn.clientSlug}:`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
    return []
  },
})

/**
 * Download proxy for a communication's attached document. The VASCO
 * `downloadUrl` is an authenticated endpoint (not a public signed URL), so the
 * browser can't fetch it directly: this logs in, fetches the bytes with the
 * bearer token, stores them in Convex storage, and returns a short-lived URL
 * the browser can open. Org-member-guarded.
 */
export const downloadCommunicationDocument = action({
  args: {
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    documentId: v.string(),
  },
  handler: async (ctx, { orgId, clientSlug, documentId }) => {
    const conns = await activeConnectionsForClient(ctx, orgId, clientSlug)
    if (conns.length === 0) throw new ConvexError('vasco_no_connection')
    let lastError: string | null = null
    for (const conn of conns) {
      try {
        const { token } = await vascoLogin(conn)
        const res = await fetch(
          `${vascoBaseUrl(conn.clientSlug)}/documents/${documentId}/download`,
          { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } },
        )
        if (!res.ok) {
          lastError = `HTTP ${res.status}`
          continue
        }
        const blob = await res.blob()
        const storageId = await ctx.storage.store(blob)
        const url = await ctx.storage.getUrl(storageId)
        if (!url) {
          lastError = 'storage_url_null'
          continue
        }
        return { url }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    throw new ConvexError(`vasco_download_failed: ${lastError ?? 'unknown'}`)
  },
})
