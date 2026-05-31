/**
 * Ingestion Powens → Convex (bankAccounts + transactions).
 *
 * La connexion des banques (login + auth forte) se fait hors-app via le Powens
 * Webview. Ici on traite l'APRÈS : le webhook `CONNECTION_SYNCED` de Powens
 * pousse les comptes + transactions, on les écrit idempotemment et scopés à
 * l'org.
 *
 * Flux : `powensWebhook` (httpAction, vérif HMAC + normalisation du payload)
 *   → `ingestConnectionSync` (internalMutation : résolution du compte, cutover
 *   par compte, upsert idempotent par `powensTxId`).
 *
 * Sécurité du webhook : signature HMAC-SHA256 (headers `BI-Signature` +
 * `BI-Signature-Date`) vérifiée via Web Crypto (`crypto.subtle.verify`).
 * Le runtime Convex n'expose pas `crypto.timingSafeEqual` de Node ;
 * `crypto.subtle.verify` est l'équivalent constant-time. Cf. KNOWN_ISSUES.md.
 *
 * Mapping connecteur → entité propriétaire : comptes neufs uniquement. Qonto
 * n'y figure pas : il est rapproché du record existant (importé d'Airtable).
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { httpAction, internalMutation, internalQuery } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/** Doit correspondre EXACTEMENT au chemin de l'URL webhook configurée chez
 * Powens (sans slash final) : le HMAC est calculé dessus. */
const WEBHOOK_PATH = '/powens/webhook'

/** Connecteur Powens (nom normalisé, match par inclusion) → org + entité
 * `group_*` propriétaire, pour la CRÉATION d'un compte neuf. Qonto exclu. */
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

/** Type de compte Powens → `accountKind` maison. Défaut : type Powens brut. */
const ACCOUNT_KIND: Record<string, string> = {
  checking: 'checking',
  savings: 'savings',
  deposit: 'dat',
  market: 'cto',
}

// ─── Helpers de normalisation (payload Powens = JSON non typé) ───────────────

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

function matchConnector(normalizedConnector: string) {
  return (
    CONNECTOR_OWNER.find((e) => normalizedConnector.includes(e.match)) ?? null
  )
}
function mapAccountKind(type: string | undefined): string | undefined {
  if (!type) return undefined
  return ACCOUNT_KIND[type] ?? type
}

// ─── Forme normalisée (frontière action → mutation) ──────────────────────────

const normTxValidator = v.object({
  powensTxId: v.string(),
  valueUnits: v.number(), // unité monétaire signée (ex: -56.78)
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
  balanceUnits: v.optional(v.number()), // unité monétaire signée
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
  accounts: Array<NormAccount>
} {
  const root = asRecord(payload)
  // Tolère un payload au niveau racine OU enveloppé dans `connection`.
  const connection = root.connection != null ? asRecord(root.connection) : root
  const connector = asRecord(connection.connector)
  const connectorName =
    asString(connector.name) ?? asString(connector.uuid) ?? ''
  const connectionId =
    asIdStr(connection.id) ?? asIdStr(root.id_connection) ?? ''
  const accounts = asArray(connection.accounts)
    .map((a) => normalizeAccount(a, connectorName))
    .filter((a): a is NormAccount => a !== null)
  return { connectionId, accounts }
}

// ─── Vérification de signature HMAC ──────────────────────────────────────────

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

// ─── Résolution du compte + ingestion (mutation interne) ─────────────────────

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

/** Records Qonto éligibles au match automatique : non encore liés à Powens ET
 * non archivés. C'est ce lot qui doit valoir exactement 1. */
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

/** Tx `manual` sans `airtableId` sur les comptes Qonto donnés (lignes de test
 * potentielles). */
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

/** Rapproche un compte Powers Qonto du record existant (importé d'Airtable).
 * Match par IBAN si le record en a un, sinon par unicité du `bankName='Qonto'`
 * (l'import Airtable ne stocke pas l'IBAN) avec backfill de l'IBAN. Arrêt dur
 * si 0 ou >1 candidat — jamais de doublon. */
async function linkQonto(
  ctx: MutationCtx,
  acc: NormAccount,
  connectionId: string,
): Promise<Doc<'bankAccounts'>> {
  const candidates = eligibleQontoCandidates(await qontoAccountsOfCalte(ctx))
  if (candidates.length !== 1) throw new ConvexError('qonto_match_ambiguous')
  const qonto = candidates[0]
  if (
    qonto.iban &&
    acc.iban &&
    normalizeIban(qonto.iban) !== normalizeIban(acc.iban)
  ) {
    throw new ConvexError('qonto_iban_mismatch')
  }
  await ctx.db.patch(qonto._id, {
    powensConnectionId: connectionId,
    powensAccountId: acc.powensAccountId,
    iban: qonto.iban ?? acc.iban,
    ...balancePatch(acc),
  })
  const refreshed = await ctx.db.get(qonto._id)
  if (!refreshed) throw new ConvexError('account_vanished')
  return refreshed
}

async function resolveAccount(
  ctx: MutationCtx,
  connectionId: string,
  acc: NormAccount,
): Promise<Doc<'bankAccounts'>> {
  // 1. Déjà lié par powensAccountId → on réutilise (maj du solde).
  const linked = await ctx.db
    .query('bankAccounts')
    .withIndex('by_powens_account', (q) =>
      q.eq('powensAccountId', acc.powensAccountId),
    )
    .first()
  if (linked) {
    await ctx.db.patch(linked._id, balancePatch(acc))
    const refreshed = await ctx.db.get(linked._id)
    if (!refreshed) throw new ConvexError('account_vanished')
    return refreshed
  }

  const connector = normalizeName(acc.connectorName)

  // 2. Match Qonto existant.
  if (connector.includes('qonto')) {
    return linkQonto(ctx, acc, connectionId)
  }

  // 3. Compte neuf via le mapping connecteur → entité.
  const mapping = matchConnector(connector)
  if (!mapping) {
    throw new ConvexError(`unmapped_powens_account:${acc.connectorName}`)
  }
  const org = await orgBySlug(ctx, mapping.orgSlug)
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
  const created = await ctx.db.get(id)
  if (!created) throw new ConvexError('account_create_failed')
  return created
}

/** Borne de cutover par compte (aucun stockage) :
 * - Qonto (record Airtable, a `airtableId`) → date de sa dernière tx d'origine
 *   Airtable ; on n'ingère que ce qui est strictement postérieur.
 * - Compte neuf → `_creationTime` (≈ date de connexion). */
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
    accounts: v.array(normAccountValidator),
  },
  handler: async (ctx, { connectionId, accounts }) => {
    const summary = { inserted: 0, patched: 0, skipped: 0 }
    for (const acc of accounts) {
      const account = await resolveAccount(ctx, connectionId, acc)
      const cutoff = await computeCutoff(ctx, account)
      for (const tx of acc.transactions) {
        if (tx.deleted || tx.dateMs <= cutoff) {
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
          source: 'powens' as const,
          reconciled: false,
          powensTxId: tx.powensTxId,
        }
        if (existing) {
          await ctx.db.patch(existing._id, fields)
          summary.patched += 1
        } else {
          await ctx.db.insert('transactions', fields)
          summary.inserted += 1
        }
      }
    }
    return summary
  },
})

// ─── Nettoyage Qonto (lignes de test) — opérateur via `convex run --prod` ─────

/** Read-only : tx du Qonto où `source='manual'` ET pas d'`airtableId`.
 * Interne → pas de garde auth (lancée en CLI avec deploy key). */
export const listQontoTestTransactions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return qontoTestTxRows(ctx, await qontoAccountsOfCalte(ctx))
  },
})

/** Read-only : diagnostic pré-go-live du match Qonto. Liste tous les
 * `bankAccounts` Qonto-ish de calte (avec l'état des champs clés), compte les
 * candidats éligibles (non liés + non archivés) — qui doit valoir exactement 1
 * — et joint les tx de test (`manual` sans `airtableId`) qui pourraient
 * expliquer un record en trop. N'écrit rien. */
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

/** Suppression ciblée, garde-fou strict : ne supprime QUE les tx `manual` sans
 * `airtableId` rattachées à un compte Qonto de calte. Tout le reste est skip. */
export const deleteTransactionsByIds = internalMutation({
  args: { ids: v.array(v.id('transactions')) },
  handler: async (ctx, { ids }) => {
    const qontoIds = new Set(
      (await qontoAccountsOfCalte(ctx)).map((a) => a._id),
    )
    let deleted = 0
    const skipped: Array<{ id: Id<'transactions'>; reason: string }> = []
    for (const id of ids) {
      const t = await ctx.db.get(id)
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
      await ctx.db.delete(id)
      deleted += 1
    }
    return { deleted, skipped }
  },
})
