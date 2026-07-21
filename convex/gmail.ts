/**
 * Gmail connector — portfolio email timeline.
 *
 * Direct Google OAuth (no aggregator), modeled on Twenty CRM's messaging
 * sync (github.com/twentyhq/twenty, modules/messaging):
 * - one `gmailAccounts` row per connected mailbox, `historyId` as the
 *   incremental sync cursor (users.history.list), reset on expiry;
 * - a ~10 min polling cron (no Pub/Sub push — internal tool, 5 mailboxes);
 * - messages deduplicated across mailboxes by the RFC `Message-ID` header;
 * - DETERMINISTIC matching: a message is linked to every active portfolio
 *   company whose `domain` appears among the participants' email domains
 *   (freemail + connected-mailbox domains excluded, fully-internal mail
 *   skipped). No LLM. Only matched messages are stored.
 *
 * Report extraction is NOT wired here (étape 2): the AgentMail pipeline
 * keeps handling forwarded reports (and attachments, which Gmail sync does
 * not store).
 *
 * Security: `refreshToken` is secret at rest — every account listing here is
 * internal; the public `listAccounts` is sanitized (same rule as
 * `powensUsers`). OAuth `state` rows are one-shot and expire after 15 min.
 */

import { ConvexError, v } from 'convex/values'
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import { requireAppUser, requireOrgMember } from './lib/auth'
import type { ActionCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000
const MAX_BODY_CHARS = 50_000
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

// Freemail domains never identify a participation (same spirit as the
// report pipeline's IGNORED_DOMAINS — kept local: the sets differ, e.g.
// alboteam.com is excluded here dynamically as a connected-mailbox domain).
const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
])

function gmailEnv() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const convexSiteUrl = process.env.CONVEX_SITE_URL
  if (!clientId || !clientSecret || !convexSiteUrl) {
    throw new ConvexError('gmail_env_missing')
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${convexSiteUrl}/gmail/oauth/callback`,
  }
}

// ── OAuth flow ──────────────────────────────────────────────────────────────

/**
 * Build the Google authorize URL for the caller and store the one-shot
 * anti-CSRF `state`. The front end redirects the browser to the returned URL;
 * Google calls back on /gmail/oauth/callback (convex/http.ts).
 */
export const startConnect = mutation({
  args: { returnTo: v.string() },
  handler: async (ctx, { returnTo }) => {
    const user = await requireAppUser(ctx)
    // Only an in-app path may be used as the post-callback landing target.
    if (!returnTo.startsWith('/')) throw new ConvexError('invalid_return_to')
    const { clientId, redirectUri } = gmailEnv()

    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    await ctx.db.insert('gmailOAuthStates', {
      userId: user._id,
      state,
      returnTo,
      createdAt: Date.now(),
    })

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GMAIL_SCOPE)
    // offline + consent → Google returns a refresh token on every connect.
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', state)
    return { authorizeUrl: url.toString() }
  },
})

/** Consume (validate + delete) an OAuth state token. One-shot by design. */
export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query('gmailOAuthStates')
      .withIndex('by_state', (q) => q.eq('state', state))
      .unique()
    if (!row) return null
    await ctx.db.delete('gmailOAuthStates', row._id)
    if (Date.now() - row.createdAt > OAUTH_STATE_TTL_MS) return null
    return { userId: row.userId, returnTo: row.returnTo }
  },
})

/** Upsert a connected mailbox after a successful token exchange. On a
 * reconnect the existing sync cursor is KEPT (a stale cursor is handled by
 * the expiry fallback in the sync), so no window of mail is silently lost. */
export const saveAccount = internalMutation({
  args: {
    userId: v.id('users'),
    email: v.string(),
    refreshToken: v.string(),
    initialHistoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase()
    const existing = await ctx.db
      .query('gmailAccounts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()
    if (existing) {
      await ctx.db.patch('gmailAccounts', existing._id, {
        refreshToken: args.refreshToken,
        status: 'connected',
        lastError: undefined,
        historyId: existing.historyId ?? args.initialHistoryId,
      })
      return existing._id
    }
    return ctx.db.insert('gmailAccounts', {
      userId: args.userId,
      email,
      refreshToken: args.refreshToken,
      historyId: args.initialHistoryId,
      status: 'connected',
      createdAt: Date.now(),
    })
  },
})

/**
 * GET /gmail/oauth/callback — Google redirects here with `code` + `state`.
 * Exchanges the code, resolves the mailbox address, stores the account and
 * bounces the browser back into the app. Secrets never appear in the
 * redirect URL or in error messages.
 */
export const gmailOauthCallback = httpAction(async (ctx, req) => {
  const url = new URL(req.url)
  const siteUrl = process.env.SITE_URL ?? ''
  const state = url.searchParams.get('state') ?? ''
  const stateRow = state
    ? await ctx.runMutation(internal.gmail.consumeOAuthState, { state })
    : null
  const fallback = `${siteUrl}/app`
  const landing = (outcome: 'connected' | 'error') => {
    const path = stateRow?.returnTo ?? '/app'
    return Response.redirect(`${siteUrl}${path}?gmail=${outcome}`, 302)
  }
  if (!stateRow) return Response.redirect(`${fallback}?gmail=error`, 302)

  const code = url.searchParams.get('code')
  if (!code || url.searchParams.get('error')) return landing('error')

  try {
    const { clientId, clientSecret, redirectUri } = gmailEnv()
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return landing('error')
    const tokens = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
    }
    if (!tokens.access_token || !tokens.refresh_token) return landing('error')

    const profileRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    )
    if (!profileRes.ok) return landing('error')
    const profile = (await profileRes.json()) as {
      emailAddress?: string
      historyId?: string
    }
    if (!profile.emailAddress || !profile.historyId) return landing('error')

    await ctx.runMutation(internal.gmail.saveAccount, {
      userId: stateRow.userId,
      email: profile.emailAddress,
      refreshToken: tokens.refresh_token,
      initialHistoryId: profile.historyId,
    })
    return landing('connected')
  } catch {
    return landing('error')
  }
})

// ── Account lifecycle ───────────────────────────────────────────────────────

/** Sanitized mailbox list for the Intégrations page — never the token. */
export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    await requireAppUser(ctx)
    const rows = await ctx.db.query('gmailAccounts').take(50)
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      status: r.status,
      lastError: r.lastError ?? null,
      lastSyncAt: r.lastSyncAt ?? null,
    }))
  },
})

export const getAccountInternal = internalQuery({
  args: { accountId: v.id('gmailAccounts') },
  handler: async (ctx, { accountId }) => ctx.db.get('gmailAccounts', accountId),
})

export const listAccountsInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('gmailAccounts').take(50),
})

export const deleteAccountInternal = internalMutation({
  args: { accountId: v.id('gmailAccounts') },
  handler: async (ctx, { accountId }) => {
    await ctx.db.delete('gmailAccounts', accountId)
  },
})

export const patchAccountInternal = internalMutation({
  args: {
    accountId: v.id('gmailAccounts'),
    historyId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('connected'),
        v.literal('reauth_required'),
        v.literal('error'),
      ),
    ),
    lastError: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    clearLastError: v.optional(v.boolean()),
  },
  handler: async (ctx, { accountId, clearLastError, ...patch }) => {
    await ctx.db.patch('gmailAccounts', accountId, {
      ...patch,
      ...(clearLastError ? { lastError: undefined } : {}),
    })
  },
})

/** Disconnect a mailbox: best-effort token revocation on Google's side, then
 * forget the account row. Already-imported timeline emails stay. */
export const disconnect = mutation({
  args: { accountId: v.id('gmailAccounts') },
  handler: async (ctx, { accountId }) => {
    await requireAppUser(ctx)
    const account = await ctx.db.get('gmailAccounts', accountId)
    if (!account) throw new ConvexError('not_found')
    await ctx.db.delete('gmailAccounts', accountId)
    // Revocation needs fetch → schedule it after the transaction commits.
    await ctx.scheduler.runAfter(0, internal.gmail.revokeToken, {
      refreshToken: account.refreshToken,
    })
  },
})

export const revokeToken = internalAction({
  args: { refreshToken: v.string() },
  handler: async (_ctx, { refreshToken }) => {
    // Best-effort: a failed revocation only leaves a dangling grant the user
    // can clear from their Google account settings.
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => {})
  },
})

// ── Sync (cron) ─────────────────────────────────────────────────────────────

type GmailHeader = { name?: string; value?: string }
type GmailPart = {
  mimeType?: string
  body?: { data?: string }
  parts?: Array<GmailPart>
}
type GmailMessage = {
  id: string
  threadId?: string
  labelIds?: Array<string>
  snippet?: string
  internalDate?: string
  payload?: GmailPart & { headers?: Array<GmailHeader> }
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

/** Depth-first lookup of the first body part of a given MIME type. */
function findPart(part: GmailPart | undefined, mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) return part.body.data
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return null
}

/** Minimal HTML → text fallback when a message has no text/plain part. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractBodyText(message: GmailMessage): string | null {
  const plain = findPart(message.payload, 'text/plain')
  if (plain) return decodeBase64Url(plain).slice(0, MAX_BODY_CHARS)
  const html = findPart(message.payload, 'text/html')
  if (html) return htmlToText(decodeBase64Url(html)).slice(0, MAX_BODY_CHARS)
  return null
}

function header(message: GmailMessage, name: string): string | null {
  const h = (message.payload?.headers ?? []).find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  )
  return h?.value ?? null
}

/** Parse an address-list header ("A <a@x.com>, b@y.io") into lowercase
 * addresses. Display names may contain commas inside quotes — good enough
 * here: we only keep the token that looks like an address. */
function parseAddresses(raw: string | null): Array<string> {
  if (!raw) return []
  const matches = raw.match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []
  return [...new Set(matches.map((a) => a.toLowerCase()))]
}

function parseFromName(raw: string | null): string | null {
  if (!raw) return null
  const name = raw.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim()
  return name && !name.includes('@') ? name : null
}

async function refreshAccessToken(refreshToken: string): Promise<
  { ok: true; accessToken: string } | { ok: false; reauth: boolean; detail: string }
> {
  const { clientId, clientSecret } = gmailEnv()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // invalid_grant = revoked or expired grant (e.g. the 7-day expiry of a
    // testing-mode OAuth app) → the mailbox must be reconnected.
    return {
      ok: false,
      reauth: body.includes('invalid_grant'),
      detail: `token_refresh_failed:${res.status}`,
    }
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    return { ok: false, reauth: false, detail: 'token_refresh_malformed' }
  }
  return { ok: true, accessToken: json.access_token }
}

/** Poll every connected mailbox — cron entry point (cf. convex/crons.ts). */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts: Array<Doc<'gmailAccounts'>> = await ctx.runQuery(
      internal.gmail.listAccountsInternal,
      {},
    )
    for (const account of accounts) {
      try {
        await syncAccount(ctx, account)
      } catch (err) {
        await ctx.runMutation(internal.gmail.patchAccountInternal, {
          accountId: account._id,
          status: 'error',
          lastError: err instanceof Error ? err.message.slice(0, 200) : 'sync_failed',
        })
      }
    }
  },
})

type SyncCtx = ActionCtx

async function gmailGet(accessToken: string, path: string): Promise<Response> {
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

async function syncAccount(ctx: SyncCtx, account: Doc<'gmailAccounts'>) {
  const token = await refreshAccessToken(account.refreshToken)
  if (!token.ok) {
    await ctx.runMutation(internal.gmail.patchAccountInternal, {
      accountId: account._id,
      status: token.reauth ? 'reauth_required' : 'error',
      lastError: token.detail,
    })
    return
  }
  const { accessToken } = token

  // No cursor (legacy row) → anchor at "now" and start from the next run.
  if (!account.historyId) {
    const profileRes = await gmailGet(accessToken, 'profile')
    if (!profileRes.ok) throw new Error(`profile_failed:${profileRes.status}`)
    const profile = (await profileRes.json()) as { historyId?: string }
    await ctx.runMutation(internal.gmail.patchAccountInternal, {
      accountId: account._id,
      historyId: profile.historyId,
      status: 'connected',
      lastSyncAt: Date.now(),
      clearLastError: true,
    })
    return
  }

  // Incremental change list since the cursor (messageAdded only).
  const messageIds = new Set<string>()
  let newCursor: string | null = null
  let pageToken: string | null = null
  do {
    const params = new URLSearchParams({
      startHistoryId: account.historyId,
      historyTypes: 'messageAdded',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await gmailGet(accessToken, `history?${params}`)
    if (res.status === 404) {
      // Cursor expired (Gmail keeps ~1 week of history) → re-anchor at the
      // profile's current historyId. The gap is left to the backfill step.
      const profileRes = await gmailGet(accessToken, 'profile')
      const profile = profileRes.ok
        ? ((await profileRes.json()) as { historyId?: string })
        : {}
      await ctx.runMutation(internal.gmail.patchAccountInternal, {
        accountId: account._id,
        historyId: profile.historyId ?? account.historyId,
        status: 'connected',
        lastError: 'history_cursor_expired',
        lastSyncAt: Date.now(),
      })
      return
    }
    if (!res.ok) throw new Error(`history_failed:${res.status}`)
    const json = (await res.json()) as {
      historyId?: string
      nextPageToken?: string
      history?: Array<{
        messagesAdded?: Array<{ message?: { id?: string } }>
      }>
    }
    for (const h of json.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) messageIds.add(m.message.id)
      }
    }
    newCursor = json.historyId ?? newCursor
    pageToken = json.nextPageToken ?? null
  } while (pageToken)

  for (const id of messageIds) {
    const res = await gmailGet(accessToken, `messages/${id}?format=full`)
    // A message can vanish between history and fetch (deleted) — skip.
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`message_failed:${res.status}`)
    const message = (await res.json()) as GmailMessage
    const labels = new Set(message.labelIds ?? [])
    if (labels.has('DRAFT') || labels.has('SPAM') || labels.has('TRASH')) continue

    const headerMessageId = header(message, 'Message-ID')
    if (!headerMessageId) continue
    const fromEmail = parseAddresses(header(message, 'From'))[0]
    if (!fromEmail) continue

    await ctx.runMutation(internal.gmail.storeMessage, {
      accountEmail: account.email,
      headerMessageId,
      gmailThreadId: message.threadId,
      subject: header(message, 'Subject') ?? '',
      snippet: message.snippet,
      bodyText: extractBodyText(message) ?? undefined,
      fromEmail,
      fromName: parseFromName(header(message, 'From')) ?? undefined,
      toEmails: parseAddresses(header(message, 'To')),
      ccEmails: parseAddresses(header(message, 'Cc')),
      sentAt: Number(message.internalDate ?? Date.now()),
    })
  }

  await ctx.runMutation(internal.gmail.patchAccountInternal, {
    accountId: account._id,
    ...(newCursor ? { historyId: newCursor } : {}),
    status: 'connected',
    lastSyncAt: Date.now(),
    clearLastError: true,
  })
}

// ── Matching + storage ──────────────────────────────────────────────────────

function domainOf(email: string): string | null {
  return email.split('@')[1]?.toLowerCase() ?? null
}

/**
 * Match one parsed message against the portfolio and store it if it matches.
 * Transactional and idempotent: dedup by `headerMessageId`, a replay only
 * merges the mailbox into `accountEmails` / adds missing links.
 */
export const storeMessage = internalMutation({
  args: {
    accountEmail: v.string(),
    headerMessageId: v.string(),
    gmailThreadId: v.optional(v.string()),
    subject: v.string(),
    snippet: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmails: v.array(v.string()),
    ccEmails: v.array(v.string()),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    const participants = [
      ...new Set([args.fromEmail, ...args.toEmails, ...args.ccEmails]),
    ]
    const accountDomain = domainOf(args.accountEmail)
    const participantDomains = [
      ...new Set(
        participants
          .map((p) => domainOf(p))
          .filter((d): d is string => d !== null),
      ),
    ]

    // Fully-internal mail (all participants on the mailbox's own domain)
    // never belongs to the portfolio timeline (Twenty's rule).
    if (participantDomains.every((d) => d === accountDomain)) return null

    // Candidate domains: participants minus freemail minus every connected
    // mailbox's own domain (a mailbox domain matching a portfolio company
    // would flood the timeline with that company's internal traffic).
    const accounts = await ctx.db.query('gmailAccounts').take(50)
    const mailboxDomains = new Set(
      accounts
        .map((a) => domainOf(a.email))
        .filter((d): d is string => d !== null),
    )
    const candidateDomains = participantDomains.filter(
      (d) => !FREEMAIL_DOMAINS.has(d) && !mailboxDomains.has(d),
    )
    if (candidateDomains.length === 0) return null

    // Portfolio lookup across every org (multi-org fan-out, like the report
    // pipeline: the same participation may exist in several orgs).
    const orgs = await ctx.db.query('organizations').collect()
    const matches: Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }> = []
    for (const org of orgs) {
      for (const domain of candidateDomains) {
        const companies = await ctx.db
          .query('companies')
          .withIndex('by_org_domain', (q) =>
            q.eq('orgId', org._id).eq('domain', domain),
          )
          .collect()
        for (const company of companies) {
          if (company.kind !== 'portfolio' || company.archivedAt) continue
          matches.push({ companyId: company._id, orgId: org._id })
        }
      }
    }
    if (matches.length === 0) return null

    const direction =
      args.fromEmail === args.accountEmail.toLowerCase()
        ? ('outgoing' as const)
        : ('incoming' as const)

    // Dedup across mailboxes by Message-ID (Twenty's design).
    const existing = await ctx.db
      .query('companyEmails')
      .withIndex('by_header_message_id', (q) =>
        q.eq('headerMessageId', args.headerMessageId),
      )
      .unique()

    let emailId: Id<'companyEmails'>
    if (existing) {
      emailId = existing._id
      if (!existing.accountEmails.includes(args.accountEmail)) {
        await ctx.db.patch('companyEmails', existing._id, {
          accountEmails: [...existing.accountEmails, args.accountEmail],
        })
      }
    } else {
      emailId = await ctx.db.insert('companyEmails', {
        headerMessageId: args.headerMessageId,
        gmailThreadId: args.gmailThreadId,
        subject: args.subject,
        snippet: args.snippet,
        bodyText: args.bodyText,
        fromEmail: args.fromEmail,
        fromName: args.fromName,
        toEmails: args.toEmails,
        ccEmails: args.ccEmails,
        sentAt: args.sentAt,
        direction,
        accountEmails: [args.accountEmail],
      })
    }

    const existingLinks = await ctx.db
      .query('companyEmailLinks')
      .withIndex('by_email', (q) => q.eq('emailId', emailId))
      .collect()
    const linked = new Set(existingLinks.map((l) => l.companyId))
    for (const match of matches) {
      if (linked.has(match.companyId)) continue
      linked.add(match.companyId)
      await ctx.db.insert('companyEmailLinks', {
        companyId: match.companyId,
        orgId: match.orgId,
        emailId,
        sentAt: args.sentAt,
      })
    }
    return emailId
  },
})

// ── Timeline reads (org-guarded) ────────────────────────────────────────────

/** A company's email timeline, most recent first (light fields). */
export const listByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const links = await ctx.db
      .query('companyEmailLinks')
      .withIndex('by_company_and_sentAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(200)

    const out = []
    for (const link of links) {
      const email = await ctx.db.get('companyEmails', link.emailId)
      if (!email) continue
      out.push({
        _id: email._id,
        subject: email.subject,
        snippet: email.snippet ?? null,
        fromEmail: email.fromEmail,
        fromName: email.fromName ?? null,
        sentAt: email.sentAt,
        direction: email.direction,
      })
    }
    return out
  },
})

/** Full content of one timeline email (detail dialog). Authorized when the
 * caller is a member of at least one org the email is linked to. */
export const getById = query({
  args: { emailId: v.id('companyEmails') },
  handler: async (ctx, { emailId }) => {
    const user = await requireAppUser(ctx)
    const email = await ctx.db.get('companyEmails', emailId)
    if (!email) throw new ConvexError('not_found')

    const links = await ctx.db
      .query('companyEmailLinks')
      .withIndex('by_email', (q) => q.eq('emailId', emailId))
      .collect()
    const memberships = await ctx.db
      .query('organizationMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    const memberOrgIds = new Set(memberships.map((m) => m.orgId))
    if (!links.some((l) => memberOrgIds.has(l.orgId))) {
      throw new ConvexError('forbidden')
    }

    return {
      _id: email._id,
      subject: email.subject,
      bodyText: email.bodyText ?? null,
      fromEmail: email.fromEmail,
      fromName: email.fromName ?? null,
      toEmails: email.toEmails,
      ccEmails: email.ccEmails,
      sentAt: email.sentAt,
      direction: email.direction,
      accountEmails: email.accountEmails,
    }
  },
})
