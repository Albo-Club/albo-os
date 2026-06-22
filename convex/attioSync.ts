/**
 * Attio → Albo OS sync (stage-driven).
 *
 * Attio is the source of truth BEFORE investment (dealflow, term sheet).
 * When a deal's `stage` changes there, Attio fires a `record.updated`
 * webhook; we re-fetch the record (the payload diff is not reliable) and,
 * for the two stages we care about, hand a normalized payload to
 * `upsertFromDeal`:
 *   - 📝 Term Sheet (bb580481…) → deal `pending` + anticipated forecast entry
 *   - Invested      (b59066ed…) → deal `active`; an existing linked forecast
 *     entry is confirmed (never deleted — it realizes via the real wire).
 * every other stage is ignored (200, no-op).
 *
 * Flow: `attioWebhook` (httpAction: HMAC check + re-fetch + stage filter)
 *   → `upsertFromDeal` (internalMutation, idempotent on `attioDealId`).
 *
 * Idempotence: deals keyed on `attioDealId` (index by_attio_deal_id),
 * companies on `attioCompanyId` (by_attio_company_id), forecast entries on a
 * STABLE `derivedKey = deal:{dealId}` (one per deal, date lives in `date` so
 * the key never orphans across the Term Sheet → Invested transition).
 *
 * Status / instrument are FORWARD-ONLY on patch: an Invested event never
 * regresses an already exited deal, and a missing Attio instrument never
 * downgrades a known instrument to `unknown` (protects pre-existing
 * Airtable/manual deals during reconciliation).
 *
 * Webhook security: HMAC-SHA256 over the RAW UTF-8 body, hex-encoded,
 * header `Attio-Signature`, secret `ATTIO_WEBHOOK_SECRET`. Same Web Crypto
 * approach as Powens (`crypto.subtle.verify`, the runtime has no
 * `timingSafeEqual`), but Attio = hex + raw body only (Powens = base64 +
 * `POST.path.date.body`).
 *
 * Retry policy (avoid Attio's retry storm): a CONFIG error (missing secret /
 * API key) or a non-replayable data error answers 200 + logs — retrying
 * won't help. Only a transient re-fetch failure (network / Attio 5xx)
 * answers 503 so Attio retries.
 *
 * Env (set with `pnpm exec convex env set --prod`, never committed):
 *   - ATTIO_WEBHOOK_SECRET  — per-webhook signing secret (signature check)
 *   - ATTIO_API_KEY         — Bearer token for the record re-fetch (already set)
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { httpAction, internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { InstrumentKind } from './lib/instruments'

// ─── Attio constants ─────────────────────────────────────────────────────────

const ATTIO_API_BASE = 'https://api.attio.com'

/** Stage status ids we act on (match on id, never the emoji label). */
const TERM_SHEET_STATUS_ID = 'bb580481-f95e-42f7-a21e-ee974ac6a7cc'
const INVESTED_STATUS_ID = 'b59066ed-7ae6-4893-949e-a5540abdaf13'

const HANDLED_STAGES: ReadonlySet<string> = new Set([
  TERM_SHEET_STATUS_ID,
  INVESTED_STATUS_ID,
])

/** Attio `albo_or_calte` select option id → Albo OS org slug. */
const ORG_OPTION_TO_SLUG = new Map<string, string>([
  ['18a7bf8e-bc09-4750-9b07-0539f2179ac1', 'calte'], // 🛩️ Calte
  ['77b86c7e-ced4-4c34-b2e2-3278591ad00f', 'albo'], // 🌍 Albo
])

/** Attio `type_d_invest` option title → instrumentKind. Absent / unmatched
 * → 'unknown' (never downgrades a known instrument on patch). */
const INSTRUMENT_MAP = new Map<string, InstrumentKind>([
  ['Share', 'share'],
  ['Fund', 'fund_lp'],
  ['OCA', 'oc'],
  ['Obligation', 'os'],
  ['BSA', 'bsa'],
  ['BSA Air', 'bsa_air'],
  ['CCA', 'cca'],
  ['Royalties', 'royalty'],
  ['Secondary Shares', 'secondary'],
  ['Convertible Note', 'convertible_note'],
  ['SPV SAFE', 'safe'],
  ['SPV Share', 'spv_share'],
])

type DealStatus =
  | 'pending'
  | 'active'
  | 'partially_exited'
  | 'fully_exited'
  | 'written_off'

/** Lifecycle rank — status is forward-only (never moves to a lower rank). */
const STATUS_RANK: Record<DealStatus, number> = {
  pending: 0,
  active: 1,
  partially_exited: 2,
  fully_exited: 3,
  written_off: 3,
}

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

/** Marks a re-fetch failure Attio should retry (network / Attio 5xx). */
class RetryableError extends Error {}

/** ConvexError codes that mean « ops must fix config » → ack 200, no retry. */
const CONFIG_ERROR_DATA: ReadonlySet<string> = new Set([
  'missing_attio_webhook_secret',
  'missing_attio_api_key',
])
function isConfigError(err: unknown): boolean {
  return (
    err instanceof ConvexError &&
    typeof err.data === 'string' &&
    CONFIG_ERROR_DATA.has(err.data)
  )
}

/**
 * Re-fetch a `deals` record and normalize it. The re-fetch scopes to the
 * deals object: a non-deal / unknown record id 404s here → returns null
 * (skip, non-replayable). A network failure or Attio 5xx throws
 * `RetryableError` so the webhook answers 503 and Attio retries.
 */
async function fetchDealRecord(recordId: string): Promise<NormalizedDeal | null> {
  const apiKey = process.env.ATTIO_API_KEY
  if (!apiKey) throw new ConvexError('missing_attio_api_key')

  const res = await fetch(
    `${ATTIO_API_BASE}/v2/objects/deals/records/${recordId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  ).catch((e) => {
    throw new RetryableError(`network: ${String(e)}`)
  })
  if (!res.ok) {
    if (res.status >= 500) {
      throw new RetryableError(`attio_5xx:${res.status}`)
    }
    console.warn(
      `[attio] re-fetch ${res.status} for record=${recordId} — skipped (non-retryable)`,
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
  const normalized = hex.trim().toLowerCase()
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new Error('invalid_hex')
  }
  const bytes = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
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

/** Ack body for the « do not retry » cases (config / non-replayable). */
function ack(status: string): Response {
  return Response.json({ status })
}

/**
 * Attio webhook endpoint (routed at POST /attio/webhook in convex/http.ts).
 *
 * - Verifies `Attio-Signature` (HMAC-SHA256 hex over the raw body). 401 if
 *   invalid, 400 if missing / malformed JSON.
 * - Parses the envelope `{ webhook_id, events: [...] }`.
 * - Per event: re-fetches the deal record, filters to the handled stages,
 *   and calls `upsertFromDeal`. Ignored stages → no-op, still 200.
 * - Idempotency: Attio repeats `Idempotency-Key` across retries/redeliveries;
 *   the re-fetch + upsert path is idempotent, so replays are safe. A persisted
 *   dedup store is out of scope (would need a table).
 * - Retry policy: config error / non-replayable data error → 200 (ack);
 *   transient re-fetch failure → 503 (retry).
 */
export const attioWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('Attio-Signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  let ok: boolean
  try {
    ok = await verifySignature(rawBody, signature)
  } catch (err) {
    if (isConfigError(err)) {
      console.error(
        '[attio] config error (cannot verify signature) — ack 200 to avoid retry storm:',
        err,
      )
      return ack('config_error')
    }
    throw err
  }
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

    try {
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
    } catch (err) {
      if (isConfigError(err)) {
        console.error('[attio] config error — ack 200 to avoid retry storm:', err)
        return ack('config_error')
      }
      if (err instanceof RetryableError) {
        // Transient (network / Attio 5xx) — 503 so Attio retries the delivery.
        console.warn(
          `[attio] transient re-fetch failure for record=${recordId} — 503 (retry):`,
          err,
        )
        return new Response('Upstream re-fetch failed', { status: 503 })
      }
      // Non-replayable data error (bad mapping, missing org, …) — log + skip.
      console.error(
        `[attio] non-replayable error for record=${recordId} — skipped:`,
        err,
      )
      continue
    }
  }

  return ack('received')
})

// ─── Upsert mutation ─────────────────────────────────────────────────────────

/** Strip `undefined` keys so patch() never clears optional fields on re-run. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, val]) => val !== undefined),
  ) as T
}

async function orgBySlug(
  ctx: MutationCtx,
  slug: string,
): Promise<Doc<'organizations'> | null> {
  return ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
}

/** The org's root holding entity = the deal's investor (cf. attioAlboImport). */
async function groupRoot(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Doc<'companies'> | null> {
  return ctx.db
    .query('companies')
    .withIndex('by_org_kind', (q) =>
      q.eq('orgId', orgId).eq('kind', 'group_root'),
    )
    .first()
}

/**
 * Resolve the target portfolio company by `attioCompanyId`, creating a stub
 * (kind 'portfolio') if absent. The stub name falls back to the deal name —
 * the proper company seeding is the backfill's job; the user can rename.
 */
async function resolveTargetCompany(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  attioCompanyId: string,
  dealName: string | null,
): Promise<Id<'companies'>> {
  const existing = await ctx.db
    .query('companies')
    .withIndex('by_attio_company_id', (q) =>
      q.eq('attioCompanyId', attioCompanyId),
    )
    .unique()
  if (existing) return existing._id
  return ctx.db.insert('companies', {
    orgId,
    name: dealName ?? `Société Attio ${attioCompanyId.slice(0, 8)}`,
    kind: 'portfolio',
    attioCompanyId,
  })
}

/**
 * Term Sheet → upsert the anticipated cash-out forecast entry (stable
 * `derivedKey = deal:{dealId}`). Invested → confirm the existing entry if it
 * is still pending (never delete: it realizes via the real wire's pointage).
 */
async function syncDealForecast(
  ctx: MutationCtx,
  args: NormalizedDeal,
  dealId: Id<'deals'>,
  orgId: Id<'organizations'>,
  status: DealStatus,
): Promise<void> {
  const derivedKey = `deal:${dealId}`
  const existing = await ctx.db
    .query('forecastEntries')
    .withIndex('by_derivedKey', (q) => q.eq('derivedKey', derivedKey))
    .unique()

  if (status !== 'pending') {
    // Invested (or later): confirm the still-pending anticipated entry.
    if (existing && existing.status === 'pending') {
      await ctx.db.patch('forecastEntries', existing._id, {
        confidence: 'confirmed',
      })
    }
    return
  }

  // Term Sheet: an anticipated entry needs a positive amount.
  const amountCents = args.valueCents
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents <= 0) {
    console.warn(
      `[attio] deal=${args.attioDealId} term-sheet without a positive amount — forecast entry skipped`,
    )
    return
  }

  const fields = {
    orgId,
    date: args.investmentDate ?? Date.now(), // placeholder when undated
    amountCents,
    direction: 'out' as const,
    confidence: 'expected' as const,
    label: args.name ? `Investissement ${args.name}` : 'Investissement (Attio)',
    dealId,
    derivedKey,
    // Undated Term Sheet: excluded from the projected balance until a real
    // date is set (forecasts.ts).
    dateMissing: args.investmentDate == null,
  }

  if (existing) {
    // Only resync a still-pending entry; never touch a realized/cancelled one.
    if (existing.status === 'pending') {
      await ctx.db.patch('forecastEntries', existing._id, fields)
    }
  } else {
    await ctx.db.insert('forecastEntries', {
      ...fields,
      status: 'pending',
      overridden: false,
      currency: 'EUR',
    })
  }
}

/**
 * Normalized Attio deal → Albo OS. Idempotent on `attioDealId`. Skips (logs,
 * no throw) on data it can't resolve — bad/absent org, missing investor or
 * target — so the webhook never storms Attio on a config/data problem.
 *
 * No `requireOrgMember`: internal, the caller (webhook) is authenticated by
 * the HMAC signature.
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
  handler: async (ctx, args) => {
    // 1. Org from the albo_or_calte option (no guessing on absent/unknown).
    const slug = args.orgOptionId
      ? ORG_OPTION_TO_SLUG.get(args.orgOptionId)
      : undefined
    if (!slug) {
      console.warn(
        `[attio] deal=${args.attioDealId} skipped: org option absent/unknown (${args.orgOptionId ?? 'null'})`,
      )
      return { skipped: true as const, reason: 'org_unknown' }
    }
    const org = await orgBySlug(ctx, slug)
    if (!org) {
      console.error(
        `[attio] deal=${args.attioDealId} skipped: org slug '${slug}' not found`,
      )
      return { skipped: true as const, reason: 'org_not_found' }
    }

    // 2. Investor = the org's group_root.
    const investor = await groupRoot(ctx, org._id)
    if (!investor) {
      console.error(
        `[attio] deal=${args.attioDealId} skipped: no group_root for org '${slug}'`,
      )
      return { skipped: true as const, reason: 'group_root_missing' }
    }

    // 3. Target company (resolve/create by attioCompanyId).
    if (!args.targetCompanyAttioId) {
      console.warn(
        `[attio] deal=${args.attioDealId} skipped: no associated company`,
      )
      return { skipped: true as const, reason: 'target_missing' }
    }
    const targetCompanyId = await resolveTargetCompany(
      ctx,
      org._id,
      args.targetCompanyAttioId,
      args.name,
    )

    // 4. Existing deal (idempotency anchor) + forward-only status/instrument.
    const existing = await ctx.db
      .query('deals')
      .withIndex('by_attio_deal_id', (q) =>
        q.eq('attioDealId', args.attioDealId),
      )
      .unique()

    const incoming: DealStatus =
      args.stage === INVESTED_STATUS_ID ? 'active' : 'pending'
    const existingStatus = existing?.status
    const status: DealStatus =
      existingStatus && STATUS_RANK[existingStatus] >= STATUS_RANK[incoming]
        ? existingStatus
        : incoming

    const mapped: InstrumentKind =
      (args.instrumentRaw ? INSTRUMENT_MAP.get(args.instrumentRaw) : undefined) ??
      'unknown'
    // Never downgrade a known instrument to 'unknown' on an existing deal.
    const instrumentKind: InstrumentKind =
      existing && mapped === 'unknown' ? existing.instrumentKind : mapped

    const dealCore = clean({
      orgId: org._id,
      investorCompanyId: investor._id,
      targetCompanyId,
      instrumentKind,
      currency: 'EUR',
      committedAmount: args.valueCents ?? undefined,
      roundSize: args.roundSize,
      entryValuation: args.valuation,
      signedDate: args.investmentDate ?? undefined,
      name: args.name ?? undefined,
      attioDealId: args.attioDealId,
      status,
    })

    let dealId: Id<'deals'>
    if (existing) {
      await ctx.db.patch('deals', existing._id, dealCore)
      dealId = existing._id
    } else {
      dealId = await ctx.db.insert('deals', dealCore)
    }

    // 5. Anticipated forecast (Term Sheet) / confirm it (Invested).
    await syncDealForecast(ctx, args, dealId, org._id, status)

    console.log(
      `[attio] upsertFromDeal ${existing ? 'patched' : 'inserted'} ` +
        `deal=${dealId} (${slug}, status=${status}, instrument=${instrumentKind})`,
    )
    return { dealId, status, instrumentKind, created: !existing }
  },
})
