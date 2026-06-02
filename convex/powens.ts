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
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { requireOrgRole } from './lib/auth'
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
/** Comme `normalizeName` mais collapse aussi les espaces internes — pour
 * comparer des libellés multi-mots ("Neuflize OBC - Compte à terme"). */
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
  powensUserId: string | undefined
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
  // Id du user Powens propriétaire de la connexion. Doc CONNECTION_SYNCED :
  // `connection.id_user` (Connection object) et `user.id` (User object racine).
  const powensUserId =
    asIdStr(connection.id_user) ??
    asIdStr(asRecord(root.user).id) ??
    asIdStr(root.id_user)
  const accounts = asArray(connection.accounts)
    .map((a) => normalizeAccount(a, connectorName))
    .filter((a): a is NormAccount => a !== null)
  return { connectionId, powensUserId, accounts }
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
 * (l'import Airtable ne stocke pas l'IBAN) avec backfill de l'IBAN.
 *
 * Cas séparés (ne pas confondre) :
 * - 0 candidat éligible = le(s) Qonto de calte sont DÉJÀ liés à un autre
 *   `powensAccountId` (webhook re-sync redondant d'une autre connexion/user
 *   Powens). On garde le premier match comme source de vérité → warning
 *   `qonto_already_linked` + on ignore ce compte (return null, pas d'erreur).
 * - ≥2 candidats = vraie ambiguïté → `qonto_match_ambiguous` (arrêt dur). */
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

/** Résout le `bankAccounts` cible d'un compte du payload. Renvoie `null` si le
 * compte doit être ignoré (cas `qonto_already_linked`, cf. linkQonto).
 *
 * `org` = l'org du user Powens matché (source de vérité de « à qui appartient
 * cette connexion ») : c'est elle qui scope l'écriture. Le mapping
 * connecteur→entité ne sert qu'à choisir l'entité propriétaire et doit
 * concorder avec cette org (sinon erreur visible, pas d'écriture muette). */
async function resolveAccount(
  ctx: MutationCtx,
  connectionId: string,
  acc: NormAccount,
  org: Doc<'organizations'>,
): Promise<Doc<'bankAccounts'> | null> {
  // 1. Déjà lié par powensAccountId → on réutilise (maj du solde).
  const linked = await ctx.db
    .query('bankAccounts')
    .withIndex('by_powens_account', (q) =>
      q.eq('powensAccountId', acc.powensAccountId),
    )
    .first()
  if (linked) {
    // Cohérence : le compte lié doit appartenir à l'org du user Powens.
    if (linked.orgId !== org._id) {
      console.warn(
        `[powens] compte acct ${acc.powensAccountId} déjà lié à une autre org ` +
          `que celle du user Powens (${org.slug}) — ignoré`,
      )
      return null
    }
    await ctx.db.patch(linked._id, balancePatch(acc))
    const refreshed = await ctx.db.get(linked._id)
    if (!refreshed) throw new ConvexError('account_vanished')
    return refreshed
  }

  const connector = normalizeName(acc.connectorName)

  // 2. Match Qonto existant (le record vit dans l'org calte).
  if (connector.includes('qonto')) {
    if (org.slug !== 'calte') {
      throw new ConvexError(`connector_org_mismatch:qonto:${org.slug}`)
    }
    return linkQonto(ctx, acc, connectionId)
  }

  // 3. Compte neuf via le mapping connecteur → entité, scopé à l'org du user.
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
    powensUserId: v.optional(v.string()),
    accounts: v.array(normAccountValidator),
  },
  handler: async (ctx, { connectionId, powensUserId, accounts }) => {
    const summary = { inserted: 0, patched: 0, skipped: 0 }

    // ── Filtre par user Powens : seuls les users gérés par Albo OS sont
    // ingérés. Les connexions d'autres projets (vieux users non gérés)
    // re-syncent encore et pollueraient la base.
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
    // L'org du user Powens matché = source de vérité du scope d'écriture.
    const org = await ctx.db.get(powensUser.orgId)
    if (!org) throw new ConvexError('powens_user_org_not_found')

    console.log(
      `[powens] webhook connection=${connectionId} (user ${powensUserId} → org ${org.slug}): ` +
        `${accounts.length} compte(s) dans le payload`,
    )
    for (const acc of accounts) {
      const account = await resolveAccount(ctx, connectionId, acc, org)
      if (!account) {
        // Compte ignoré (qonto_already_linked) — ses tx ne sont pas ingérées.
        summary.skipped += acc.transactions.length
        continue
      }
      const cutoff = await computeCutoff(ctx, account)
      // Diagnostic : d'où vient la borne (sans changer computeCutoff).
      const cutoffSource =
        cutoff === account._creationTime
          ? '_creationTime'
          : 'dernière tx Airtable'
      // Compteurs par compte (alimentent le log ; summary global inchangé).
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
          source: 'powens' as const,
          powensTxId: tx.powensTxId,
        }
        if (existing) {
          // Re-livraison webhook : ne pas écraser l'état de pointage
          // (matchStatus / dealId / reconciled) déjà posé sur la ligne.
          await ctx.db.patch(existing._id, fields)
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

/** Read-only : pour chaque `bankAccounts` de calte, le nombre de transactions
 * rattachées (via `by_account_date`) + une décision keep/delete (même règle que
 * la suppression : `isCalteKeepAccount`). Trié par nombre de tx décroissant :
 * en haut, les comptes-à-supprimer avec des mouvements (migration délicate) ;
 * en bas (txCount 0), suppression triviale. N'écrit rien. */
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

/** Comptes calte à CONSERVER lors du nettoyage `bankAccounts`. Résolu live :
 * par `label`/`bankName` (normalisés) OU par la sentinelle `airtableId` d'import
 * (la ligne "mouvement sans banque"). Garde-fou : un compte reconnu "keep"
 * n'est jamais supprimé, même si son id est passé en entrée par erreur. */
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

/** Suppression ciblée de `bankAccounts` (org calte), garde-fous stricts dans
 * cet ordre : (a) le compte appartient à calte, (b) ce n'est PAS un compte à
 * conserver (résolu live), (c) il a 0 transaction rattachée (vérif live via
 * `by_account_date`). Toute condition non remplie → skip + report, jamais de
 * suppression. Aucune transaction n'est jamais rendue orpheline. */
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
      const a = await ctx.db.get(id)
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
      await ctx.db.delete(id)
      deleted.push({ _id: id, bankName: a.bankName, label: a.label })
    }
    return { deleted, skipped }
  },
})

/** Suppression de comptes FANTÔMES Powens (org calte) — créés par une vieille
 * connexion Powens parasite (autre projet), avant le filtre par id_user.
 *
 * Différence avec `deleteBankAccountsByIds` : pas de garde `isCalteKeepAccount`
 * (qui protège tout "PALATINE" par label et bloquerait les fantômes Palatine).
 * À la place, un ciblage qui ne peut matcher QUE des fantômes Powens :
 *   (a) org calte, ET
 *   (b) `airtableId` ABSENT (un vrai compte importé a un airtableId), ET
 *   (c) `powensAccountId` PRÉSENT (compte d'origine Powens), ET
 *   (d) 0 transaction rattachée (compté live via `by_account_date`).
 * Le vrai PALATINE Airtable a un airtableId → jamais matché. Qonto/HSBC liés à
 * Powens ont des transactions et/ou un airtableId → jamais matchés. */
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
      const a = await ctx.db.get(id)
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
      await ctx.db.delete(id)
      deleted.push({ _id: id, bankName: a.bankName, label: a.label })
    }
    return { deleted, skipped }
  },
})

// ─── Émission : connexion bancaire depuis l'app (Webview Powens) ─────────────

/** Param `type` de `/auth/token/code`. Test manuel : l'endpoint renvoie un code
 * valide SANS aucun param → on n'en envoie pas par défaut. Réajout possible sans
 * recommit en posant l'env var `POWENS_CODE_TYPE`. */
function powensCodeType(): string | null {
  return process.env.POWENS_CODE_TYPE ?? null
}

/** Auth + rôle pour `startBankConnection`. Connecter une banque = action
 * sensible → admin (owner inclus). Action sans `ctx.db` → passe par cette
 * internalQuery (pattern actionAuthProbe de convex/chat.ts). */
export const powensAuthProbe = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgRole(ctx, orgId, 'admin')
    return { ok: true as const }
  },
})

/** Token permanent Powens d'une org (ou null). INTERNE — ne jamais exposer au
 * front (authToken = secret). */
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

/** Upsert idempotent du user Powens d'une org. Si une ligne existe déjà, on la
 * GARDE (pas d'écrasement) — évite les doublons sur double-clic. */
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

/** Crée (ou réutilise) le user Powens permanent de l'org, génère un code
 * temporaire et renvoie l'URL du Webview Powens à ouvrir côté front.
 *
 * Sécurité : le `client_secret` et le token permanent restent côté serveur.
 * Le front ne reçoit QUE `webviewUrl` (qui contient le `code` temporaire, non
 * sensible). Aucun secret n'est inclus dans les messages d'erreur ni loggé. */
export const startBankConnection = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<{ webviewUrl: string }> => {
    await ctx.runQuery(internal.powens.powensAuthProbe, { orgId })
    const { clientId, clientSecret, domain, redirectUri } = powensEnv()
    const base = `https://${domain}/2.0`

    // 1. Token permanent : réutilise celui de l'org, sinon /auth/init.
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

    // 2. Code temporaire (auth Bearer avec le token permanent). Pas de param
    // `type` par défaut (cf. powensCodeType).
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

    // 3. URL du Webview (le code n'est pas sensible).
    const url = new URL('https://webview.powens.com/connect')
    url.searchParams.set('domain', domain)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', codeJson.code)
    return { webviewUrl: url.toString() }
  },
})

/** Réinitialise le lien Powens d'un compte Qonto : remet `powensAccountId` et
 * `iban` à `undefined`. Utile pour purger des résidus d'un user Powens
 * temporaire expiré (sinon le compte reste « pris » → les webhooks de la
 * nouvelle connexion sont ignorés en `qonto_already_linked`).
 *
 * Garde-fou : n'agit QUE si le compte appartient à l'org calte ET a
 * `bankName ≈ 'Qonto'`. Ne touche à rien d'autre (pas aux transactions).
 * Renvoie l'état avant/après. Lancée par l'opérateur via `convex run --prod`. */
export const resetQontoPowensLink = internalMutation({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get(bankAccountId)
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
    await ctx.db.patch(bankAccountId, {
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

/** Supprime le user Powens d'une org (ligne `powensUsers`). Cas d'usage :
 * rotation d'un authToken qui a fuité — le user est supprimé côté Powens, puis
 * cette mutation vide la ligne en base pour que `startBankConnection` recrée un
 * user propre (via /auth/init) au prochain clic. Si aucune ligne, no-op.
 * Lancée par l'opérateur via `convex run --prod`. */
export const deletePowensUser = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const row = await ctx.db
      .query('powensUsers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .unique()
    if (!row) return { deleted: false, powensUserId: null }
    await ctx.db.delete(row._id)
    return { deleted: true, powensUserId: row.powensUserId }
  },
})

// ─── Import one-shot historique CSV Mémo Bank (org albo) ─────────────────────

const memoCsvRowValidator = v.object({
  memoId: v.string(),
  powensAccountId: v.string(), // compte cible (33 ou 34), résolu en bankAccountId
  iban: v.optional(v.string()),
  amount: v.number(), // cents, positif
  direction: v.union(v.literal('in'), v.literal('out')),
  transactionDate: v.number(), // ms epoch UTC
  rawLabel: v.string(),
  counterparty: v.optional(v.string()),
  type: v.optional(v.string()),
  category: v.optional(v.string()),
  externalRef: v.optional(v.string()),
  source: v.optional(v.string()), // ignoré (toujours 'memo_csv' à l'écriture)
})

/** Import one-shot de l'historique CSV Mémo Bank dans `transactions`.
 *
 * - Résout chaque ligne vers son compte via `powensAccountId` (index
 *   `by_powens_account`) ; le compte doit appartenir à l'org albo.
 * - Idempotence stricte par `memoId` (index `by_memo_id`) : si une transaction
 *   avec ce memoId existe déjà → skip, jamais de doublon. Rejouable.
 * - `source: 'memo_csv'`, montants déjà en centimes (positifs).
 * - `type`/`category`/`externalRef` → champ dédié `importMeta` (métadonnées
 *   d'origine CSV, utiles au futur pointage/agent). `notes` reste VIDE — il est
 *   réservé au pointage manuel. `iban` du JSON : ignoré.
 *
 * Lancement (562 lignes → passer par un fichier JSON, pas la ligne de commande) :
 *   pnpm exec convex run --prod powens:importMemoCsvTransactions \
 *     "$(cat memo-transactions.json)"
 *   où memo-transactions.json = {"rows":[ … ]}
 */
export const importMemoCsvTransactions = internalMutation({
  args: { rows: v.array(memoCsvRowValidator) },
  handler: async (ctx, { rows }) => {
    const albo = await orgBySlug(ctx, 'albo')

    // Résolution des comptes cibles (peu de comptes distincts → petit cache).
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
      // Idempotence stricte par memoId.
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

      // Métadonnées d'origine CSV → champ dédié `importMeta`, jamais `notes`
      // (réservé au pointage manuel). Omis si toutes vides.
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
        source: 'memo_csv',
        memoId: row.memoId,
        importMeta: hasMeta ? meta : undefined,
        reconciled: false,
      })
      inserted += 1
    }
    return { inserted, skipped: skipped.length, skippedDetails: skipped }
  },
})
