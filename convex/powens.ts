/**
 * Powens → Convex ingestion (bankAccounts + transactions).
 *
 * Bank connection (login + strong auth) happens off-app via the Powens
 * Webview. Here we handle the AFTER: the Powens `CONNECTION_SYNCED` webhook
 * pushes the accounts + transactions, which we write idempotently, scoped to
 * the org.
 *
 * Flow: `powensWebhook` (httpAction, HMAC check + payload normalization)
 *   → `ingestConnectionSync` (internalMutation: account resolution, per-account
 *   cutover, idempotent upsert by `powensTxId`).
 *
 * Webhook security: HMAC-SHA256 signature (headers `BI-Signature` +
 * `BI-Signature-Date`) verified via Web Crypto (`crypto.subtle.verify`).
 * The Convex runtime does not expose Node's `crypto.timingSafeEqual`;
 * `crypto.subtle.verify` is the constant-time equivalent. Cf. KNOWN_ISSUES.md.
 *
 * Connector → owner entity mapping: new accounts only. Qonto is not in it:
 * it is matched to the existing record (imported from Airtable).
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { requireOrgRole } from './lib/auth'
import { buildSearchText } from './lib/searchText'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/** Must match EXACTLY the path of the webhook URL configured on the Powens
 * side (no trailing slash): the HMAC is computed over it. */
const WEBHOOK_PATH = '/powens/webhook'

/** Powens connector (normalized name, matched by inclusion) → org + owning
 * `group_*` entity, for the CREATION of a new account. Qonto excluded. */
const CONNECTOR_OWNER: ReadonlyArray<{
  match: string
  orgSlug: string
  ownerName: string
  bankName: string
}> = [
  { match: 'palatine', orgSlug: 'calte', ownerName: 'CALTE', bankName: 'Palatine' },
  { match: 'wormser', orgSlug: 'calte', ownerName: 'CALTE', bankName: 'Wormser' },
  { match: 'neuflize', orgSlug: 'calte', ownerName: 'CALTE', bankName: 'Neuflize' },
  { match: 'memo', orgSlug: 'albo', ownerName: 'Albo Club', bankName: 'Mémo Bank' },
]

/** Powens account type → our own `accountKind`. Default: raw Powens type. */
const ACCOUNT_KIND: Record<string, string> = {
  checking: 'checking',
  savings: 'savings',
  deposit: 'dat',
  market: 'cto',
}

// ─── Normalization helpers (Powens payload = untyped JSON) ───────────────────

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
function asIdStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}
/** Like `normalizeName` but also collapses internal whitespace — to compare
 * multi-word labels ("Neuflize OBC - Compte à terme"). */
function squashName(s: string): string {
  return normalizeName(s).replace(/\s+/g, ' ')
}

function matchConnector(normalizedConnector: string) {
  return (
    CONNECTOR_OWNER.find((e) => normalizedConnector.includes(e.match)) ?? null
  )
}
function mapAccountKind(type: string | undefined): string | undefined {
  if (!type) return undefined
  return ACCOUNT_KIND[type] ?? type
}

// ─── Normalized shape (action → mutation boundary) ───────────────────────────

const normTxValidator = v.object({
  powensTxId: v.string(),
  valueUnits: v.number(), // signed currency units (e.g. -56.78)
  dateMs: v.number(),
  wording: v.string(),
  counterparty: v.optional(v.string()),
  deleted: v.boolean(),
})

const normAccountValidator = v.object({
  powensAccountId: v.string(),
  accountName: v.optional(v.string()),
  connectorName: v.string(),
  iban: v.optional(v.string()),
  accountType: v.optional(v.string()),
  balanceUnits: v.optional(v.number()), // signed currency units
  currency: v.string(),
  transactions: v.array(normTxValidator),
})

type NormTx = {
  powensTxId: string
  valueUnits: number
  dateMs: number
  wording: string
  counterparty?: string
  deleted: boolean
}
type NormAccount = {
  powensAccountId: string
  accountName?: string
  connectorName: string
  iban?: string
  accountType?: string
  balanceUnits?: number
  currency: string
  transactions: Array<NormTx>
}

function normalizeCurrency(value: unknown): string {
  if (typeof value === 'string') return value
  const id = asString(asRecord(value).id)
  return id ?? 'EUR'
}

function extractCounterparty(tx: Record<string, unknown>): string | undefined {
  const c = tx.counterparty
  if (typeof c === 'string') return c
  return asString(asRecord(c).label)
}

function normalizeTx(raw: unknown): NormTx | null {
  const t = asRecord(raw)
  const powensTxId = asIdStr(t.id)
  if (!powensTxId) return null
  const dateStr = asString(t.date) ?? asString(t.rdate)
  if (!dateStr) return null
  const dateMs = Date.parse(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(dateMs)) return null
  const value = asNumber(t.value) ?? Number(asString(t.value))
  if (Number.isNaN(value)) return null
  const wording = asString(t.wording) ?? asString(t.simplified_wording) ?? ''
  return {
    powensTxId,
    valueUnits: value,
    dateMs,
    wording,
    counterparty: extractCounterparty(t),
    deleted: t.deleted != null,
  }
}

function normalizeAccount(raw: unknown, connectorName: string): NormAccount | null {
  const a = asRecord(raw)
  const powensAccountId = asIdStr(a.id)
  if (!powensAccountId) return null
  const transactions = asArray(a.transactions)
    .map(normalizeTx)
    .filter((t): t is NormTx => t !== null)
  return {
    powensAccountId,
    accountName: asString(a.name),
    connectorName,
    iban: asString(a.iban),
    accountType: asString(a.type),
    balanceUnits: asNumber(a.balance),
    currency: normalizeCurrency(a.currency),
    transactions,
  }
}

function normalizePayload(payload: unknown): {
  connectionId: string
  powensUserId: string | undefined
  accounts: Array<NormAccount>
} {
  const root = asRecord(payload)
  // Tolerates a root-level payload OR one wrapped in `connection`.
  const connection = root.connection != null ? asRecord(root.connection) : root
  const connector = asRecord(connection.connector)
  const connectorName =
    asString(connector.name) ?? asString(connector.uuid) ?? ''
  const connectionId =
    asIdStr(connection.id) ?? asIdStr(root.id_connection) ?? ''
  // Id of the Powens user owning the connection. CONNECTION_SYNCED doc:
  // `connection.id_user` (Connection object) and `user.id` (root User object).
  const powensUserId =
    asIdStr(connection.id_user) ??
    asIdStr(asRecord(root.user).id) ??
    asIdStr(root.id_user)
  const accounts = asArray(connection.accounts)
    .map((a) => normalizeAccount(a, connectorName))
    .filter((a): a is NormAccount => a !== null)
  return { connectionId, powensUserId, accounts }
}

// ─── HMAC signature verification ─────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function verifySignature(
  rawBody: string,
  signatureDate: string,
  signature: string,
): Promise<boolean> {
  const secret = process.env.POWENS_WEBHOOK_SECRET
  if (!secret) throw new ConvexError('missing_powens_webhook_secret')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const message = `POST.${WEBHOOK_PATH}.${signatureDate}.${rawBody}`
  let sigBytes: Uint8Array<ArrayBuffer>
  try {
    sigBytes = base64ToBytes(signature)
  } catch {
    return false
  }
  const messageBytes: Uint8Array<ArrayBuffer> = new Uint8Array(
    enc.encode(message),
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, messageBytes)
}

// ─── HTTP action (webhook) ───────────────────────────────────────────────────

export const powensWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text()
  const signatureDate = request.headers.get('BI-Signature-Date')
  const signature = request.headers.get('BI-Signature')
  if (!signatureDate || !signature) {
    return new Response('Missing signature', { status: 400 })
  }
  const ok = await verifySignature(rawBody, signatureDate, signature)
  if (!ok) return new Response('Invalid signature', { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const normalized = normalizePayload(payload)
  if (normalized.accounts.length > 0) {
    await ctx.runMutation(internal.powens.ingestConnectionSync, normalized)
  }
  return Response.json({ status: 'received' })
})

// ─── Account resolution + ingestion (internal mutation) ──────────────────────

function balancePatch(acc: NormAccount): {
  currentBalance?: number
  balanceAsOf?: number
} {
  if (acc.balanceUnits == null) return {}
  return {
    currentBalance: Math.round(acc.balanceUnits * 100),
    balanceAsOf: Date.now(),
  }
}

async function orgBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<'organizations'>> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${slug}`)
  return org
}

async function resolveGroupCompany(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  name: string,
): Promise<Doc<'companies'>> {
  const target = normalizeName(name)
  const companies = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  const found = companies.find((c) => normalizeName(c.name) === target)
  if (!found) throw new ConvexError(`group_company_not_found:${name}`)
  if (!found.kind.startsWith('group_')) {
    throw new ConvexError(`owner_not_group_entity:${name}`)
  }
  return found
}

async function qontoAccountsOfCalte(
  ctx: QueryCtx,
): Promise<Array<Doc<'bankAccounts'>>> {
  const org = await orgBySlug(ctx, 'calte')
  const accounts = await ctx.db
    .query('bankAccounts')
    .withIndex('by_org', (q) => q.eq('orgId', org._id))
    .collect()
  return accounts.filter((a) => normalizeName(a.bankName).includes('qonto'))
}

/** Qonto records eligible for the automatic match: not yet linked to Powens
 * AND not archived. This is the set that must contain exactly 1. */
function eligibleQontoCandidates(
  accounts: ReadonlyArray<Doc<'bankAccounts'>>,
): Array<Doc<'bankAccounts'>> {
  return accounts.filter((a) => !a.powensAccountId && !a.archivedAt)
}

type TestTxRow = {
  _id: Id<'transactions'>
  transactionDate: number
  amount: number
  direction: 'in' | 'out'
  rawLabel: string
}

/** `manual` txs without an `airtableId` on the given Qonto accounts (potential
 * test rows). */
async function qontoTestTxRows(
  ctx: QueryCtx,
  accounts: ReadonlyArray<Doc<'bankAccounts'>>,
): Promise<Array<TestTxRow>> {
  const out: Array<TestTxRow> = []
  for (const acc of accounts) {
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', acc._id))
      .order('desc')
      .collect()
    for (const t of txs) {
      if (t.source === 'manual' && !t.airtableId) {
        out.push({
          _id: t._id,
          transactionDate: t.transactionDate,
          amount: t.amount,
          direction: t.direction,
          rawLabel: t.rawLabel,
        })
      }
    }
  }
  return out
}

/** Matches a Powens Qonto account to the existing record (imported from
 * Airtable). Match by IBAN if the record has one, otherwise by uniqueness of
 * `bankName='Qonto'` (the Airtable import does not store the IBAN), with IBAN
 * backfill.
 *
 * Separate cases (do not confuse):
 * - 0 eligible candidates = calte's Qonto record(s) are ALREADY linked to
 *   another `powensAccountId` (redundant re-sync webhook from another Powens
 *   connection/user). We keep the first match as the source of truth →
 *   `qonto_already_linked` warning + this account is ignored (return null,
 *   no error).
 * - ≥2 candidates = real ambiguity → `qonto_match_ambiguous` (hard stop). */
async function linkQonto(
  ctx: MutationCtx,
  acc: NormAccount,
  connectionId: string,
): Promise<Doc<'bankAccounts'> | null> {
  const qontoAccounts = await qontoAccountsOfCalte(ctx)
  const candidates = eligibleQontoCandidates(qontoAccounts)
  if (candidates.length === 0) {
    const linkedIds = qontoAccounts
      .filter((a) => a.powensAccountId)
      .map((a) => a.powensAccountId)
      .join(', ')
    console.warn(
      `[powens] qonto_already_linked: compte payload acct ${acc.powensAccountId} ` +
        `ignoré — record(s) Qonto déjà lié(s) à acct ${linkedIds || '(aucun)'}`,
    )
    return null
  }
  if (candidates.length > 1) throw new ConvexError('qonto_match_ambiguous')
  const qonto = candidates[0]
  if (
    qonto.iban &&
    acc.iban &&
    normalizeIban(qonto.iban) !== normalizeIban(acc.iban)
  ) {
    throw new ConvexError('qonto_iban_mismatch')
  }
  await ctx.db.patch("bankAccounts", qonto._id, {
    powensConnectionId: connectionId,
    powensAccountId: acc.powensAccountId,
    iban: qonto.iban ?? acc.iban,
    ...balancePatch(acc),
  })
  const refreshed = await ctx.db.get("bankAccounts", qonto._id)
  if (!refreshed) throw new ConvexError('account_vanished')
  return refreshed
}

/** Resolves the target `bankAccounts` row for a payload account. Returns
 * `null` if the account must be ignored (`qonto_already_linked` case, cf.
 * linkQonto).
 *
 * `org` = the org of the matched Powens user (source of truth for "who owns
 * this connection"): it is what scopes the write. The connector→entity
 * mapping only picks the owning entity and must agree with this org
 * (otherwise a visible error, no silent write). */
async function resolveAccount(
  ctx: MutationCtx,
  connectionId: string,
  acc: NormAccount,
  org: Doc<'organizations'>,
): Promise<Doc<'bankAccounts'> | null> {
  // 1. Already linked by powensAccountId → reuse it (balance update).
  const linked = await ctx.db
    .query('bankAccounts')
    .withIndex('by_powens_account', (q) =>
      q.eq('powensAccountId', acc.powensAccountId),
    )
    .first()
  if (linked) {
    // Consistency: the linked account must belong to the Powens user's org.
    if (linked.orgId !== org._id) {
      console.warn(
        `[powens] compte acct ${acc.powensAccountId} déjà lié à une autre org ` +
          `que celle du user Powens (${org.slug}) — ignoré`,
      )
      return null
    }
    await ctx.db.patch("bankAccounts", linked._id, balancePatch(acc))
    const refreshed = await ctx.db.get("bankAccounts", linked._id)
    if (!refreshed) throw new ConvexError('account_vanished')
    return refreshed
  }

  const connector = normalizeName(acc.connectorName)

  // 2. Existing Qonto match (the record lives in the calte org).
  if (connector.includes('qonto')) {
    if (org.slug !== 'calte') {
      throw new ConvexError(`connector_org_mismatch:qonto:${org.slug}`)
    }
    return linkQonto(ctx, acc, connectionId)
  }

  // 3. New account via the connector → entity mapping, scoped to the user's org.
  const mapping = matchConnector(connector)
  if (!mapping) {
    throw new ConvexError(`unmapped_powens_account:${acc.connectorName}`)
  }
  if (mapping.orgSlug !== org.slug) {
    throw new ConvexError(
      `connector_org_mismatch:${acc.connectorName}:${org.slug}`,
    )
  }
  const owner = await resolveGroupCompany(ctx, org._id, mapping.ownerName)
  const balance = balancePatch(acc)
  const id = await ctx.db.insert('bankAccounts', {
    orgId: org._id,
    ownerCompanyId: owner._id,
    bankName: mapping.bankName,
    label: acc.accountName ?? mapping.bankName,
    iban: acc.iban,
    accountKind: mapAccountKind(acc.accountType),
    currency: acc.currency,
    currentBalance: balance.currentBalance,
    balanceAsOf: balance.balanceAsOf,
    powensConnectionId: connectionId,
    powensAccountId: acc.powensAccountId,
  })
  const created = await ctx.db.get("bankAccounts", id)
  if (!created) throw new ConvexError('account_create_failed')
  return created
}

/** Per-account cutover bound (nothing stored):
 * - Qonto (Airtable record, has `airtableId`) → date of its latest
 *   Airtable-originated tx; we only ingest what is strictly later.
 * - New account → `_creationTime` (≈ connection date). */
async function computeCutoff(
  ctx: QueryCtx,
  account: Doc<'bankAccounts'>,
): Promise<number> {
  if (!account.airtableId) return account._creationTime
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_account_date', (q) => q.eq('bankAccountId', account._id))
    .order('desc')
    .collect()
  for (const t of txs) {
    if (t.airtableId) return t.transactionDate
  }
  return account._creationTime
}

export const ingestConnectionSync = internalMutation({
  args: {
    connectionId: v.string(),
    powensUserId: v.optional(v.string()),
    accounts: v.array(normAccountValidator),
  },
  handler: async (ctx, { connectionId, powensUserId, accounts }) => {
    const summary = { inserted: 0, patched: 0, skipped: 0 }

    // ── Filter by Powens user: only the users managed by Albo OS are
    // ingested. Connections from other projects (old unmanaged users)
    // still re-sync and would pollute the database.
    if (!powensUserId) {
      console.warn(
        `[powens] webhook ignoré: payload sans id_user (connection=${connectionId})`,
      )
      return summary
    }
    const powensUser = await ctx.db
      .query('powensUsers')
      .withIndex('by_powens_user_id', (q) =>
        q.eq('powensUserId', powensUserId),
      )
      .unique()
    if (!powensUser) {
      console.warn(
        `[powens] webhook ignoré: id_user inconnu (${powensUserId}) — ` +
          `connexion non gérée par Albo OS (connection=${connectionId})`,
      )
      return summary
    }
    // The matched Powens user's org = source of truth for the write scope.
    const org = await ctx.db.get("organizations", powensUser.orgId)
    if (!org) throw new ConvexError('powens_user_org_not_found')

    console.log(
      `[powens] webhook connection=${connectionId} (user ${powensUserId} → org ${org.slug}): ` +
        `${accounts.length} compte(s) dans le payload`,
    )
    for (const acc of accounts) {
      const account = await resolveAccount(ctx, connectionId, acc, org)
      if (!account) {
        // Account ignored (qonto_already_linked) — its txs are not ingested.
        summary.skipped += acc.transactions.length
        continue
      }
      const cutoff = await computeCutoff(ctx, account)
      // Diagnostic: where the bound comes from (without changing computeCutoff).
      const cutoffSource =
        cutoff === account._creationTime
          ? '_creationTime'
          : 'dernière tx Airtable'
      // Per-account counters (feed the log; the global summary is unchanged).
      let received = 0
      let ingested = 0
      let filteredCutover = 0
      let filteredDeleted = 0
      let alreadyExisting = 0
      for (const tx of acc.transactions) {
        received += 1
        if (tx.deleted || tx.dateMs <= cutoff) {
          if (tx.deleted) {
            filteredDeleted += 1
          } else {
            filteredCutover += 1
          }
          summary.skipped += 1
          continue
        }
        const existing = await ctx.db
          .query('transactions')
          .withIndex('by_powens_id', (q) =>
            q.eq('powensTxId', tx.powensTxId),
          )
          .first()
        const direction: 'in' | 'out' = tx.valueUnits < 0 ? 'out' : 'in'
        const fields = {
          orgId: account.orgId,
          bankAccountId: account._id,
          direction,
          amount: Math.round(Math.abs(tx.valueUnits) * 100),
          transactionDate: tx.dateMs,
          rawLabel: tx.wording,
          counterparty: tx.counterparty,
          searchText: buildSearchText(tx.wording, tx.counterparty),
          source: 'powens' as const,
          powensTxId: tx.powensTxId,
        }
        if (existing) {
          // Webhook redelivery: do not overwrite the matching state
          // (matchStatus / dealId / reconciled) already set on the row.
          await ctx.db.patch("transactions", existing._id, fields)
          alreadyExisting += 1
          summary.patched += 1
        } else {
          await ctx.db.insert('transactions', {
            ...fields,
            reconciled: false,
            matchStatus: 'unmatched' as const,
          })
          ingested += 1
          summary.inserted += 1
        }
      }
      console.log(
        `[powens] ${account.bankName} / connecteur "${acc.connectorName}" ` +
          `(acct ${acc.powensAccountId}): reçu ${received} tx, ` +
          `cutover=${new Date(cutoff).toISOString().slice(0, 10)} (${cutoffSource}), ` +
          `ingéré ${ingested}, filtré ${filteredCutover} (cutover)` +
          `${filteredDeleted > 0 ? ` + ${filteredDeleted} (deleted)` : ''}, ` +
          `${alreadyExisting} déjà existante(s) (idempotence)`,
      )
    }
    console.log(
      `[powens] webhook connection=${connectionId} terminé: ` +
        `inserted=${summary.inserted}, patched=${summary.patched}, skipped=${summary.skipped}`,
    )
    return summary
  },
})

// ─── Qonto cleanup (test rows) — operator via `convex run --prod` ─────────────

/** Read-only: Qonto txs where `source='manual'` AND no `airtableId`.
 * Internal → no auth guard (run from the CLI with a deploy key). */
export const listQontoTestTransactions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return qontoTestTxRows(ctx, await qontoAccountsOfCalte(ctx))
  },
})

/** Read-only: pre-go-live diagnostic of the Qonto match. Lists all Qonto-ish
 * `bankAccounts` of calte (with the state of the key fields), counts the
 * eligible candidates (unlinked + unarchived) — which must be exactly 1 —
 * and joins the test txs (`manual` without `airtableId`) that could explain
 * an extra record. Writes nothing. */
export const diagnoseQontoMatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await qontoAccountsOfCalte(ctx)
    const eligible = eligibleQontoCandidates(accounts)
    return {
      qontoAccounts: accounts.map((a) => ({
        _id: a._id,
        bankName: a.bankName,
        label: a.label,
        iban: a.iban ?? null,
        powensAccountId: a.powensAccountId ?? null,
        airtableId: a.airtableId ?? null,
        archivedAt: a.archivedAt ?? null,
      })),
      eligibleCount: eligible.length,
      matchOk: eligible.length === 1,
      testTransactions: await qontoTestTxRows(ctx, accounts),
    }
  },
})

/** Read-only: for each calte `bankAccounts` row, the number of attached
 * transactions (via `by_account_date`) + a keep/delete decision (same rule as
 * the deletion: `isCalteKeepAccount`). Sorted by descending tx count: at the
 * top, the to-delete accounts with movements (tricky migration); at the
 * bottom (txCount 0), trivial deletion. Writes nothing. */
export const diagnoseBankAccountsForCleanup = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await orgBySlug(ctx, 'calte')
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const rows = await Promise.all(
      accounts.map(async (a) => {
        const txs = await ctx.db
          .query('transactions')
          .withIndex('by_account_date', (q) => q.eq('bankAccountId', a._id))
          .collect()
        return {
          _id: a._id,
          bankName: a.bankName,
          label: a.label,
          airtableId: a.airtableId ?? null,
          archivedAt: a.archivedAt ?? null,
          txCount: txs.length,
          decision: isCalteKeepAccount(a) ? ('keep' as const) : ('delete' as const),
        }
      }),
    )
    rows.sort((x, y) => y.txCount - x.txCount)
    return rows
  },
})

/** Targeted deletion, strict guard: only deletes `manual` txs without an
 * `airtableId` attached to a calte Qonto account. Everything else is skipped. */
export const deleteTransactionsByIds = internalMutation({
  args: { ids: v.array(v.id('transactions')) },
  handler: async (ctx, { ids }) => {
    const qontoIds = new Set(
      (await qontoAccountsOfCalte(ctx)).map((a) => a._id),
    )
    let deleted = 0
    const skipped: Array<{ id: Id<'transactions'>; reason: string }> = []
    for (const id of ids) {
      const t = await ctx.db.get("transactions", id)
      if (!t) {
        skipped.push({ id, reason: 'not_found' })
        continue
      }
      if (t.source !== 'manual') {
        skipped.push({ id, reason: 'not_manual' })
        continue
      }
      if (t.airtableId) {
        skipped.push({ id, reason: 'has_airtable_id' })
        continue
      }
      if (!qontoIds.has(t.bankAccountId)) {
        skipped.push({ id, reason: 'not_qonto' })
        continue
      }
      await ctx.db.delete("transactions", id)
      deleted += 1
    }
    return { deleted, skipped }
  },
})

/** Calte accounts to KEEP during the `bankAccounts` cleanup. Resolved live:
 * by `label`/`bankName` (normalized) OR by the import `airtableId` sentinel
 * (the "mouvement sans banque" row). Guard: an account recognized as "keep"
 * is never deleted, even if its id is passed as input by mistake. */
const CALTE_KEEP_LABELS = [
  'Qonto — Good',
  'PALATINE',
  'HSBC — NE PAS SUPPRIMER !',
]
const CALTE_KEEP_AIRTABLE_IDS = ['__unassigned_bank__']

function isCalteKeepAccount(a: Doc<'bankAccounts'>): boolean {
  if (a.airtableId && CALTE_KEEP_AIRTABLE_IDS.includes(a.airtableId)) {
    return true
  }
  const keep = new Set(CALTE_KEEP_LABELS.map(squashName))
  return keep.has(squashName(a.label)) || keep.has(squashName(a.bankName))
}

/** Targeted deletion of `bankAccounts` (calte org), strict guards in this
 * order: (a) the account belongs to calte, (b) it is NOT an account to
 * keep (resolved live), (c) it has 0 attached transactions (live check via
 * `by_account_date`). Any unmet condition → skip + report, never a
 * deletion. No transaction is ever orphaned. */
export const deleteBankAccountsByIds = internalMutation({
  args: { ids: v.array(v.id('bankAccounts')) },
  handler: async (ctx, { ids }) => {
    const calte = await orgBySlug(ctx, 'calte')
    const deleted: Array<{
      _id: Id<'bankAccounts'>
      bankName: string
      label: string
    }> = []
    const skipped: Array<{
      id: Id<'bankAccounts'>
      reason: string
      bankName?: string
      label?: string
      txCount?: number
    }> = []
    for (const id of ids) {
      const a = await ctx.db.get("bankAccounts", id)
      if (!a) {
        skipped.push({ id, reason: 'not_found' })
        continue
      }
      if (a.orgId !== calte._id) {
        skipped.push({ id, reason: 'not_calte', bankName: a.bankName, label: a.label })
        continue
      }
      if (isCalteKeepAccount(a)) {
        skipped.push({ id, reason: 'keep_account', bankName: a.bankName, label: a.label })
        continue
      }
      const probe = await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) => q.eq('bankAccountId', id))
        .take(1)
      if (probe.length > 0) {
        const all = await ctx.db
          .query('transactions')
          .withIndex('by_account_date', (q) => q.eq('bankAccountId', id))
          .collect()
        skipped.push({
          id,
          reason: 'has_transactions',
          bankName: a.bankName,
          label: a.label,
          txCount: all.length,
        })
        continue
      }
      await ctx.db.delete("bankAccounts", id)
      deleted.push({ _id: id, bankName: a.bankName, label: a.label })
    }
    return { deleted, skipped }
  },
})

/** Deletion of Powens GHOST accounts (calte org) — created by an old stray
 * Powens connection (another project), before the id_user filter.
 *
 * Difference from `deleteBankAccountsByIds`: no `isCalteKeepAccount` guard
 * (which protects anything "PALATINE" by label and would block the Palatine
 * ghosts). Instead, a targeting that can ONLY match Powens ghosts:
 *   (a) calte org, AND
 *   (b) `airtableId` ABSENT (a real imported account has an airtableId), AND
 *   (c) `powensAccountId` PRESENT (Powens-originated account), AND
 *   (d) 0 attached transactions (counted live via `by_account_date`).
 * The real Airtable PALATINE has an airtableId → never matched. Qonto/HSBC
 * linked to Powens have transactions and/or an airtableId → never matched. */
export const deletePowensGhostAccounts = internalMutation({
  args: { ids: v.array(v.id('bankAccounts')) },
  handler: async (ctx, { ids }) => {
    const calte = await orgBySlug(ctx, 'calte')
    const deleted: Array<{
      _id: Id<'bankAccounts'>
      bankName: string
      label: string
    }> = []
    const skipped: Array<{
      id: Id<'bankAccounts'>
      reason: string
      bankName?: string
      label?: string
      txCount?: number
    }> = []
    for (const id of ids) {
      const a = await ctx.db.get("bankAccounts", id)
      if (!a) {
        skipped.push({ id, reason: 'not_found' })
        continue
      }
      if (a.orgId !== calte._id) {
        skipped.push({ id, reason: 'not_calte', bankName: a.bankName, label: a.label })
        continue
      }
      if (a.airtableId) {
        skipped.push({
          id,
          reason: 'has_airtable_id',
          bankName: a.bankName,
          label: a.label,
        })
        continue
      }
      if (!a.powensAccountId) {
        skipped.push({
          id,
          reason: 'no_powens_id',
          bankName: a.bankName,
          label: a.label,
        })
        continue
      }
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) => q.eq('bankAccountId', id))
        .collect()
      if (txs.length > 0) {
        skipped.push({
          id,
          reason: 'has_transactions',
          bankName: a.bankName,
          label: a.label,
          txCount: txs.length,
        })
        continue
      }
      await ctx.db.delete("bankAccounts", id)
      deleted.push({ _id: id, bankName: a.bankName, label: a.label })
    }
    return { deleted, skipped }
  },
})

// ─── Issuing: bank connection from the app (Powens Webview) ──────────────────

/** `type` param of `/auth/token/code`. Manual test: the endpoint returns a
 * valid code WITHOUT any param → we send none by default. Can be re-added
 * without a recommit by setting the `POWENS_CODE_TYPE` env var. */
function powensCodeType(): string | null {
  return process.env.POWENS_CODE_TYPE ?? null
}

/** Auth + role for `startBankConnection`. Connecting a bank = sensitive
 * action → admin (owner included). Actions have no `ctx.db` → goes through
 * this internalQuery (actionAuthProbe pattern from convex/chat.ts). */
export const powensAuthProbe = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgRole(ctx, orgId, 'admin')
    return { ok: true as const }
  },
})

/** An org's permanent Powens token (or null). INTERNAL — never expose to the
 * front end (authToken = secret). */
export const getOrgPowensToken = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const row = await ctx.db
      .query('powensUsers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .unique()
    if (!row) return null
    return { powensUserId: row.powensUserId, authToken: row.authToken }
  },
})

/** Idempotent upsert of an org's Powens user. If a row already exists, we
 * KEEP it (no overwrite) — avoids duplicates on double-click. */
export const savePowensUser = internalMutation({
  args: {
    orgId: v.id('organizations'),
    powensUserId: v.string(),
    authToken: v.string(),
  },
  handler: async (ctx, { orgId, powensUserId, authToken }) => {
    const existing = await ctx.db
      .query('powensUsers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .unique()
    if (existing) return existing._id
    return ctx.db.insert('powensUsers', {
      orgId,
      powensUserId,
      authToken,
      createdAt: Date.now(),
    })
  },
})

function powensEnv() {
  const clientId = process.env.POWENS_CLIENT_ID
  const clientSecret = process.env.POWENS_CLIENT_SECRET
  const domain = process.env.POWENS_DOMAIN
  const redirectUri = process.env.POWENS_REDIRECT_URI
  if (!clientId || !clientSecret || !domain || !redirectUri) {
    throw new ConvexError('powens_env_missing')
  }
  return { clientId, clientSecret, domain, redirectUri }
}

/** Creates (or reuses) the org's permanent Powens user, generates a temporary
 * code and returns the Powens Webview URL to open on the front end.
 *
 * Security: the `client_secret` and the permanent token stay server-side.
 * The front end ONLY receives `webviewUrl` (which contains the temporary,
 * non-sensitive `code`). No secret is included in error messages or logged. */
export const startBankConnection = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<{ webviewUrl: string }> => {
    await ctx.runQuery(internal.powens.powensAuthProbe, { orgId })
    const { clientId, clientSecret, domain, redirectUri } = powensEnv()
    const base = `https://${domain}/2.0`

    // 1. Permanent token: reuse the org's, otherwise /auth/init.
    let authToken: string
    const existing = await ctx.runQuery(internal.powens.getOrgPowensToken, {
      orgId,
    })
    if (existing) {
      authToken = existing.authToken
    } else {
      const initRes = await fetch(`${base}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })
      if (!initRes.ok) {
        throw new ConvexError(`powens_init_failed:${initRes.status}`)
      }
      const init = (await initRes.json()) as {
        auth_token?: string
        id_user?: number
      }
      if (!init.auth_token || init.id_user == null) {
        throw new ConvexError('powens_init_malformed')
      }
      authToken = init.auth_token
      await ctx.runMutation(internal.powens.savePowensUser, {
        orgId,
        powensUserId: String(init.id_user),
        authToken,
      })
    }

    // 2. Temporary code (Bearer auth with the permanent token). No `type`
    // param by default (cf. powensCodeType).
    const codeUrl = new URL(`${base}/auth/token/code`)
    const codeType = powensCodeType()
    if (codeType) codeUrl.searchParams.set('type', codeType)
    const codeRes = await fetch(codeUrl.toString(), {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!codeRes.ok) {
      throw new ConvexError(`powens_code_failed:${codeRes.status}`)
    }
    const codeJson = (await codeRes.json()) as { code?: string }
    if (!codeJson.code) throw new ConvexError('powens_code_malformed')

    // 3. Webview URL (the code is not sensitive).
    const url = new URL('https://webview.powens.com/connect')
    url.searchParams.set('domain', domain)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', codeJson.code)
    return { webviewUrl: url.toString() }
  },
})

/** Resets a Qonto account's Powens link: sets `powensAccountId` and `iban`
 * back to `undefined`. Useful to purge residue from an expired temporary
 * Powens user (otherwise the account stays "taken" → the webhooks of the
 * new connection are ignored as `qonto_already_linked`).
 *
 * Guard: only acts if the account belongs to the calte org AND has
 * `bankName ≈ 'Qonto'`. Touches nothing else (not the transactions).
 * Returns the before/after state. Run by the operator via `convex run --prod`. */
export const resetQontoPowensLink = internalMutation({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get("bankAccounts", bankAccountId)
    if (!account) throw new ConvexError('account_not_found')
    const calte = await orgBySlug(ctx, 'calte')
    if (account.orgId !== calte._id) throw new ConvexError('not_calte')
    if (!normalizeName(account.bankName).includes('qonto')) {
      throw new ConvexError('not_qonto')
    }
    const before = {
      powensAccountId: account.powensAccountId ?? null,
      iban: account.iban ?? null,
    }
    await ctx.db.patch("bankAccounts", bankAccountId, {
      powensAccountId: undefined,
      iban: undefined,
    })
    return {
      bankAccountId,
      bankName: account.bankName,
      label: account.label,
      before,
      after: { powensAccountId: null, iban: null },
    }
  },
})

/** Deletes an org's Powens user (`powensUsers` row). Use case: rotating a
 * leaked authToken — the user is deleted on the Powens side, then this
 * mutation clears the row in the database so that `startBankConnection`
 * recreates a clean user (via /auth/init) on the next click. If no row, no-op.
 * Run by the operator via `convex run --prod`. */
export const deletePowensUser = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const row = await ctx.db
      .query('powensUsers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .unique()
    if (!row) return { deleted: false, powensUserId: null }
    await ctx.db.delete("powensUsers", row._id)
    return { deleted: true, powensUserId: row.powensUserId }
  },
})

// ─── One-shot historical Mémo Bank CSV import (albo org) ─────────────────────

const memoCsvRowValidator = v.object({
  memoId: v.string(),
  powensAccountId: v.string(), // target account (33 or 34), resolved to bankAccountId
  iban: v.optional(v.string()),
  amount: v.number(), // cents, positive
  direction: v.union(v.literal('in'), v.literal('out')),
  transactionDate: v.number(), // ms epoch UTC
  rawLabel: v.string(),
  counterparty: v.optional(v.string()),
  type: v.optional(v.string()),
  category: v.optional(v.string()),
  externalRef: v.optional(v.string()),
  source: v.optional(v.string()), // ignored (always 'memo_csv' on write)
})

/** One-shot import of the Mémo Bank CSV history into `transactions`.
 *
 * - Resolves each row to its account via `powensAccountId` (index
 *   `by_powens_account`); the account must belong to the albo org.
 * - Strict idempotency by `memoId` (index `by_memo_id`): if a transaction
 *   with this memoId already exists → skip, never a duplicate. Replayable.
 * - `source: 'memo_csv'`, amounts already in cents (positive).
 * - `type`/`category`/`externalRef` → dedicated `importMeta` field (CSV
 *   origin metadata, useful for future matching/agent work). `notes` stays
 *   EMPTY — it is reserved for manual matching. `iban` from the JSON: ignored.
 *
 * Run (562 rows → go through a JSON file, not the command line):
 *   pnpm exec convex run --prod powens:importMemoCsvTransactions \
 *     "$(cat memo-transactions.json)"
 *   where memo-transactions.json = {"rows":[ … ]}
 */
export const importMemoCsvTransactions = internalMutation({
  args: { rows: v.array(memoCsvRowValidator) },
  handler: async (ctx, { rows }) => {
    const albo = await orgBySlug(ctx, 'albo')

    // Target account resolution (few distinct accounts → small cache).
    const accountByPowensId = new Map<string, Doc<'bankAccounts'>>()
    async function resolveTargetAccount(
      powensAccountId: string,
    ): Promise<Doc<'bankAccounts'> | null> {
      const cached = accountByPowensId.get(powensAccountId)
      if (cached) return cached
      const account = await ctx.db
        .query('bankAccounts')
        .withIndex('by_powens_account', (q) =>
          q.eq('powensAccountId', powensAccountId),
        )
        .unique()
      if (!account || account.orgId !== albo._id) return null
      accountByPowensId.set(powensAccountId, account)
      return account
    }

    let inserted = 0
    const skipped: Array<{ memoId: string; reason: string }> = []
    for (const row of rows) {
      // Strict idempotency by memoId.
      const existing = await ctx.db
        .query('transactions')
        .withIndex('by_memo_id', (q) => q.eq('memoId', row.memoId))
        .first()
      if (existing) {
        skipped.push({ memoId: row.memoId, reason: 'already_imported' })
        continue
      }

      const account = await resolveTargetAccount(row.powensAccountId)
      if (!account) {
        skipped.push({
          memoId: row.memoId,
          reason: `account_not_found:${row.powensAccountId}`,
        })
        continue
      }

      if (row.amount <= 0 || !Number.isInteger(row.amount)) {
        skipped.push({ memoId: row.memoId, reason: 'invalid_amount' })
        continue
      }

      // CSV origin metadata → dedicated `importMeta` field, never `notes`
      // (reserved for manual matching). Omitted if all empty.
      const meta = {
        type: row.type || undefined,
        category: row.category || undefined,
        externalRef: row.externalRef || undefined,
      }
      const hasMeta = meta.type || meta.category || meta.externalRef

      await ctx.db.insert('transactions', {
        orgId: albo._id,
        bankAccountId: account._id,
        direction: row.direction,
        amount: row.amount,
        transactionDate: row.transactionDate,
        rawLabel: row.rawLabel,
        counterparty: row.counterparty,
        searchText: buildSearchText(row.rawLabel, row.counterparty),
        source: 'memo_csv',
        memoId: row.memoId,
        importMeta: hasMeta ? meta : undefined,
        reconciled: false,
        matchStatus: 'unmatched' as const,
      })
      inserted += 1
    }
    return { inserted, skipped: skipped.length, skippedDetails: skipped }
  },
})
