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
 *
 * Platform module on the connections core: the connection rows live in the
 * generic `externalConnections` table (platform 'vasco'), managed by
 * `convex/connections.ts` (seed/remove/list/markConnected) and declared in
 * the registry `convex/lib/connectors.ts`. This module only holds the VASCO
 * pull logic and adapts the generic rows via `vascoCreds`.
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
import { getConnector, parseConnection } from './lib/connectors'
import type { GenericActionCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

type ActionCtx = GenericActionCtx<DataModel>

// ── Connection adapter (generic row → typed VASCO creds) ────────────────────

type VascoConnection = Doc<'externalConnections'>

type VascoCreds = { clientSlug: string; username: string; password: string }

/** Validated VASCO view of a generic connection row — throws a machine code
 * on a malformed row (missing clientSlug/username/password). */
function vascoCreds(conn: VascoConnection): VascoCreds {
  const { config, credentials } = parseConnection(getConnector('vasco'), conn)
  return {
    clientSlug: config.clientSlug,
    username: credentials.username,
    password: credentials.password,
  }
}

/** Non-throwing clientSlug read, for filtering/grouping rows (a malformed row
 * must not kill a listing — it fails later, loudly, at login time). */
function connClientSlug(conn: VascoConnection): string | null {
  return conn.config?.clientSlug ?? null
}

// ── HTTP / GraphQL helpers ──────────────────────────────────────────────────

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

/** Log in and read each connection, recording the outcome on the generic row
 * (connections core). Shared by the two read entry points (public action +
 * CLI internal action). */
async function runConnections(
  ctx: ActionCtx,
  conns: Array<VascoConnection>,
): Promise<Array<ConnectionResult>> {
  const results: Array<ConnectionResult> = []
  for (const conn of conns) {
    try {
      const accounts = await pullPositions(vascoCreds(conn))
      const totalInvestedCents = accounts.reduce(
        (s, a) => s + a.totalInvestedCents,
        0,
      )
      results.push({
        clientSlug: connClientSlug(conn) ?? '',
        label: conn.label,
        totalInvestedCents,
        accounts,
      })
      await ctx.runMutation(internal.connections.markConnected, {
        connectionId: conn._id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        clientSlug: connClientSlug(conn) ?? '',
        label: conn.label,
        totalInvestedCents: 0,
        accounts: [],
        error: message,
      })
      await ctx.runMutation(internal.connections.markConnected, {
        connectionId: conn._id,
        error: message,
      })
    }
  }
  return results
}

// Connection rows live in `externalConnections` (platform 'vasco') and are
// managed by the connections core — seeding/removal runbook in
// `convex/connections.ts` (`connections:seedConnection` /
// `connections:removeConnection`).

// ── Read actions ────────────────────────────────────────────────────────────

/**
 * For every active VASCO connection of `orgId`, log in and return the accounts
 * and their investments. Org-member-guarded. Read-only — this action writes
 * nothing; the instrument deal bridge is `backfillSpvInstruments` (CLI, below),
 * and valuations land in a later step.
 */
export const fetchParticipations = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.authorizeAndListActive,
      { orgId, platform: 'vasco' },
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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveByOrgSlug,
      { orgSlug, platform: 'vasco' },
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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveByOrgSlug,
      { orgSlug, platform: 'vasco' },
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
      // Raw reads (not the throwing adapter): a malformed row must still be
      // diagnosable, that is the whole point of this probe.
      const clientSlug = connClientSlug(conn) ?? ''
      const storedUsername = conn.credentials?.username ?? ''
      const storedPassword = conn.credentials?.password ?? ''
      const storedPasswordLen = storedPassword.length
      const storedPasswordSha12 = await sha256Hex12(storedPassword)
      try {
        const res = await fetch(`${vascoBaseUrl(clientSlug)}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            username: storedUsername,
            password: storedPassword,
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
          clientSlug,
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
          clientSlug,
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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveByOrgSlug,
      { orgSlug, platform: 'vasco' },
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
      const clientSlug = connClientSlug(conn) ?? ''
      try {
        const creds = vascoCreds(conn)
        const { token, userId } = await vascoLogin(creds)
        const userData = await vascoGraphql<GetUserResult>(
          creds.clientSlug,
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
          ...(await vascoGraphqlRaw(
            creds.clientSlug,
            token,
            GET_COMMUNICATIONS,
            { userId },
          )),
        })
        for (const acc of accounts) {
          probes.push({
            scope: `accountId=${acc.id} (${acc.label ?? acc.type})`,
            ...(await vascoGraphqlRaw(
              creds.clientSlug,
              token,
              GET_COMMUNICATIONS,
              { accountId: acc.id },
            )),
          })
        }
        connections.push({
          label: conn.label,
          clientSlug,
          userId,
          accounts,
          probes,
        })
      } catch (err) {
        connections.push({
          label: conn.label,
          clientSlug,
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
): Promise<Array<VascoConnection>> {
  const conns: Array<VascoConnection> = await ctx.runQuery(
    internal.connections.authorizeAndListActive,
    { orgId, platform: 'vasco' },
  )
  return conns.filter((c) => connClientSlug(c) === clientSlug)
}

// ── Communications cache (stored, cron-refreshed) ───────────────────────────
//
// VASCO has no webhook for the investor persona (pull-only), and reading live
// on every UI open is slow (login + full GetCommunications). So we cache the
// communications in `vascoCommunicationsCache` and refresh on a cron (+ a manual
// button). The UI reads the cache via reactive queries (instant); freshness is
// bounded by the cron cadence. cf. KNOWN_ISSUES.md "VASCO API".

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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveForOrg,
      { orgId, platform: 'vasco' },
    )
    // Group by client so a stale duplicate connection can't wipe a good cache.
    const byClient = new Map<string, Array<VascoConnection>>()
    for (const conn of conns) {
      const clientSlug = connClientSlug(conn)
      if (!clientSlug) continue // malformed row — fails loudly at login time
      const list = byClient.get(clientSlug) ?? []
      list.push(conn)
      byClient.set(clientSlug, list)
    }
    for (const [clientSlug, clientConns] of byClient) {
      let communications: Array<VascoCommunication> | null = null
      for (const conn of clientConns) {
        try {
          communications = await pullCommunications(vascoCreds(conn))
          break
        } catch (err) {
          console.warn(
            `[vasco] cache refresh pull failed for ${clientSlug}:`,
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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listAllActive,
      { platform: 'vasco' },
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
    await ctx.runQuery(internal.connections.authorizeAndListActive, {
      orgId,
      platform: 'vasco',
    })
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
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveForOrg,
      { orgId, platform: 'vasco' },
    )
    const matching = conns.filter((c) => connClientSlug(c) === clientSlug)
    // Try each matching connection until one logs in (tolerates a stale dup).
    for (const conn of matching) {
      try {
        const all = await pullCommunications(vascoCreds(conn))
        return all
          .filter((c) => c.issuerId === issuerId)
          .sort((a, b) =>
            (b.publishDate ?? '').localeCompare(a.publishDate ?? ''),
          )
      } catch (err) {
        console.warn(
          `[vasco] synthesis comms pull failed for ${clientSlug}:`,
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
        const creds = vascoCreds(conn)
        const { token } = await vascoLogin(creds)
        const res = await fetch(
          `${vascoBaseUrl(creds.clientSlug)}/documents/${documentId}/download`,
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

// ── Instrument bridge (Parallel positions → SPV deal fiche) ──────────────────
//
// Fills the SPV deal fiche's instrument block from the investor-side Parallel
// positions (`pullPositions`). Conservative by design — see KNOWN_ISSUES.md
// "VASCO API → instrument bridge":
//   - a position is matched to a deal by the SPV NUMBER token ("SPVn") shared
//     by the Parallel vehicle/security name and the target company name, never
//     by free-text name (labels are opaque). No number on either side → the row
//     is reported for manual mapping, never guessed;
//   - it writes ONLY the three fields Parallel fills unambiguously and that the
//     deal fiche actually displays: `paidAmount` (investedCents — cents, like
//     us), `spvName` (vehicleName), `closingDate` (effectiveDate). Parallel's
//     `securitiesNumber` / `priceBySecurity` / `capitalCallPercentage` have no
//     display home for the equity/spv_share archetype and carry unconfirmed
//     units, so they are REPORTED (`extraVascoData`), never written;
//   - fill-empty-only: a populated field that disagrees with Parallel is
//     surfaced as a discrepancy, never overwritten;
//   - it never touches `instrumentKind` (most SPV deals are typed `os`/`share`;
//     the os→spv_share requalification is a separate human decision — reported
//     via `needsRequalification`).
// `dryRun` defaults to true: nothing is written and the full proposal returns.

/** SPV number token shared by Parallel vehicle/security names and the SPV
 * target company names ("…SPV13…" → 13). null when absent (e.g. "SPV YOUSE") →
 * the row is reported for manual mapping, never guessed. */
function spvNumberOf(name: string | null | undefined): number | null {
  if (!name) return null
  const m = /\bspv\s*0*(\d+)\b/i.exec(name)
  return m ? Number(m[1]) : null
}

type BridgeDeal = {
  dealId: Id<'deals'>
  targetName: string
  instrumentKind: string
  status: string
  paidAmount: number | null
  committedAmount: number | null
  spvName: string | null
  closingDate: number | null
}

/** The org's SPV deals (target named "PARALLEL INVEST SPVn"), with just the
 * columns the bridge compares. Auth-less, keyed by slug — CLI internal only. */
export const getSpvDealsForBridge = internalQuery({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }): Promise<{ deals: Array<BridgeDeal> }> => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const out: Array<BridgeDeal> = []
    for (const deal of deals) {
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      if (!target || !/parallel\s*invest\s*spv/i.test(target.name)) continue
      out.push({
        dealId: deal._id,
        targetName: target.name,
        instrumentKind: deal.instrumentKind,
        status: deal.status,
        paidAmount: deal.paidAmount ?? null,
        committedAmount: deal.committedAmount ?? null,
        spvName: deal.spvName ?? null,
        closingDate: deal.closingDate ?? null,
      })
    }
    return { deals: out }
  },
})

/** Patch one deal with the bridge-allowed fields, recording them in
 * `manuallyEditedFields` so the Airtable re-import (deals.upsertDeals) treats
 * Parallel as authoritative and never clobbers them (same convention as
 * deals.update). CLI internal only. */
export const applyInstrumentBridgePatch = internalMutation({
  args: {
    dealId: v.id('deals'),
    patch: v.object({
      paidAmount: v.optional(v.number()),
      spvName: v.optional(v.string()),
      closingDate: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { dealId, patch }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    const editedFields = new Set(deal.manuallyEditedFields ?? [])
    for (const key of Object.keys(patch)) editedFields.add(key)
    await ctx.db.patch('deals', dealId, {
      ...patch,
      manuallyEditedFields: [...editedFields],
    })
    return dealId
  },
})

type ExtraVascoData = {
  securityName: string | null
  vehicleName: string | null
  investedCents: number | null
  currency: string | null
  securitiesNumber: number | null
  priceBySecurity: number | null
  capitalCallPercentage: number | null
  effectiveDate: string | null
}

type FieldFill = { field: string; to: number | string; note?: string }
type FieldDiff = {
  field: string
  current: number | string
  vasco: number | string
  note?: string
}
type BridgeProposal = {
  spvNo: number
  dealId: Id<'deals'>
  targetName: string
  instrumentKind: string
  needsRequalification: boolean
  fills: Array<FieldFill>
  discrepancies: Array<FieldDiff>
  extraVascoData: ExtraVascoData
}

type BridgePosition = VascoInvestment & { clientSlug: string }

/** Explicit result type — annotated on the action handler to break the
 * self-reference inference cycle (the handler calls `internal.vasco.*` from
 * inside this same module; see CLAUDE.md "TS inference cycle"). */
type BridgeResult = {
  orgSlug: string
  dryRun: boolean
  summary: {
    positions: number
    spvDeals: number
    matched: number
    wouldFill: number
    applied: number
    withDiscrepancies: number
    needingRequalification: number
    positionsWithoutDeal: number
    dealsWithoutPosition: number
    ambiguous: number
    positionsNoNumber: number
    dealsNoNumber: number
  }
  proposals: Array<BridgeProposal>
  positionsWithoutDeal: Array<{
    spvNo: number
    positions: Array<ExtraVascoData>
  }>
  dealsWithoutPosition: Array<{
    spvNo: number
    dealId: Id<'deals'>
    targetName: string
    instrumentKind: string
  }>
  ambiguous: Array<{ spvNo: number; positions: number; deals: number }>
  positionsNoNumber: Array<ExtraVascoData>
  dealsNoNumber: Array<{ dealId: Id<'deals'>; targetName: string }>
  pullErrors: Array<{ clientSlug: string; error: string }>
}

function shapeExtra(p: VascoInvestment): ExtraVascoData {
  return {
    securityName: p.securityName,
    vehicleName: p.vehicleName,
    investedCents: p.investedCents,
    currency: p.currency,
    securitiesNumber: p.securitiesNumber,
    priceBySecurity: p.priceBySecurity,
    capitalCallPercentage: p.capitalCallPercentage,
    effectiveDate: p.effectiveDate,
  }
}

/** Build the fill/discrepancy proposal for one clean 1:1 position↔deal pair. */
function buildProposal(
  spvNo: number,
  deal: BridgeDeal,
  pos: BridgePosition,
): BridgeProposal {
  const fills: Array<FieldFill> = []
  const discrepancies: Array<FieldDiff> = []

  // paidAmount ← investedCents (both cents). Fill if empty; else reconcile.
  if (pos.investedCents != null) {
    if (deal.paidAmount == null)
      fills.push({ field: 'paidAmount', to: pos.investedCents })
    else if (deal.paidAmount !== pos.investedCents)
      discrepancies.push({
        field: 'paidAmount',
        current: deal.paidAmount,
        vasco: pos.investedCents,
      })
  }

  // spvName ← vehicleName. Fill if empty; else reconcile.
  if (pos.vehicleName) {
    if (!deal.spvName) fills.push({ field: 'spvName', to: pos.vehicleName })
    else if (deal.spvName !== pos.vehicleName)
      discrepancies.push({
        field: 'spvName',
        current: deal.spvName,
        vasco: pos.vehicleName,
      })
  }

  // closingDate ← effectiveDate (ISO → ms UTC). Fill if empty; else reconcile.
  const eff = pos.effectiveDate ? Date.parse(pos.effectiveDate) : NaN
  if (!Number.isNaN(eff)) {
    if (deal.closingDate == null)
      fills.push({
        field: 'closingDate',
        to: eff,
        note: pos.effectiveDate ?? undefined,
      })
    else if (deal.closingDate !== eff)
      discrepancies.push({
        field: 'closingDate',
        current: deal.closingDate,
        vasco: eff,
        note: pos.effectiveDate ?? undefined,
      })
  }

  return {
    spvNo,
    dealId: deal.dealId,
    targetName: deal.targetName,
    instrumentKind: deal.instrumentKind,
    needsRequalification: deal.instrumentKind !== 'spv_share',
    fills,
    discrepancies,
    extraVascoData: shapeExtra(pos),
  }
}

/**
 * Reconcile Parallel positions against the org's SPV deals and (optionally)
 * fill the empty instrument fields. Read side is org-agnostic (CLI, auth-less
 * by slug), write side goes through `applyInstrumentBridgePatch`.
 *   # dry-run (default) — writes nothing, returns the full proposal:
 *   npx convex run --prod vasco:backfillSpvInstruments '{"orgSlug":"calte"}'
 *   # apply the empty-field fills:
 *   npx convex run --prod vasco:backfillSpvInstruments '{"orgSlug":"calte","dryRun":false}'
 */
export const backfillSpvInstruments = internalAction({
  args: { orgSlug: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { orgSlug, dryRun = true }): Promise<BridgeResult> => {
    // 1. Pull Parallel positions across the org's active connections.
    const conns: Array<VascoConnection> = await ctx.runQuery(
      internal.connections.listActiveByOrgSlug,
      { orgSlug, platform: 'vasco' },
    )
    const positions: Array<BridgePosition> = []
    const pullErrors: Array<{ clientSlug: string; error: string }> = []
    for (const conn of conns) {
      const clientSlug = connClientSlug(conn) ?? ''
      try {
        const accounts = await pullPositions(vascoCreds(conn))
        for (const acc of accounts)
          for (const inv of acc.investments)
            positions.push({ ...inv, clientSlug })
      } catch (err) {
        pullErrors.push({
          clientSlug,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 2. Load the org's SPV deals.
    const { deals }: { deals: Array<BridgeDeal> } = await ctx.runQuery(
      internal.vasco.getSpvDealsForBridge,
      { orgSlug },
    )

    // 3. Index both sides by SPV number; anything without a number is reported.
    const posByNo = new Map<number, Array<BridgePosition>>()
    const positionsNoNumber: Array<ExtraVascoData> = []
    for (const p of positions) {
      const no = spvNumberOf(p.vehicleName) ?? spvNumberOf(p.securityName)
      if (no == null) {
        positionsNoNumber.push(shapeExtra(p))
        continue
      }
      const arr = posByNo.get(no) ?? []
      arr.push(p)
      posByNo.set(no, arr)
    }
    const dealsByNo = new Map<number, Array<BridgeDeal>>()
    const dealsNoNumber: Array<{ dealId: Id<'deals'>; targetName: string }> = []
    for (const d of deals) {
      const no = spvNumberOf(d.targetName)
      if (no == null) {
        dealsNoNumber.push({ dealId: d.dealId, targetName: d.targetName })
        continue
      }
      const arr = dealsByNo.get(no) ?? []
      arr.push(d)
      dealsByNo.set(no, arr)
    }

    // 4. Reconcile per SPV number.
    const proposals: Array<BridgeProposal> = []
    const ambiguous: Array<{ spvNo: number; positions: number; deals: number }> =
      []
    const positionsWithoutDeal: Array<{
      spvNo: number
      positions: Array<ExtraVascoData>
    }> = []
    const dealsWithoutPosition: Array<{
      spvNo: number
      dealId: Id<'deals'>
      targetName: string
      instrumentKind: string
    }> = []
    const allNos = new Set<number>([...posByNo.keys(), ...dealsByNo.keys()])
    for (const no of [...allNos].sort((a, b) => a - b)) {
      const ps = posByNo.get(no) ?? []
      const ds = dealsByNo.get(no) ?? []
      if (ps.length && !ds.length) {
        positionsWithoutDeal.push({ spvNo: no, positions: ps.map(shapeExtra) })
        continue
      }
      if (ds.length && !ps.length) {
        for (const d of ds)
          dealsWithoutPosition.push({
            spvNo: no,
            dealId: d.dealId,
            targetName: d.targetName,
            instrumentKind: d.instrumentKind,
          })
        continue
      }
      // Ambiguous (a follow-on deal, or an SPV holding several securities) →
      // reported, never auto-written.
      if (ps.length > 1 || ds.length > 1) {
        ambiguous.push({ spvNo: no, positions: ps.length, deals: ds.length })
        continue
      }
      proposals.push(buildProposal(no, ds[0], ps[0]))
    }

    // 5. Apply the empty-field fills unless dry-run.
    let applied = 0
    if (!dryRun) {
      for (const prop of proposals) {
        if (!prop.fills.length) continue
        const patch: {
          paidAmount?: number
          spvName?: string
          closingDate?: number
        } = {}
        for (const f of prop.fills) {
          if (f.field === 'paidAmount') patch.paidAmount = f.to as number
          else if (f.field === 'spvName') patch.spvName = f.to as string
          else if (f.field === 'closingDate') patch.closingDate = f.to as number
        }
        await ctx.runMutation(internal.vasco.applyInstrumentBridgePatch, {
          dealId: prop.dealId,
          patch,
        })
        applied++
      }
    }

    return {
      orgSlug,
      dryRun,
      summary: {
        positions: positions.length,
        spvDeals: deals.length,
        matched: proposals.length,
        wouldFill: proposals.filter((p) => p.fills.length).length,
        applied: dryRun ? 0 : applied,
        withDiscrepancies: proposals.filter((p) => p.discrepancies.length).length,
        needingRequalification: proposals.filter((p) => p.needsRequalification)
          .length,
        positionsWithoutDeal: positionsWithoutDeal.length,
        dealsWithoutPosition: dealsWithoutPosition.length,
        ambiguous: ambiguous.length,
        positionsNoNumber: positionsNoNumber.length,
        dealsNoNumber: dealsNoNumber.length,
      },
      proposals,
      positionsWithoutDeal,
      dealsWithoutPosition,
      ambiguous,
      positionsNoNumber,
      dealsNoNumber,
      pullErrors,
    }
  },
})
