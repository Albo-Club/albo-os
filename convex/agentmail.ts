/**
 * AgentMail integration — REST wrapper (fetch, no SDK → runs in the default
 * Convex runtime) + the inbound webhook.
 *
 * Flow: `agentmailWebhook` (httpAction, Svix signature check) → normalize the
 * `message.received` event → `ctx.scheduler.runAfter(0, internal.reportPipeline.run)`.
 *
 * REST base: https://api.agentmail.to/v0 — auth `Authorization: Bearer <key>`.
 * Pattern mirrors convex/attio.ts + convex/powens.ts (env keys, graceful
 * errors, manual signature verification via Web Crypto).
 */

import { ConvexError } from 'convex/values'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

const API_BASE = 'https://api.agentmail.to/v0'

// Returns null (not throw) when unset, so a missing key degrades gracefully
// instead of crashing the whole pipeline run.
function apiKey(): string | null {
  return process.env.AGENTMAIL_API_KEY ?? null
}

function authHeaders(): Record<string, string> | null {
  const key = apiKey()
  return key
    ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
    : null
}

/** Extract the bare email from a "Name <email>" (or plain) From value. */
function parseFromAddress(raw: string): string {
  const angle = raw.match(/<([^>]+)>/)
  return (angle ? angle[1] : raw).trim().toLowerCase()
}

// ─── Normalized event shape passed to the pipeline ───────────────────────────

export interface AgentmailAttachmentMeta {
  attachmentId: string
  filename: string
  contentType?: string
  size?: number
  inline?: boolean
}

export interface AgentmailMessage {
  inboxId: string
  messageId: string
  threadId?: string
  from: string
  to: Array<string>
  cc: Array<string>
  subject: string
  text: string
  html: string
  /** Presigned URL (S3) holding the full body JSON when text/html are absent
   *  from the webhook payload. Fetched in the pipeline via fetchBody(). */
  bodyUrl?: string
  date?: number // ms epoch
  attachments: Array<AgentmailAttachmentMeta>
}

function asArray(v: unknown): Array<unknown> {
  return Array.isArray(v) ? v : v == null ? [] : [v]
}

function addrList(v: unknown): Array<string> {
  return asArray(v)
    .map((a) => {
      if (typeof a === 'string') return a
      const o = a as Record<string, unknown>
      return o.email ?? o.address ?? ''
    })
    .map((s) => String(s).toLowerCase())
    .filter(Boolean)
}

/**
 * Normalize a raw AgentMail `message.received` payload. The webhook wraps the
 * message under `message` (sometimes `data`); field names vary (`from` vs
 * `from_`), so we read defensively.
 */
export function normalizeMessage(payload: Record<string, unknown>): AgentmailMessage | null {
  const rawMsg = payload.message ?? payload.data ?? payload
  if (typeof rawMsg !== 'object') return null
  const msg = rawMsg as Record<string, unknown>

  const messageId = String(msg.message_id ?? msg.id ?? '')
  const inboxId = String(msg.inbox_id ?? payload.inbox_id ?? process.env.AGENTMAIL_INBOX_ID ?? '')
  if (!messageId || !inboxId) return null

  const fromCandidates = [
    typeof msg.from === 'string' ? msg.from : undefined,
    typeof msg.from_ === 'string' ? msg.from_ : undefined,
    addrList(msg.from ?? msg.from_)[0],
  ]
  const fromRaw = fromCandidates.find((x): x is string => !!x) ?? ''
  const from = parseFromAddress(fromRaw)

  const dateRaw = msg.timestamp ?? msg.date ?? msg.received_at
  const date = dateRaw ? Date.parse(String(dateRaw)) : undefined

  const attachments: Array<AgentmailAttachmentMeta> = asArray(msg.attachments).map((a) => {
    const o = a as Record<string, unknown>
    return {
      attachmentId: String(o.attachment_id ?? o.id ?? ''),
      filename: String(o.filename ?? o.name ?? 'attachment'),
      contentType: o.content_type ? String(o.content_type) : undefined,
      size: typeof o.size === 'number' ? o.size : undefined,
      inline: Boolean(o.inline),
    }
  })

  return {
    inboxId,
    messageId,
    threadId: msg.thread_id ? String(msg.thread_id) : undefined,
    from,
    to: addrList(msg.to),
    cc: addrList(msg.cc),
    subject: String(msg.subject ?? '(no subject)'),
    text: String(msg.text ?? ''),
    html: String(msg.html ?? ''),
    bodyUrl: msg.body_url ? String(msg.body_url) : undefined,
    date: date && !Number.isNaN(date) ? date : undefined,
    attachments: attachments.filter((a) => a.attachmentId),
  }
}

/**
 * Fetch the full email body from a presigned `body_url` (the webhook payload
 * omits text/html for large messages). No auth — the URL is already signed.
 */
export async function fetchBody(bodyUrl: string): Promise<{ text: string; html: string }> {
  try {
    const res = await fetch(bodyUrl)
    if (!res.ok) {
      console.warn(`[agentmail] fetchBody status=${res.status}`)
      return { text: '', html: '' }
    }
    const data = (await res.json()) as Record<string, unknown>
    const text = String(data.text ?? data.body_plain ?? data.plain ?? data.body_text ?? '')
    const html = String(data.html ?? data.body_html ?? data.body ?? '')
    return { text, html }
  } catch (err) {
    console.warn('[agentmail] fetchBody failed:', err instanceof Error ? err.message : String(err))
    return { text: '', html: '' }
  }
}

// ─── REST helpers (callable from actions) ────────────────────────────────────

/** Full message (used as a fallback when the webhook body was truncated >1MB). */
export async function getMessage(
  inboxId: string,
  messageId: string,
): Promise<Record<string, unknown> | null> {
  const headers = authHeaders()
  if (!headers) {
    console.warn('[agentmail] getMessage skipped — no AGENTMAIL_API_KEY')
    return null
  }
  const res = await fetch(
    `${API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
    { headers },
  )
  if (!res.ok) {
    console.warn(`[agentmail] getMessage status=${res.status}`)
    return null
  }
  return (await res.json()) as Record<string, unknown>
}

/**
 * Download an attachment's bytes. The endpoint returns JSON (a presigned `url`
 * or base64 `content`); we handle both, plus a raw-binary fallback.
 */
export async function downloadAttachment(
  inboxId: string,
  messageId: string,
  attachmentId: string,
): Promise<ArrayBuffer | null> {
  const key = apiKey()
  if (!key) {
    console.warn('[agentmail] downloadAttachment skipped — no AGENTMAIL_API_KEY')
    return null
  }
  const res = await fetch(
    `${API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  )
  if (!res.ok) {
    console.warn(`[agentmail] downloadAttachment status=${res.status}`)
    return null
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return await res.arrayBuffer()
  }

  const json = (await res.json()) as Record<string, unknown>
  const url = json.url ?? json.download_url ?? json.signed_url
  if (typeof url === 'string') {
    const fileRes = await fetch(url)
    if (!fileRes.ok) {
      console.warn(`[agentmail] attachment url fetch status=${fileRes.status}`)
      return null
    }
    return await fileRes.arrayBuffer()
  }
  const content = json.content ?? json.data
  if (typeof content === 'string') return base64ToArrayBuffer(content)

  console.warn('[agentmail] downloadAttachment: no url/content in response')
  return null
}

/** Reply to a message within its thread (confirmation email). */
export async function replyToMessage(
  inboxId: string,
  messageId: string,
  html: string,
): Promise<boolean> {
  const headers = authHeaders()
  if (!headers) {
    console.warn('[agentmail] reply skipped — no AGENTMAIL_API_KEY')
    return false
  }
  const res = await fetch(
    `${API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
    { method: 'POST', headers, body: JSON.stringify({ html }) },
  )
  if (!res.ok) console.error(`[agentmail] reply status=${res.status}`)
  return res.ok
}

/** Send a fresh message from the inbox. */
export async function sendMessage(
  inboxId: string,
  to: Array<string>,
  subject: string,
  html: string,
): Promise<boolean> {
  const headers = authHeaders()
  if (!headers) {
    console.warn('[agentmail] send skipped — no AGENTMAIL_API_KEY')
    return false
  }
  const res = await fetch(
    `${API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    { method: 'POST', headers, body: JSON.stringify({ to, subject, html }) },
  )
  if (!res.ok) console.error(`[agentmail] send status=${res.status}`)
  return res.ok
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ─── Svix signature verification ─────────────────────────────────────────────
// AgentMail signs webhooks with Svix. Headers: svix-id, svix-timestamp,
// svix-signature ("v1,<base64sig> v1,<base64sig>"). Signed content:
// `${id}.${timestamp}.${body}`, HMAC-SHA256 with the base64-decoded secret
// (after stripping the "whsec_" prefix). Verified via Web Crypto (no Node).

async function verifySvix(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  body: string,
): Promise<boolean> {
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const keyBytes = base64ToArrayBuffer(rawSecret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = `${svixId}.${svixTimestamp}.${body}`
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))

  // Header may contain several space-separated "v1,<sig>" entries.
  return svixSignature
    .split(' ')
    .map((p) => (p.includes(',') ? p.split(',')[1] : p))
    .some((sig) => sig === expected)
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

export const agentmailWebhook = httpAction(async (ctx, request) => {
  const body = await request.text()

  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET
  if (!secret) throw new ConvexError('missing_agentmail_webhook_secret')
  const svixId = request.headers.get('svix-id') ?? ''
  const svixTs = request.headers.get('svix-timestamp') ?? ''
  const svixSig = request.headers.get('svix-signature') ?? ''
  const ok =
    svixId && svixTs && svixSig &&
    (await verifySvix(secret, svixId, svixTs, svixSig, body))
  if (!ok) return new Response('Invalid signature', { status: 401 })

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Only react to inbound messages; ack everything else.
  const eventType = String(payload.event_type ?? payload.type ?? '')
  if (eventType && !eventType.startsWith('message.received')) {
    return Response.json({ status: 'ignored', eventType })
  }

  const message = normalizeMessage(payload)
  if (!message) return new Response('Unparseable message', { status: 400 })

  await ctx.scheduler.runAfter(0, internal.reportPipeline.run, { message })
  return Response.json({ status: 'received' })
})
