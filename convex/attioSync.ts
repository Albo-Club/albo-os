/**
 * Attio → Albo OS sync (stage-driven).
 *
 * Attio is the source of truth BEFORE investment (dealflow, term sheet).
 * When a deal's `stage` changes there, Attio fires a `record.updated`
 * webhook; we re-fetch the record (the payload diff is not reliable) and,
 * for the two stages we care about, hand a normalized payload to
 * `upsertFromDeal`:
 *   - 📝 Term Sheet (bb580481…) → deal « pending » + anticipated forecast
 *   - Invested      (b59066ed…) → deal « confirmed » (status active)
 * every other stage is ignored (200, no-op).
 *
 * Flow: `attioWebhook` (httpAction: HMAC check + re-fetch + stage filter)
 *   → `upsertFromDeal` (internalMutation).
 *
 * ⚠️ LOT 1 — BACKEND SKELETON ONLY. `upsertFromDeal` does NOT write to the
 * DB yet: it logs the normalized payload and returns. The real upsert
 * (deal + forecast, investor = group_root, idempotent on `attioDealId`) is
 * Lot 2.
 *
 * Webhook security: HMAC-SHA256 over the RAW UTF-8 body, hex-encoded,
 * header `Attio-Signature`, secret `ATTIO_WEBHOOK_SECRET`. Same Web Crypto
 * approach as Powens (`crypto.subtle.verify`, the runtime has no
 * `timingSafeEqual`), but Attio = hex + raw body only (Powens = base64 +
 * `POST.path.date.body`).
 *
 * Env (set with `pnpm exec convex env set --prod`, never committed):
 *   - ATTIO_WEBHOOK_SECRET  — per-webhook signing secret (signature check)
 *   - ATTIO_API_KEY         — Bearer token for the record re-fetch (already set)
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { httpAction, internalMutation } from './_generated/server'

// ─── Attio constants ─────────────────────────────────────────────────────────

const ATTIO_API_BASE = 'https://api.attio.com'

/** Stage status ids we act on (match on id, never the emoji label). */
const TERM_SHEET_STATUS_ID = 'bb580481-f95e-42f7-a21e-ee974ac6a7cc'
const INVESTED_STATUS_ID = 'b59066ed-7ae6-4893-949e-a5540abdaf13'

const HANDLED_STAGES: ReadonlySet<string> = new Set([
  TERM_SHEET_STATUS_ID,
  INVESTED_STATUS_ID,
])

// ─── Untyped-JSON helpers (Attio record payload, cf. convex/powens.ts) ───────

type Values = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : []
}

/**
 * Current value of an Attio attribute. Attio returns each attribute as an
 * array of historized values; the active one has `active_until === null`.
 * Never trust index [0]. Falls back to the last entry if none is flagged
 * active (defensive).
 */
function activeEntry(value: unknown): Record<string, unknown> | null {
  const arr = asArray(value)
  if (arr.length === 0) return null
  const active = arr.find((e) => asRecord(e).active_until == null)
  return asRecord(active ?? arr[arr.length - 1])
}

/** Status option id: `values.<slug>[active].status.id.status_id`. */
function statusId(values: Values, slug: string): string | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  return asString(asRecord(asRecord(entry.status).id).status_id) ?? null
}

/** Single/multi-select option id: `values.<slug>[active].option.id.option_id`. */
function optionId(values: Values, slug: string): string | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  return asString(asRecord(asRecord(entry.option).id).option_id) ?? null
}

/** Select option human label: `values.<slug>[active].option.title`. */
function optionTitle(values: Values, slug: string): string | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  return asString(asRecord(entry.option).title) ?? null
}

/** Currency in cents: `values.<slug>[active].currency_value` × 100 (major units). */
function currencyCents(values: Values, slug: string): number | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  const major = asNumber(entry.currency_value)
  return major == null ? null : Math.round(major * 100)
}

/** Record-reference target id: `values.<slug>[active].target_record_id`. */
function refRecordId(values: Values, slug: string): string | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  return asString(entry.target_record_id) ?? null
}

/** Date attribute (YYYY-MM-DD) → ms epoch UTC. */
function dateMs(values: Values, slug: string): number | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  const raw = asString(entry.value)
  if (!raw) return null
  const ms = Date.parse(`${raw}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/** Text attribute: `values.<slug>[active].value`. */
function textValue(values: Values, slug: string): string | null {
  const entry = activeEntry(values[slug])
  if (!entry) return null
  return asString(entry.value) ?? null
}

// ─── Normalized payload (httpAction → mutation boundary) ─────────────────────

type NormalizedDeal = {
  attioDealId: string
  stage: string
  valueCents: number | null
  orgOptionId: string | null
  targetCompanyAttioId: string | null
  instrumentRaw: string | null
  investmentDate: number | null
  name: string | null
  roundSize?: number
  valuation?: number
}

/**
 * Re-fetch a `deals` record and normalize it. Returns null on any failure
 * (unknown record, non-deal record, transport error) → the event is skipped
 * (still 200). The re-fetch scopes to the deals object: a non-deal record id
 * 404s here, which is the desired no-op.
 */
async function fetchDealRecord(recordId: string): Promise<NormalizedDeal | null> {
  const apiKey = process.env.ATTIO_API_KEY
  if (!apiKey) throw new ConvexError('missing_attio_api_key')

  const res = await fetch(
    `${ATTIO_API_BASE}/v2/objects/deals/records/${recordId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  )
  if (!res.ok) {
    console.warn(
      `[attio] re-fetch failed: record=${recordId} status=${res.status}`,
    )
    return null
  }

  const json = (await res.json()) as unknown
  const values = asRecord(asRecord(asRecord(json).data).values) as Values

  const stage = statusId(values, 'stage')
  if (!stage) {
    console.warn(`[attio] record=${recordId} has no active stage — skipped`)
    return null
  }

  const roundSize = currencyCents(values, 'montant_levee_6')
  const valuation = currencyCents(values, 'valorisation_8')

  return {
    attioDealId: recordId,
    stage,
    valueCents: currencyCents(values, 'value'),
    orgOptionId: optionId(values, 'albo_or_calte'),
    targetCompanyAttioId: refRecordId(values, 'associated_company'),
    instrumentRaw: optionTitle(values, 'type_d_invest'),
    investmentDate: dateMs(values, 'date_de_l_investissement'),
    name: textValue(values, 'name'),
    ...(roundSize != null ? { roundSize } : {}),
    ...(valuation != null ? { valuation } : {}),
  }
}

// ─── HMAC signature verification (Attio: hex, raw body) ──────────────────────

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim().toLowerCase()
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error('invalid_hex')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function verifySignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const secret = process.env.ATTIO_WEBHOOK_SECRET
  if (!secret) throw new ConvexError('missing_attio_webhook_secret')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  let sigBytes: Uint8Array<ArrayBuffer>
  try {
    sigBytes = hexToBytes(signature)
  } catch {
    return false
  }
  const messageBytes: Uint8Array<ArrayBuffer> = new Uint8Array(
    enc.encode(rawBody),
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, messageBytes)
}

// ─── HTTP action (webhook) ───────────────────────────────────────────────────

/**
 * Attio webhook endpoint (routed at POST /attio/webhook in convex/http.ts).
 *
 * - Verifies `Attio-Signature` (HMAC-SHA256 hex over the raw body). 401 if
 *   invalid, 400 if missing / malformed JSON.
 * - Parses the envelope `{ webhook_id, events: [...] }`.
 * - Per event: re-fetches the deal record, filters to the handled stages,
 *   and calls `upsertFromDeal`. Ignored stages → no-op, still 200.
 * - Idempotency: Attio repeats `Idempotency-Key` across retries/redeliveries.
 *   We always answer 200 (except 401/400) and the re-fetch+upsert path is
 *   idempotent, so replays are safe. A persisted dedup store is Lot 2 (needs
 *   a table = a DB write, out of scope here).
 */
export const attioWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('Attio-Signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const ok = await verifySignature(rawBody, signature)
  if (!ok) return new Response('Invalid signature', { status: 401 })

  const idempotencyKey = request.headers.get('Idempotency-Key')

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const events = asArray(asRecord(payload).events)
  console.log(
    `[attio] webhook received: ${events.length} event(s), ` +
      `idempotencyKey=${idempotencyKey ?? '(none)'}`,
  )

  for (const event of events) {
    const recordId = asString(asRecord(asRecord(event).id).record_id)
    if (!recordId) continue

    const deal = await fetchDealRecord(recordId)
    if (!deal) continue

    if (!HANDLED_STAGES.has(deal.stage)) {
      // Ignored stage (Awareness/Passed/Lost/Exit/…) — no-op, still 200.
      console.log(
        `[attio] record=${recordId} stage=${deal.stage} ignored (no-op)`,
      )
      continue
    }

    await ctx.runMutation(internal.attioSync.upsertFromDeal, deal)
  }

  return Response.json({ status: 'received' })
})

// ─── Upsert mutation (LOT 1 SKELETON — no DB write) ──────────────────────────

/**
 * Normalized Attio deal → Albo OS. LOT 1: SKELETON ONLY — logs the payload
 * and returns, writes nothing. Lot 2 implements the real upsert:
 *   - resolve org from `orgOptionId` (🛩️ Calte → calte, 🌍 Albo → albo)
 *   - resolve/create target company via `targetCompanyAttioId`
 *   - investor = org's `group_root` (cf. migrations/attioAlboImport.ts)
 *   - map `instrumentRaw` → instrumentKind
 *   - upsert deal idempotently on `attioDealId` (index by_attio_deal_id),
 *     status `pending` (Term Sheet) / `active` (Invested)
 *   - anticipated forecast entry on Term Sheet
 *
 * No `requireOrgMember`: this is internal, the caller (webhook) is
 * authenticated by the HMAC signature.
 */
export const upsertFromDeal = internalMutation({
  args: {
    attioDealId: v.string(),
    stage: v.string(),
    valueCents: v.union(v.number(), v.null()),
    orgOptionId: v.union(v.string(), v.null()),
    targetCompanyAttioId: v.union(v.string(), v.null()),
    instrumentRaw: v.union(v.string(), v.null()),
    investmentDate: v.union(v.number(), v.null()),
    name: v.union(v.string(), v.null()),
    roundSize: v.optional(v.number()),
    valuation: v.optional(v.number()),
  },
  handler: (_ctx, args) => {
    // LOT 1: skeleton — structured log, no DB write (not even a test insert).
    // Sync handler on purpose (no await yet); Lot 2 makes it async on the
    // first DB write.
    console.log(`[attio] upsertFromDeal (skeleton, no write): ${JSON.stringify(args)}`)
    return { skipped: true as const, reason: 'lot1_skeleton' }
  },
})
