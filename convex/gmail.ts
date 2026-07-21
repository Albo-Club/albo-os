/**
 * Gmail connector — portfolio email timeline.
 *
 * Direct Google OAuth (no aggregator), modeled on Twenty CRM's messaging
 * sync (github.com/twentyhq/twenty, modules/messaging):
 * - one `gmailAccounts` row per mailbox PER ORG (strict tenant separation:
 *   a connection made from an org only feeds that org; the same personal
 *   mailbox serving two vehicles = two rows, one OAuth grant each);
 * - `historyId` as the incremental sync cursor (users.history.list), reset
 *   on expiry; ~10 min polling cron (no Pub/Sub push — internal tool);
 * - messages deduplicated across mailboxes by the RFC `Message-ID` header;
 * - DETERMINISTIC matching: a message is linked to every active portfolio
 *   company OF THE MAILBOX'S ORG whose `domain` appears among the
 *   participants' email domains (freemail + connected-mailbox domains
 *   excluded, fully-internal mail skipped). No LLM. Only matched messages
 *   are stored.
 * - matched messages are stored IN FULL for later re-processing (étape 2 —
 *   report extraction): cleaned text with link URLs preserved, attachments
 *   downloaded to Convex storage, Gmail reference kept as a re-fetch net.
 *
 * Report extraction is NOT wired here (étape 2): the AgentMail pipeline
 * keeps handling forwarded reports for now.
 *
 * Security: `refreshToken` is secret at rest — every account listing here is
 * internal; public views are sanitized (same rule as `powensUsers`). OAuth
 * `state` rows are one-shot and expire after 15 min. Connect/disconnect are
 * admin-gated on the org, like the other org connectors.
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
import { requireAppUser, requireOrgMember, requireOrgRole } from './lib/auth'
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000
const MAX_BODY_CHARS = 50_000
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024 // app-wide upload cap
const MAX_ATTACHMENTS_PER_MESSAGE = 10
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
 * Build the Google authorize URL for one org and store the one-shot
 * anti-CSRF `state`. Admin-gated on the org (connecting a mailbox is a
 * sensitive action, same rule as the other connectors). The front end
 * redirects the browser to the returned URL; Google calls back on
 * /gmail/oauth/callback (convex/http.ts).
 */
export const startConnect = mutation({
  args: { orgId: v.id('organizations'), returnTo: v.string() },
  handler: async (ctx, { orgId, returnTo }) => {
    const { user } = await requireOrgRole(ctx, orgId, 'admin')
    // Only an in-app path may be used as the post-callback landing target.
    if (!returnTo.startsWith('/')) throw new ConvexError('invalid_return_to')
    const { clientId, redirectUri } = gmailEnv()

    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    await ctx.db.insert('gmailOAuthStates', {
      orgId,
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

/** Consume (validate + delete) an OAuth state token. One-shot by design; a
 * legacy state without orgId is treated as expired. */
export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query('gmailOAuthStates')
      .withIndex('by_state', (q) => q.eq('state', state))
      .unique()
    if (!row) return null
    await ctx.db.delete('gmailOAuthStates', row._id)
    if (!row.orgId || Date.now() - row.createdAt > OAUTH_STATE_TTL_MS) {
      return null
    }
    return { orgId: row.orgId, userId: row.userId, returnTo: row.returnTo }
  },
})

/** Upsert a connected mailbox after a successful token exchange. Upsert key
 * = (org, email): the same mailbox in another org is a separate row. On a
 * reconnect the existing sync cursor is KEPT (a stale cursor is handled by
 * the expiry fallback in the sync), so no window of mail is silently lost. */
export const saveAccount = internalMutation({
  args: {
    orgId: v.id('organizations'),
    userId: v.id('users'),
    email: v.string(),
    refreshToken: v.string(),
    initialHistoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase()
    const existing = await ctx.db
      .query('gmailAccounts')
      .withIndex('by_org_and_email', (q) =>
        q.eq('orgId', args.orgId).eq('email', email),
      )
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
      orgId: args.orgId,
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
 * Exchanges the code, resolves the mailbox address, stores the account for
 * the state's org and bounces the browser back into the app. Secrets never
 * appear in the redirect URL or in error messages.
 */
export const gmailOauthCallback = httpAction(async (ctx, req) => {
  const url = new URL(req.url)
  const siteUrl = process.env.SITE_URL ?? ''
  const state = url.searchParams.get('state') ?? ''
  const stateRow = state
    ? await ctx.runMutation(internal.gmail.consumeOAuthState, { state })
    : null
  const landing = (outcome: 'connected' | 'error') => {
    const path = stateRow?.returnTo ?? '/app'
    return Response.redirect(`${siteUrl}${path}?gmail=${outcome}`, 302)
  }
  if (!stateRow) return Response.redirect(`${siteUrl}/app?gmail=error`, 302)

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
      orgId: stateRow.orgId,
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

/** Disconnect a mailbox from its org: best-effort token revocation on
 * Google's side, then forget the account row. Admin-gated on the row's org.
 * Already-imported timeline emails stay. */
export const disconnect = mutation({
  args: { accountId: v.id('gmailAccounts') },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get('gmailAccounts', accountId)
    if (!account) throw new ConvexError('not_found')
    if (account.orgId) {
      await requireOrgRole(ctx, account.orgId, 'admin')
    } else {
      // Legacy pre-separation row: any app user may clean it up.
      await requireAppUser(ctx)
    }
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
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
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

function base64UrlToBytes(data: string): Uint8Array<ArrayBuffer> {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  // Backed by a plain ArrayBuffer so the result is a valid BlobPart.
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function decodeBase64Url(data: string): string {
  return new TextDecoder('utf-8').decode(base64UrlToBytes(data))
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

/** Minimal HTML → text fallback when a message has no text/plain part.
 * `<a href>` URLs are PRESERVED next to their label — losing them would
 * strand every "view the report" DocSend/Notion link (étape 2 needs them). */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        // Skip the parenthesized URL when the label already IS the URL.
        return text && text !== href ? `${text} (${href})` : href
      },
    )
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

type AttachmentPart = {
  filename: string
  mimeType?: string
  attachmentId: string
  size?: number
}

/** Collect the real attachment parts of a message. Inline signature images
 * (small image/* parts) are noise, not documents — skipped. */
function collectAttachmentParts(
  part: GmailPart | undefined,
  out: Array<AttachmentPart>,
) {
  if (!part) return
  if (part.filename && part.body?.attachmentId) {
    const size = part.body.size
    const isSmallImage =
      (part.mimeType ?? '').startsWith('image/') && (size ?? 0) < 100_000
    const tooBig = (size ?? 0) > MAX_ATTACHMENT_BYTES
    if (!isSmallImage && !tooBig) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size,
      })
    }
  }
  for (const child of part.parts ?? []) collectAttachmentParts(child, out)
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

/** Poll every connected mailbox — cron entry point (cf. convex/crons.ts).
 * Legacy pre-separation rows (no orgId) are purged here: they were shipped
 * global with zero synced data; their mailboxes must be reconnected from an
 * org (cf. KNOWN_ISSUES « Connecteur Gmail »). */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts: Array<Doc<'gmailAccounts'>> = await ctx.runQuery(
      internal.gmail.listAccountsInternal,
      {},
    )
    for (const account of accounts) {
      if (!account.orgId) {
        await ctx.runMutation(internal.gmail.deleteAccountInternal, {
          accountId: account._id,
        })
        continue
      }
      try {
        await syncAccount(ctx, account, account.orgId)
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

async function gmailGet(accessToken: string, path: string): Promise<Response> {
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

async function syncAccount(
  ctx: ActionCtx,
  account: Doc<'gmailAccounts'>,
  orgId: Id<'organizations'>,
) {
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

  // No cursor (defensive) → anchor at "now" and start from the next run.
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
    const toEmails = parseAddresses(header(message, 'To'))
    const ccEmails = parseAddresses(header(message, 'Cc'))

    // Phase 1 — cheap match probe: no write, no attachment download for the
    // ~95% of mail that concerns no participation of this org.
    const probe: { matched: boolean; alreadyStored: boolean } =
      await ctx.runQuery(internal.gmail.matchProbe, {
        orgId,
        accountEmail: account.email,
        participantEmails: [fromEmail, ...toEmails, ...ccEmails],
        headerMessageId,
      })
    if (!probe.matched) continue

    // Phase 2 — download attachments into Convex storage (first sighting
    // only: another mailbox already stored them otherwise).
    let attachments:
      | Array<{
          filename: string
          contentType?: string
          size?: number
          storageId: Id<'_storage'>
        }>
      | undefined
    if (!probe.alreadyStored) {
      const parts: Array<AttachmentPart> = []
      collectAttachmentParts(message.payload, parts)
      const stored = []
      for (const part of parts.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
        const attRes = await gmailGet(
          accessToken,
          `messages/${id}/attachments/${part.attachmentId}`,
        )
        if (!attRes.ok) continue
        const att = (await attRes.json()) as { data?: string }
        if (!att.data) continue
        const bytes = base64UrlToBytes(att.data)
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue
        const storageId = await ctx.storage.store(
          new Blob([bytes], { type: part.mimeType ?? 'application/octet-stream' }),
        )
        stored.push({
          filename: part.filename,
          contentType: part.mimeType,
          size: bytes.byteLength,
          storageId,
        })
      }
      if (stored.length > 0) attachments = stored
    }

    // Phase 3 — transactional store (matching re-checked inside).
    await ctx.runMutation(internal.gmail.storeMessage, {
      orgId,
      accountEmail: account.email,
      headerMessageId,
      gmailMessageId: id,
      gmailThreadId: message.threadId,
      subject: header(message, 'Subject') ?? '',
      snippet: message.snippet,
      bodyText: extractBodyText(message) ?? undefined,
      fromEmail,
      fromName: parseFromName(header(message, 'From')) ?? undefined,
      toEmails,
      ccEmails,
      sentAt: Number(message.internalDate ?? Date.now()),
      attachments,
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
 * Deterministic matching of a message against ONE org's portfolio: the
 * candidate domains are the participants' domains minus freemail minus the
 * org's connected-mailbox domains; fully-internal mail (all participants on
 * the mailbox's own domain) never matches. Shared by the read probe and the
 * transactional store.
 */
async function findMatches(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  accountEmail: string,
  participantEmails: Array<string>,
): Promise<Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }>> {
  const accountDomain = domainOf(accountEmail)
  const participantDomains = [
    ...new Set(
      participantEmails
        .map((p) => domainOf(p))
        .filter((d): d is string => d !== null),
    ),
  ]
  if (participantDomains.every((d) => d === accountDomain)) return []

  const accounts = await ctx.db
    .query('gmailAccounts')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .take(50)
  const mailboxDomains = new Set(
    accounts
      .map((a) => domainOf(a.email))
      .filter((d): d is string => d !== null),
  )
  const candidateDomains = participantDomains.filter(
    (d) => !FREEMAIL_DOMAINS.has(d) && !mailboxDomains.has(d),
  )
  if (candidateDomains.length === 0) return []

  const matches: Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }> = []
  for (const domain of candidateDomains) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_domain', (q) => q.eq('orgId', orgId).eq('domain', domain))
      .collect()
    for (const company of companies) {
      if (company.kind !== 'portfolio' || company.archivedAt) continue
      matches.push({ companyId: company._id, orgId })
    }
  }
  return matches
}

/** Read-only pre-check used by the sync action before downloading anything:
 * does the message match this org, and is it already stored (dedup)? */
export const matchProbe = internalQuery({
  args: {
    orgId: v.id('organizations'),
    accountEmail: v.string(),
    participantEmails: v.array(v.string()),
    headerMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const matches = await findMatches(
      ctx,
      args.orgId,
      args.accountEmail,
      args.participantEmails,
    )
    if (matches.length === 0) return { matched: false, alreadyStored: false }
    const existing = await ctx.db
      .query('companyEmails')
      .withIndex('by_header_message_id', (q) =>
        q.eq('headerMessageId', args.headerMessageId),
      )
      .unique()
    return { matched: true, alreadyStored: existing !== null }
  },
})

/**
 * Match one parsed message against the account org's portfolio and store it.
 * Transactional and idempotent: dedup by `headerMessageId`, a replay only
 * merges the mailbox into `accountEmails` / adds missing links; attachments
 * are attached on first insert only (the probe prevents double downloads).
 */
export const storeMessage = internalMutation({
  args: {
    orgId: v.id('organizations'),
    accountEmail: v.string(),
    headerMessageId: v.string(),
    gmailMessageId: v.string(),
    gmailThreadId: v.optional(v.string()),
    subject: v.string(),
    snippet: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmails: v.array(v.string()),
    ccEmails: v.array(v.string()),
    sentAt: v.number(),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.optional(v.string()),
          size: v.optional(v.number()),
          storageId: v.id('_storage'),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const matches = await findMatches(
      ctx,
      args.orgId,
      args.accountEmail,
      [args.fromEmail, ...args.toEmails, ...args.ccEmails],
    )
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
      const patch: Partial<Doc<'companyEmails'>> = {}
      if (!existing.accountEmails.includes(args.accountEmail)) {
        patch.accountEmails = [...existing.accountEmails, args.accountEmail]
      }
      // Defensive: attach late-arriving attachments if the first sighting
      // stored none (e.g. its download failed).
      if (!existing.attachments?.length && args.attachments?.length) {
        patch.attachments = args.attachments
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch('companyEmails', existing._id, patch)
      }
    } else {
      emailId = await ctx.db.insert('companyEmails', {
        headerMessageId: args.headerMessageId,
        gmailMessageId: args.gmailMessageId,
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
        attachments: args.attachments,
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
        attachmentCount: email.attachments?.length ?? 0,
      })
    }
    return out
  },
})

/** Full content of one timeline email (detail dialog), attachments resolved
 * to signed download URLs. Authorized when the caller is a member of at
 * least one org the email is linked to. */
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

    const attachments = []
    for (const att of email.attachments ?? []) {
      attachments.push({
        filename: att.filename,
        contentType: att.contentType ?? null,
        size: att.size ?? null,
        url: await ctx.storage.getUrl(att.storageId),
      })
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
      attachments,
    }
  },
})
