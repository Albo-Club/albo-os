/**
 * Attio → Albo OS sync (stage-driven, forward in time only).
 *
 * Attio is the source of truth BEFORE investment (dealflow, term sheet).
 * When a deal's `stage` changes there, Attio fires a `record.updated`
 * webhook; we re-fetch the record (the payload diff is not reliable) and,
 * for the two stages we care about, hand a normalized payload to
 * `upsertFromDeal`:
 *   - 📝 Term Sheet (bb580481…) → deal `pending` (committed, not wired) +
 *     an anticipated capital-outflow entry in the cash forecast.
 *   - Invested      (b59066ed…) → the SAME deal (matched on `attioDealId`)
 *     flips to `active`; its anticipated forecast entry is confirmed (never
 *     deleted — it realizes when the real wire is pointed to it).
 * every other stage is ignored (200, no-op).
 *
 * Anti-duplicate linchpin: we CREATE a deal only on Term Sheet, NEVER on
 * Invested (enforced by `decideSyncAction` in ./lib/attioSync). Deals already
 * invested in Albo OS (one-shot import #184, Airtable, manual) are therefore
 * never re-created — an Invested event with no matching `attioDealId` is
 * skipped. This is what lets the webhook run "from now on" without
 * back-importing the existing portfolio.
 *
 * Attribution boundary (cf. CLAUDE.md): a `pending` deal is pre-investment, so
 * Attio owns its fields and Term Sheet events refresh them. Once `active`
 * (post-signature) Albo OS owns the data — Invested only advances the
 * lifecycle and confirms the forecast, it never overwrites financials.
 *
 * Idempotence: deals keyed on `attioDealId` (index by_attio_deal_id),
 * companies on `attioCompanyId` (by_attio_company_id), the forecast entry on a
 * STABLE `derivedKey = deal:{dealId}` (one per deal — the date lives in `date`,
 * so the key never orphans across the Term Sheet → Invested transition).
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
import { httpAction, internalAction, internalMutation } from './_generated/server'
import {
  INVESTED_STATUS_ID,
  TERM_SHEET_STATUS_ID,
  advancesStatus,
  dealForecastKey,
  decideSyncAction,
  orgSlugFromOption,
  resolveInstrumentKind,
  shouldReplaceInstrument,
} from './lib/attioSync'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

// ─── Attio constants ─────────────────────────────────────────────────────────

const ATTIO_API_BASE = 'https://api.attio.com'

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
      `[attio] re-fetch failed: record=${recordId} status=${res.status}`,
    )
    return null
  }

  const json = (await res.json()) as unknown
  const values = asRecord(asRecord(asRecord(json).data).values) as Values
  return normalizeDealValues(recordId, values)
}

/**
 * Attio `deals` record `values` → normalized payload. Shared by the webhook
 * re-fetch and the backfill query so both feed `upsertFromDeal` identically.
 * Returns null when the record has no active stage.
 */
function normalizeDealValues(
  recordId: string,
  values: Values,
): NormalizedDeal | null {
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
 *   The re-fetch + upsert path is idempotent (deals on `attioDealId`, the
 *   forecast entry on `derivedKey`), so replays are safe with no dedup store.
 * - Retry policy: a transient re-fetch failure → 503 (Attio retries); a config
 *   error (missing secret / API key) → 200 (acked, no retry storm).
 */
export const attioWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signature = request.headers.get('Attio-Signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  let valid: boolean
  try {
    valid = await verifySignature(rawBody, signature)
  } catch (err) {
    if (isConfigError(err)) {
      console.error('[attio] webhook secret missing — acking without processing')
      return Response.json({ status: 'config_error' })
    }
    throw err
  }
  if (!valid) return new Response('Invalid signature', { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')
  const events = asArray(asRecord(payload).events)
  console.log(
    `[attio] webhook received: ${events.length} event(s), ` +
      `idempotencyKey=${idempotencyKey ?? '(none)'}`,
  )

  for (const event of events) {
    const recordId = asString(asRecord(asRecord(event).id).record_id)
    if (!recordId) continue

    let deal: NormalizedDeal | null
    try {
      deal = await fetchDealRecord(recordId)
    } catch (err) {
      if (err instanceof RetryableError) {
        console.warn(`[attio] transient re-fetch failure → 503: ${String(err)}`)
        return new Response('Upstream transient error', { status: 503 })
      }
      if (isConfigError(err)) {
        console.error('[attio] API key missing — acking without processing')
        return Response.json({ status: 'config_error' })
      }
      throw err
    }
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

// ─── Upsert mutation (real write) ────────────────────────────────────────────

/**
 * Normalized Attio deal → Albo OS. No `requireOrgMember`: this is internal,
 * the caller (webhook) is authenticated by the HMAC signature. The org is
 * resolved from the Attio `albo_or_calte` option, and every write is scoped
 * to that org. The branch decision (create / refresh / confirm / skip) is the
 * pure `decideSyncAction` (./lib/attioSync) — see it for the invariants.
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
    const existing = await ctx.db
      .query('deals')
      .withIndex('by_attio_deal_id', (q) => q.eq('attioDealId', args.attioDealId))
      .unique()
    const action = decideSyncAction(args.stage, existing ? existing.status : null)

    if (action.kind === 'skip') {
      console.log(
        `[attio] ${args.attioDealId} stage=${args.stage}: skip (${action.reason})`,
      )
      return { skipped: true as const, reason: action.reason }
    }

    // ── Invested: patch-only. decideSyncAction returns 'invested' only when a
    //    deal already exists → never a create, so existing invested deals in
    //    Albo OS can't be duplicated. Post-signature: only advance the
    //    lifecycle (forward-only) and confirm the anticipated forecast entry. ──
    if (action.kind === 'invested') {
      // Defensive: 'invested' is only returned with an existing deal.
      if (!existing) return { skipped: true as const, reason: 'invested_no_deal' }
      if (advancesStatus(existing.status, 'active')) {
        await ctx.db.patch('deals', existing._id, { status: 'active' })
      }
      await confirmDealForecastEntry(ctx, existing._id)
      return { dealId: existing._id, action: 'invested' as const }
    }

    // ── Term Sheet (create or refresh): pre-investment, Attio is the source. ──
    const orgSlug = orgSlugFromOption(args.orgOptionId)
    if (!orgSlug) {
      console.warn(
        `[attio] term sheet ${args.attioDealId}: unknown/absent org option ` +
          `(${args.orgOptionId ?? 'none'}) → skip`,
      )
      return { skipped: true as const, reason: 'unknown_org' }
    }
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) {
      console.warn(
        `[attio] term sheet ${args.attioDealId}: org '${orgSlug}' not found → skip`,
      )
      return { skipped: true as const, reason: 'org_not_found' }
    }
    const instrumentKind = resolveInstrumentKind(args.instrumentRaw)

    if (action.kind === 'termsheet_refresh') {
      // Defensive: 'termsheet_refresh' is only returned with an existing deal.
      if (!existing) return { skipped: true as const, reason: 'termsheet_no_deal' }
      await ctx.db.patch('deals', existing._id, {
        ...(shouldReplaceInstrument(instrumentKind, existing.instrumentKind)
          ? { instrumentKind }
          : {}),
        ...(args.name ? { name: args.name } : {}),
        ...(args.valueCents != null ? { committedAmount: args.valueCents } : {}),
        ...(args.investmentDate != null
          ? { investmentDate: args.investmentDate }
          : {}),
        ...(args.roundSize != null ? { roundSize: args.roundSize } : {}),
        ...(args.valuation != null ? { entryValuation: args.valuation } : {}),
      })
      await upsertDealForecastEntry(ctx, existing._id, org._id, args)
      return { dealId: existing._id, action: 'termsheet_updated' as const }
    }

    // action.kind === 'termsheet_create'
    const investor = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'group_root'),
      )
      .first()
    if (!investor) {
      console.warn(
        `[attio] term sheet ${args.attioDealId}: no group_root for org ` +
          `'${orgSlug}' → skip`,
      )
      return { skipped: true as const, reason: 'no_group_root' }
    }
    const targetCompanyId = await resolveOrCreateTargetCompany(ctx, org._id, args)
    const dealId = await ctx.db.insert('deals', {
      orgId: org._id,
      investorCompanyId: investor._id,
      targetCompanyId,
      instrumentKind,
      currency: 'EUR',
      status: 'pending',
      attioDealId: args.attioDealId,
      ...(args.name ? { name: args.name } : {}),
      ...(args.valueCents != null ? { committedAmount: args.valueCents } : {}),
      ...(args.investmentDate != null
        ? { investmentDate: args.investmentDate }
        : {}),
      ...(args.roundSize != null ? { roundSize: args.roundSize } : {}),
      ...(args.valuation != null ? { entryValuation: args.valuation } : {}),
    })
    await upsertDealForecastEntry(ctx, dealId, org._id, args)
    return { dealId, action: 'termsheet_created' as const }
  },
})

/**
 * Portfolio company for the deal target: reuse the Attio-anchored one when it
 * exists in this org, else create a stub named after the deal. The
 * `attioCompanyId` anchor is only claimed when no company already holds it,
 * to preserve its uniqueness.
 */
async function resolveOrCreateTargetCompany(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  args: NormalizedDeal,
): Promise<Id<'companies'>> {
  const attioCompanyId = args.targetCompanyAttioId
  const anchored = attioCompanyId
    ? await ctx.db
        .query('companies')
        .withIndex('by_attio_company_id', (q) =>
          q.eq('attioCompanyId', attioCompanyId),
        )
        .unique()
    : null
  if (anchored && anchored.orgId === orgId) return anchored._id
  return await ctx.db.insert('companies', {
    orgId,
    name: args.name?.trim() || 'Société (Attio)',
    kind: 'portfolio',
    ...(attioCompanyId && !anchored ? { attioCompanyId } : {}),
  })
}

/** Last day of the current UTC month at 00:00 — placeholder date for a TS deal
 * with no `date_de_l_investissement` yet (keeps it in the current month). */
function endOfCurrentMonthMs(): number {
  const now = new Date(Date.now())
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
}

/**
 * The anticipated capital outflow for a deal — one stable entry per deal
 * (`derivedKey = deal:{dealId}`, category `deals`). ALWAYS created (so a TS
 * deal always shows in the forecast); when Attio has no
 * `date_de_l_investissement` the date is a placeholder (end of the current
 * month) and `dateMissing: true` flags it so the UI prompts for a real one.
 * While still pending it is refreshed from Attio; a realized/cancelled one is
 * never touched, and a date the user fixed by hand is only overwritten once
 * Attio itself provides a real date.
 */
async function upsertDealForecastEntry(
  ctx: MutationCtx,
  dealId: Id<'deals'>,
  orgId: Id<'organizations'>,
  args: NormalizedDeal,
): Promise<void> {
  if (args.valueCents == null || args.valueCents <= 0) {
    console.log(
      `[attio] deal ${args.attioDealId}: no positive value → no forecast entry`,
    )
    return
  }
  const derivedKey = dealForecastKey(dealId)
  const label = args.name ? `Investissement ${args.name}` : 'Investissement'
  const existing = await ctx.db
    .query('forecastEntries')
    .withIndex('by_derivedKey', (q) => q.eq('derivedKey', derivedKey))
    .unique()
  if (existing) {
    if (existing.status === 'pending') {
      await ctx.db.patch('forecastEntries', existing._id, {
        amountCents: args.valueCents,
        label,
        // Only a real Attio date moves the date / clears the flag — never
        // clobber a date the user fixed by hand with a fresh placeholder.
        ...(args.investmentDate != null
          ? { date: args.investmentDate, dateMissing: false }
          : {}),
      })
    }
    return
  }
  await ctx.db.insert('forecastEntries', {
    orgId,
    date: args.investmentDate ?? endOfCurrentMonthMs(),
    amountCents: args.valueCents,
    direction: 'out',
    confidence: 'expected',
    status: 'pending',
    label,
    category: 'deals',
    dealId,
    derivedKey,
    overridden: false,
    currency: 'EUR',
    dateMissing: args.investmentDate == null,
  })
}

/**
 * On Invested: the anticipated entry becomes committed (`confidence:
 * confirmed`). Never deleted — it realizes when the real wire is pointed to
 * it. No-op if there is no entry or it is already realized/cancelled.
 */
async function confirmDealForecastEntry(
  ctx: MutationCtx,
  dealId: Id<'deals'>,
): Promise<void> {
  const entry = await ctx.db
    .query('forecastEntries')
    .withIndex('by_derivedKey', (q) => q.eq('derivedKey', dealForecastKey(dealId)))
    .unique()
  if (entry && entry.status === 'pending') {
    await ctx.db.patch('forecastEntries', entry._id, { confidence: 'confirmed' })
  }
}

// ─── One-shot backfill (deals already at Term Sheet) ─────────────────────────

/**
 * Import the deals CURRENTLY at the Term Sheet stage in Attio — the webhook
 * only catches future stage changes, so the ones sitting in Term Sheet at
 * activation need a one-shot. Queries every deal, keeps the Term Sheet ones
 * (by status id, same rule as the webhook), and runs each through the same
 * `upsertFromDeal` path: creates the pending deal + forecast entry, idempotent
 * on `attioDealId`, and NEVER touches Invested (the anti-duplicate rule lives
 * in `decideSyncAction`, so even if a non-TS record slipped through it would
 * be skipped). Re-runnable.
 *
 *   npx convex run --prod attioSync:backfillTermSheets
 */
export const backfillTermSheets = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.ATTIO_API_KEY
    if (!apiKey) throw new ConvexError('missing_attio_api_key')

    // Collect the Term Sheet deals (paginated query, filtered by status id).
    const termSheetDeals: Array<NormalizedDeal> = []
    const pageSize = 500
    let offset = 0
    for (;;) {
      const res = await fetch(
        `${ATTIO_API_BASE}/v2/objects/deals/records/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit: pageSize, offset }),
        },
      )
      if (!res.ok) throw new ConvexError(`attio_query_failed:${res.status}`)
      const data = asArray(asRecord((await res.json()) as unknown).data)
      for (const rec of data) {
        const recordId = asString(asRecord(asRecord(rec).id).record_id)
        if (!recordId) continue
        const deal = normalizeDealValues(recordId, asRecord(asRecord(rec).values))
        if (deal && deal.stage === TERM_SHEET_STATUS_ID) termSheetDeals.push(deal)
      }
      if (data.length < pageSize) break
      offset += pageSize
    }

    let created = 0
    let updated = 0
    let skipped = 0
    for (const deal of termSheetDeals) {
      const res = await ctx.runMutation(internal.attioSync.upsertFromDeal, deal)
      if ('action' in res && res.action === 'termsheet_created') created += 1
      else if ('action' in res) updated += 1
      else skipped += 1
    }

    console.log(
      `[attio] backfill term sheets: ${termSheetDeals.length} found — ` +
        `created=${created} updated=${updated} skipped=${skipped}`,
    )
    return { termSheetDeals: termSheetDeals.length, created, updated, skipped }
  },
})
