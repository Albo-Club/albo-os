/**
 * Import one-shot Airtable → Convex (cf. plan migration).
 *
 * Base Airtable `appVRf06AHghMkPZG`. Rattaché à l'org `calte`. Idempotent via
 * le champ `airtableId` (index `by_airtable_id`) sur chaque table cible.
 *
 * Lancer (prod) :
 *   pnpm exec convex export --prod                 # snapshot de secours
 *   pnpm exec convex env set AIRTABLE_API_KEY pat… # PAT Airtable (scope data.records:read)
 *   pnpm exec convex run --prod airtableImport:runImport
 *
 * Dérivations clés :
 * - deals = (Entreprise × instrumentKind) agrégés depuis Mouvement.
 * - transactions = Mouvement 1:1 (rattachées au deal quand non-opérationnel).
 * - L'import s'ARRÊTE sur toute valeur `Type d'invest` non mappée.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { Infer } from 'convex/values'

const BASE_ID = 'appVRf06AHghMkPZG'

const TBL = {
  mouvement: 'tblHIIStZuMqeGyHF',
  entreprise: 'tblqBCvroOLbylsjV',
  compte: 'tblQ1LRm1htMfu9QD',
  prevRentree: 'tblmZ3N5zM40u9U8d',
  prevSortie: 'tbluFDWnD0N9aljdw',
} as const

// Field IDs (returnFieldsByFieldId=true) — stables, robustes aux renommages.
const F = {
  mv: {
    nom: 'fldCCsGSP18hIT2po',
    typeMouvement: 'fldlMrueLjJYEOo8p', // Crédit / Débit
    montantCredit: 'fldnmtVfo3NYUgq2G',
    montantInvesti: 'fldvMLnUYOiFUiOKg',
    date: 'fldGvSOWlC5kQI6yk',
    societe: 'flddhL8TBS3AkxeiO', // link → Entreprise
    banque: 'fldR0j08finj46YQ2', // link → Compte Bancaire
    typeInvest: 'fld31GW7jkTZFDu82', // multipleSelects
    statut: 'fldYyRY3cFs8UNLrc',
    nbAction: 'fldN0AvuVPZaNSEYR',
    remarque: 'fldIoA0P73TDzLtEp',
    pointe: 'fldG2ONAAp2y6EopA',
  },
  ent: {
    nom: 'fldbd8oZDQusweHA7',
    totalShares: 'fldS8oNFCpRYxTauy',
    domaine: 'fldD2jcFTHFLmcbGL',
    valoRentre: 'fldRQv0QXm1gbNkSn',
    valoActuelle: 'fld9umK1IMwScbxeP',
    impact: 'fldRPLVpGpPH1JriF',
    termine: 'fldFGgAbvU38sAHUy',
  },
  cb: {
    bank: 'fld0TKxb16ImfZLxH',
    balance: 'fldO4iMFaa7SnjmTW',
    lastUpdate: 'fld9HrR1tTC2gj50u',
    remarque: 'fldkbqDKMwAV9i7jc',
  },
  pr: {
    name: 'fldANDcGeFakTfLi9',
    entreprise: 'fldauePYa36y03jVc',
    amount: 'fldwZPbzQgHDSYdSJ',
    date: 'fldzA7CneptIOPkeA',
  },
  ps: {
    name: 'fldItdlYiTTtzrans',
    entreprise: 'fldiaOYgehPHGfI0v',
    amount: 'fldEFpkRUuqMyaCX2',
    date: 'fldHgHLFiDcRu1JjT',
  },
} as const

// Sentinelles idempotence.
const SENTINEL_INVESTOR = '__import_investor__'
const SENTINEL_BANK = '__unassigned_bank__'

// ─── Mapping Type d'invest → instrumentKind (clés trimées) ──────────────────

const INSTRUMENT_MAP: Record<string, string> = {
  Actions: 'share',
  'Titres de participations': 'share',
  BSA: 'bsa',
  'BSA Air': 'bsa_air',
  Safe: 'safe',
  Obligations: 'os',
  'Obligations Convertibles': 'oc',
  CCA: 'cca',
  Royalties: 'royalty',
  SCPI: 'scpi',
  FCPI: 'fund_lp',
  'FOND INVEST': 'fund_lp',
  'Fond Invest': 'fund_lp',
  fonds: 'fund_lp',
  Fonds: 'fund_lp',
  Cryptomonaie: 'crypto',
  Immobilier: 'real_estate_direct',
  SCI: 'real_estate_direct',
  Prêt: 'loan',
  'Compte de Capitalisation': 'capitalization_account',
}

// Types non-investissement : transaction sans deal (pas d'erreur).
const OPERATIONAL = new Set([
  'Cash',
  'Don',
  'Impot',
  'Honoraires',
  'Virement Compte à Compte',
  'Nantissement',
])

// `sharesAcquired` n'a de sens que pour les instruments « share-like ».
// Pour la dette (os/oc/loan…) le « Nb d'action » Airtable est un nominal, pas
// un nombre de titres → on ne le mappe pas.
const SHARE_LIKE = new Set(['share', 'spv_share', 'secondary', 'scpi'])

const instrumentValidator = v.union(
  v.literal('share'),
  v.literal('bsa'),
  v.literal('bsa_air'),
  v.literal('safe'),
  v.literal('oc'),
  v.literal('os'),
  v.literal('convertible_note'),
  v.literal('cca'),
  v.literal('royalty'),
  v.literal('fund_lp'),
  v.literal('spv_share'),
  v.literal('secondary'),
  v.literal('real_estate_direct'),
  v.literal('scpi'),
  v.literal('cto'),
  v.literal('dat'),
  v.literal('crypto'),
  v.literal('loan'),
  v.literal('capitalization_account'),
)
type Instrument = Infer<typeof instrumentValidator>

const statusValidator = v.union(
  v.literal('active'),
  v.literal('partially_exited'),
  v.literal('fully_exited'),
  v.literal('written_off'),
)
type DealStatus = Infer<typeof statusValidator>

// ─── Helpers de transformation (côté action) ────────────────────────────────

const eurToCents = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : undefined

/** "2025-07-14" ou ISO → ms epoch UTC. */
const parseDate = (s: unknown): number | undefined => {
  if (typeof s !== 'string' || !s) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

const STATUS_MAP: Record<string, string> = {
  Actif: 'active',
  Exit: 'fully_exited',
  'Exit partiel': 'partially_exited',
  Dead: 'written_off',
}

const chunk = <T>(arr: Array<T>, size: number): Array<Array<T>> => {
  const out: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Classe les `Type d'invest` d'un mouvement : retourne le 1er instrument mappé
 * (ou undefined si purement opérationnel / vide). THROW sur valeur inconnue.
 */
function classifyInvest(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined
  let instrument: string | undefined
  for (const v0 of raw) {
    const name = String(v0).trim()
    if (!name) continue
    if (name in INSTRUMENT_MAP) {
      instrument = instrument ?? INSTRUMENT_MAP[name]
    } else if (!OPERATIONAL.has(name)) {
      throw new ConvexError(`unknown_invest_type:${name}`)
    }
  }
  return instrument
}

// ─── Mutations d'upsert (contexte interne, pas de requireOrgMember) ──────────

const BATCH = 100

/** Résout l'org `calte` + upsert l'entité investisseuse et le compte fallback. */
export const ensureImportScaffold = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    // Investisseur (sert aussi de propriétaire des comptes) : réutiliser le
    // group_root canonique de l'org (ex. CALTE du seed) s'il existe ; sinon
    // retomber sur un éventuel placeholder d'import ; sinon le créer. Évite de
    // dupliquer la racine.
    const roots = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', 'group_root'),
      )
      .collect()
    let investor =
      roots.find((c) => c.airtableId !== SENTINEL_INVESTOR) ??
      roots.find((c) => c.airtableId === SENTINEL_INVESTOR) ??
      null
    if (!investor) {
      const id = await ctx.db.insert('companies', {
        orgId,
        name: 'CALTE (import)',
        kind: 'group_root',
        countryCode: 'FR',
        notes: "Entité investisseuse créée pour l'import Airtable one-shot.",
        airtableId: SENTINEL_INVESTOR,
      })
      investor = await ctx.db.get(id)
    }
    const investorCompanyId = investor!._id

    let fallback = await ctx.db
      .query('bankAccounts')
      .withIndex('by_airtable_id', (q) => q.eq('airtableId', SENTINEL_BANK))
      .first()
    if (!fallback) {
      const id = await ctx.db.insert('bankAccounts', {
        orgId,
        ownerCompanyId: investorCompanyId,
        bankName: 'Non rattaché',
        label: 'Import — mouvement sans banque',
        currency: 'EUR',
        airtableId: SENTINEL_BANK,
      })
      fallback = await ctx.db.get(id)
    }

    return {
      orgId,
      investorCompanyId,
      fallbackBankAccountId: fallback!._id,
    }
  },
})

export const upsertCompanies = internalMutation({
  args: {
    orgId: v.id('organizations'),
    rows: v.array(
      v.object({
        airtableId: v.string(),
        name: v.string(),
        totalShares: v.optional(v.number()),
        domain: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { orgId, rows }) => {
    const map: Record<string, Id<'companies'>> = {}
    for (const r of rows) {
      const existing = await ctx.db
        .query('companies')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.airtableId))
        .first()
      const fields = {
        orgId,
        name: r.name,
        kind: 'portfolio' as const,
        totalShares: r.totalShares,
        domain: r.domain,
        notes: r.notes,
        airtableId: r.airtableId,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        map[r.airtableId] = existing._id
      } else {
        map[r.airtableId] = await ctx.db.insert('companies', fields)
      }
    }
    return { map }
  },
})

export const upsertBankAccounts = internalMutation({
  args: {
    orgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'),
    rows: v.array(
      v.object({
        airtableId: v.string(),
        bankName: v.string(),
        label: v.string(),
        currentBalance: v.optional(v.number()),
        balanceAsOf: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { orgId, ownerCompanyId, rows }) => {
    const map: Record<string, Id<'bankAccounts'>> = {}
    for (const r of rows) {
      const existing = await ctx.db
        .query('bankAccounts')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.airtableId))
        .first()
      const fields = {
        orgId,
        ownerCompanyId,
        bankName: r.bankName,
        label: r.label,
        currency: 'EUR',
        currentBalance: r.currentBalance,
        balanceAsOf: r.balanceAsOf,
        airtableId: r.airtableId,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        map[r.airtableId] = existing._id
      } else {
        map[r.airtableId] = await ctx.db.insert('bankAccounts', fields)
      }
    }
    return { map }
  },
})

export const upsertDeals = internalMutation({
  args: {
    orgId: v.id('organizations'),
    investorCompanyId: v.id('companies'),
    rows: v.array(
      v.object({
        key: v.string(), // = airtableId dérivé `${recId}:${instrument}`
        targetCompanyId: v.id('companies'),
        instrumentKind: instrumentValidator,
        status: statusValidator,
        paidAmount: v.optional(v.number()),
        sharesAcquired: v.optional(v.number()),
        signedDate: v.optional(v.number()),
        exitedDate: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { orgId, investorCompanyId, rows }) => {
    const map: Record<string, Id<'deals'>> = {}
    for (const r of rows) {
      const existing = await ctx.db
        .query('deals')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.key))
        .first()
      const fields = {
        orgId,
        investorCompanyId,
        targetCompanyId: r.targetCompanyId,
        instrumentKind: r.instrumentKind,
        currency: 'EUR',
        status: r.status,
        paidAmount: r.paidAmount,
        sharesAcquired: r.sharesAcquired,
        signedDate: r.signedDate,
        exitedDate: r.exitedDate,
        airtableId: r.key,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        map[r.key] = existing._id
      } else {
        map[r.key] = await ctx.db.insert('deals', fields)
      }
    }
    return { map }
  },
})

export const upsertTransactions = internalMutation({
  args: {
    orgId: v.id('organizations'),
    rows: v.array(
      v.object({
        airtableId: v.string(),
        bankAccountId: v.id('bankAccounts'),
        dealId: v.optional(v.id('deals')),
        direction: v.union(v.literal('in'), v.literal('out')),
        amount: v.number(),
        transactionDate: v.number(),
        rawLabel: v.string(),
        counterparty: v.optional(v.string()),
        reconciled: v.boolean(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { orgId, rows }) => {
    let inserted = 0
    let patched = 0
    for (const r of rows) {
      const existing = await ctx.db
        .query('transactions')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.airtableId))
        .first()
      const fields = {
        orgId,
        bankAccountId: r.bankAccountId,
        dealId: r.dealId,
        direction: r.direction,
        amount: r.amount,
        transactionDate: r.transactionDate,
        rawLabel: r.rawLabel,
        counterparty: r.counterparty,
        source: 'imported' as const,
        reconciled: r.reconciled,
        notes: r.notes,
        airtableId: r.airtableId,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        patched += 1
      } else {
        await ctx.db.insert('transactions', fields)
        inserted += 1
      }
    }
    return { inserted, patched }
  },
})

export const finalizeValuations = internalMutation({
  args: {
    orgId: v.id('organizations'),
    entryRows: v.array(
      v.object({ dealId: v.id('deals'), entryValuation: v.number() }),
    ),
    valuationRows: v.array(
      v.object({
        airtableId: v.string(),
        dealId: v.id('deals'),
        fairValue: v.number(),
        asOf: v.number(),
      }),
    ),
  },
  handler: async (ctx, { orgId, entryRows, valuationRows }) => {
    for (const r of entryRows) {
      await ctx.db.patch(r.dealId, { entryValuation: r.entryValuation })
    }
    let inserted = 0
    let patched = 0
    for (const r of valuationRows) {
      const existing = await ctx.db
        .query('valuations')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.airtableId))
        .first()
      const fields = {
        orgId,
        dealId: r.dealId,
        asOf: r.asOf,
        fairValue: r.fairValue,
        valuationMethod: 'airtable_import',
        source: 'airtable',
        airtableId: r.airtableId,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        patched += 1
      } else {
        await ctx.db.insert('valuations', fields)
        inserted += 1
      }
    }
    return { entries: entryRows.length, inserted, patched }
  },
})

export const upsertForecasts = internalMutation({
  args: {
    orgId: v.id('organizations'),
    rows: v.array(
      v.object({
        airtableId: v.string(),
        dealId: v.optional(v.id('deals')),
        direction: v.union(v.literal('in'), v.literal('out')),
        expectedAmount: v.number(),
        expectedDate: v.number(),
        label: v.string(),
      }),
    ),
  },
  handler: async (ctx, { orgId, rows }) => {
    let inserted = 0
    let patched = 0
    for (const r of rows) {
      const existing = await ctx.db
        .query('forecasts')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', r.airtableId))
        .first()
      const fields = {
        orgId,
        dealId: r.dealId,
        direction: r.direction,
        expectedAmount: r.expectedAmount,
        expectedDate: r.expectedDate,
        label: r.label,
        source: 'airtable',
        airtableId: r.airtableId,
      }
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        patched += 1
      } else {
        await ctx.db.insert('forecasts', fields)
        inserted += 1
      }
    }
    return { inserted, patched }
  },
})

// ─── Action orchestratrice ───────────────────────────────────────────────────

type AirtableRecord = {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

async function fetchAll(tableId: string): Promise<Array<AirtableRecord>> {
  const key = process.env.AIRTABLE_API_KEY
  if (!key) throw new ConvexError('missing_airtable_api_key')
  const out: Array<AirtableRecord> = []
  let offset: string | undefined
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`)
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('returnFieldsByFieldId', 'true')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) {
      throw new ConvexError(`airtable_fetch_failed:${tableId}:${res.status}`)
    }
    const json = (await res.json()) as {
      records: Array<AirtableRecord>
      offset?: string
    }
    out.push(...json.records)
    offset = json.offset
  } while (offset)
  return out
}

const firstLink = (v0: unknown): string | undefined =>
  Array.isArray(v0) && v0.length > 0 ? String(v0[0]) : undefined

export const runImport = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const scaffold: {
      orgId: Id<'organizations'>
      investorCompanyId: Id<'companies'>
      fallbackBankAccountId: Id<'bankAccounts'>
    } = await ctx.runMutation(internal.airtableImport.ensureImportScaffold, {})
    const { orgId, investorCompanyId, fallbackBankAccountId } = scaffold

    // ── 1. Companies (Entreprise) ──
    const entRecords = await fetchAll(TBL.entreprise)
    const companyMap: Record<string, Id<'companies'>> = {}
    for (const batch of chunk(entRecords, BATCH)) {
      const rows = batch.map((rec) => {
        const f = rec.fields
        const domainRaw = f[F.ent.domaine]
        const noteBits: Array<string> = []
        if (f[F.ent.impact] === true) noteBits.push('Impact')
        if (f[F.ent.termine] === true) noteBits.push('Terminé')
        return {
          airtableId: rec.id,
          name: String(f[F.ent.nom] ?? '(sans nom)'),
          totalShares:
            typeof f[F.ent.totalShares] === 'number'
              ? (f[F.ent.totalShares] as number)
              : undefined,
          domain:
            typeof domainRaw === 'string' && domainRaw
              ? domainRaw.replace(/^https?:\/\//, '').replace(/\/$/, '')
              : undefined,
          notes: noteBits.length ? noteBits.join(' · ') : undefined,
        }
      })
      const res: { map: Record<string, Id<'companies'>> } =
        await ctx.runMutation(internal.airtableImport.upsertCompanies, {
          orgId,
          rows,
        })
      Object.assign(companyMap, res.map)
    }

    // ── 2. Bank accounts (Compte Bancaire) ──
    const cbRecords = await fetchAll(TBL.compte)
    const bankMap: Record<string, Id<'bankAccounts'>> = {}
    for (const batch of chunk(cbRecords, BATCH)) {
      const rows = batch.map((rec) => {
        const f = rec.fields
        const bank = String(f[F.cb.bank] ?? '(sans nom)')
        // bankAccounts n'a pas de champ `notes` : on replie la Remarque dans
        // `label` pour ne pas perdre l'info (ex. « NE PAS SUPPRIMER ! »).
        const remarque =
          typeof f[F.cb.remarque] === 'string'
            ? (f[F.cb.remarque] as string).trim()
            : ''
        return {
          airtableId: rec.id,
          bankName: bank,
          label: remarque ? `${bank} — ${remarque}` : bank,
          currentBalance: eurToCents(f[F.cb.balance]),
          balanceAsOf: parseDate(f[F.cb.lastUpdate]),
        }
      })
      const res: { map: Record<string, Id<'bankAccounts'>> } =
        await ctx.runMutation(internal.airtableImport.upsertBankAccounts, {
          orgId,
          ownerCompanyId: investorCompanyId,
          rows,
        })
      Object.assign(bankMap, res.map)
    }

    // ── 3. Mouvement (normalisation en mémoire) ──
    const mvRecords = await fetchAll(TBL.mouvement)
    type Mv = {
      recId: string
      companyRecId?: string
      bankRecId?: string
      instrument?: string
      dealKey?: string
      status: string
      direction: 'in' | 'out'
      amount: number
      date: number
      label: string
      counterparty?: string
      reconciled: boolean
      notes?: string
      shares?: number
    }
    const mv: Array<Mv> = mvRecords.map((rec) => {
      const f = rec.fields
      const instrument = classifyInvest(f[F.mv.typeInvest])
      const companyRecId = firstLink(f[F.mv.societe])
      const typeMouvement = String(f[F.mv.typeMouvement] ?? '').trim()
      const credit = eurToCents(f[F.mv.montantCredit])
      const invest = eurToCents(f[F.mv.montantInvesti])
      // Direction : Crédit = in, Débit = out ; sinon inféré du montant présent.
      const direction: 'in' | 'out' =
        typeMouvement === 'Crédit'
          ? 'in'
          : typeMouvement === 'Débit'
            ? 'out'
            : invest != null
              ? 'out'
              : 'in'
      const amount =
        direction === 'in' ? (credit ?? invest ?? 0) : (invest ?? credit ?? 0)
      const statut = String(f[F.mv.statut] ?? '').trim()
      const pointe = String(f[F.mv.pointe] ?? '').trim()
      return {
        recId: rec.id,
        companyRecId,
        bankRecId: firstLink(f[F.mv.banque]),
        instrument,
        dealKey:
          instrument && companyRecId
            ? `${companyRecId}:${instrument}`
            : undefined,
        status: STATUS_MAP[statut] ?? 'active',
        direction,
        amount: Math.abs(amount),
        date: parseDate(f[F.mv.date]) ?? parseDate(rec.createdTime) ?? Date.now(),
        label: String(f[F.mv.nom] ?? '(sans libellé)'),
        counterparty: companyRecId
          ? entRecords.find((e) => e.id === companyRecId)?.fields[F.ent.nom]
            ? String(
                entRecords.find((e) => e.id === companyRecId)!.fields[F.ent.nom],
              )
            : undefined
          : undefined,
        reconciled: pointe === 'Good' || pointe === 'Super Good',
        notes:
          typeof f[F.mv.remarque] === 'string'
            ? (f[F.mv.remarque] as string)
            : undefined,
        shares:
          typeof f[F.mv.nbAction] === 'number'
            ? (f[F.mv.nbAction] as number)
            : undefined,
      }
    })

    // ── 4. Dérivation des deals (Entreprise × instrument) ──
    type DealAgg = {
      key: string
      companyRecId: string
      instrument: string
      paidAmount: number
      shares: number
      minDate: number
      maxDate: number
      latestStatus: string
    }
    const dealAgg = new Map<string, DealAgg>()
    for (const m of mv) {
      if (!m.dealKey || !m.companyRecId || !m.instrument) continue
      let d0 = dealAgg.get(m.dealKey)
      if (!d0) {
        d0 = {
          key: m.dealKey,
          companyRecId: m.companyRecId,
          instrument: m.instrument,
          paidAmount: 0,
          shares: 0,
          minDate: m.date,
          maxDate: m.date,
          latestStatus: m.status,
        }
        dealAgg.set(m.dealKey, d0)
      }
      if (m.direction === 'out') {
        d0.paidAmount += m.amount
        d0.shares += m.shares ?? 0
      }
      if (m.date < d0.minDate) d0.minDate = m.date
      if (m.date >= d0.maxDate) {
        d0.maxDate = m.date
        d0.latestStatus = m.status
      }
    }

    const dealMap: Record<string, Id<'deals'>> = {}
    const dealAggList = [...dealAgg.values()].filter((d0) => companyMap[d0.companyRecId])
    for (const batch of chunk(dealAggList, BATCH)) {
      const rows = batch.map((d0) => ({
        key: d0.key,
        targetCompanyId: companyMap[d0.companyRecId],
        instrumentKind: d0.instrument as Instrument,
        status: d0.latestStatus as DealStatus,
        paidAmount: d0.paidAmount > 0 ? d0.paidAmount : undefined,
        sharesAcquired:
          SHARE_LIKE.has(d0.instrument) && d0.shares > 0
            ? d0.shares
            : undefined,
        signedDate: d0.minDate,
        exitedDate: d0.latestStatus === 'fully_exited' ? d0.maxDate : undefined,
      }))
      const res: { map: Record<string, Id<'deals'>> } = await ctx.runMutation(
        internal.airtableImport.upsertDeals,
        { orgId, investorCompanyId, rows },
      )
      Object.assign(dealMap, res.map)
    }

    // ── 5. Transactions (Mouvement 1:1) ──
    let txInserted = 0
    let txPatched = 0
    for (const batch of chunk(mv, BATCH)) {
      const rows = batch.map((m) => ({
        airtableId: m.recId,
        bankAccountId:
          (m.bankRecId && bankMap[m.bankRecId]) || fallbackBankAccountId,
        dealId: m.dealKey ? dealMap[m.dealKey] : undefined,
        direction: m.direction,
        amount: m.amount,
        transactionDate: m.date,
        rawLabel: m.label,
        counterparty: m.counterparty,
        reconciled: m.reconciled,
        notes: m.notes,
      }))
      const res: { inserted: number; patched: number } = await ctx.runMutation(
        internal.airtableImport.upsertTransactions,
        { orgId, rows },
      )
      txInserted += res.inserted
      txPatched += res.patched
    }

    // ── 6. Valuations + entryValuation (depuis Entreprise) ──
    // Deal primaire par société : 'share' prioritaire, sinon 1er instrument.
    const dealsByCompany = new Map<string, Array<{ key: string; instrument: string }>>()
    for (const d0 of dealAggList) {
      const arr = dealsByCompany.get(d0.companyRecId) ?? []
      arr.push({ key: d0.key, instrument: d0.instrument })
      dealsByCompany.set(d0.companyRecId, arr)
    }
    const primaryDealKey = (companyRecId: string): string | undefined => {
      const arr = dealsByCompany.get(companyRecId)
      if (!arr || arr.length === 0) return undefined
      return (arr.find((a) => a.instrument === 'share') ?? arr[0]).key
    }

    const entryRows: Array<{ dealId: Id<'deals'>; entryValuation: number }> = []
    const valuationRows: Array<{
      airtableId: string
      dealId: Id<'deals'>
      fairValue: number
      asOf: number
    }> = []
    const now = Date.now()
    for (const rec of entRecords) {
      const key = primaryDealKey(rec.id)
      if (!key) continue
      const dealId = dealMap[key]
      if (!dealId) continue
      const entry = eurToCents(rec.fields[F.ent.valoRentre])
      if (entry != null) entryRows.push({ dealId, entryValuation: entry })
      const fair = eurToCents(rec.fields[F.ent.valoActuelle])
      if (fair != null) {
        valuationRows.push({
          airtableId: `${rec.id}:valo`,
          dealId,
          fairValue: fair,
          asOf: now,
        })
      }
    }
    const valoRes: { entries: number; inserted: number; patched: number } =
      await ctx.runMutation(internal.airtableImport.finalizeValuations, {
        orgId,
        entryRows,
        valuationRows,
      })

    // ── 7. Forecasts (rentrée = in, sortie = out) ──
    const companyDealCount = new Map<string, number>()
    for (const [c, arr] of dealsByCompany) companyDealCount.set(c, arr.length)
    const uniqueDealId = (companyRecId?: string): Id<'deals'> | undefined => {
      if (!companyRecId) return undefined
      if ((companyDealCount.get(companyRecId) ?? 0) !== 1) return undefined
      const key = primaryDealKey(companyRecId)
      return key ? dealMap[key] : undefined
    }

    const buildForecastRows = (
      records: Array<AirtableRecord>,
      fields: { name: string; entreprise: string; amount: string; date: string },
      direction: 'in' | 'out',
    ) =>
      records.map((rec) => {
        const f = rec.fields
        const companyRecId = firstLink(f[fields.entreprise])
        return {
          airtableId: rec.id,
          dealId: uniqueDealId(companyRecId),
          direction,
          expectedAmount: Math.abs(eurToCents(f[fields.amount]) ?? 0),
          expectedDate:
            parseDate(f[fields.date]) ?? parseDate(rec.createdTime) ?? now,
          label: String(f[fields.name] ?? '(prévisionnel)'),
        }
      })

    const prRecords = await fetchAll(TBL.prevRentree)
    const psRecords = await fetchAll(TBL.prevSortie)
    let fcInserted = 0
    let fcPatched = 0
    const allForecasts = [
      ...buildForecastRows(prRecords, F.pr, 'in'),
      ...buildForecastRows(psRecords, F.ps, 'out'),
    ]
    for (const batch of chunk(allForecasts, BATCH)) {
      const res: { inserted: number; patched: number } = await ctx.runMutation(
        internal.airtableImport.upsertForecasts,
        { orgId, rows: batch },
      )
      fcInserted += res.inserted
      fcPatched += res.patched
    }

    return {
      companies: entRecords.length,
      bankAccounts: cbRecords.length,
      movements: mvRecords.length,
      deals: dealAggList.length,
      transactions: { inserted: txInserted, patched: txPatched },
      valuations: valoRes,
      forecasts: {
        inserted: fcInserted,
        patched: fcPatched,
        source: prRecords.length + psRecords.length,
      },
    }
  },
})

// ─── Vérification read-only (post-import) ────────────────────────────────────

/**
 * Contrôle live de l'import dans l'org `calte`. Read-only.
 *   pnpm exec convex run --prod airtableImport:verify
 *   pnpm exec convex run --prod airtableImport:verify '{"sampleSize":8}'
 *
 * Renvoie : comptes globaux (à confronter aux totaux Airtable), contrôles
 * d'intégrité, et un échantillon de deals enrichis (company cible + détail
 * in/out des transactions rattachées).
 */
export const verify = internalQuery({
  args: { sampleSize: v.optional(v.number()) },
  handler: async (ctx, { sampleSize }) => {
    const n = sampleSize ?? 6
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const [companies, deals, transactions, bankAccounts, valuations, forecasts] =
      await Promise.all([
        ctx.db.query('companies').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('deals').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('transactions').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('bankAccounts').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('valuations').withIndex('by_org_asof', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('forecasts').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
      ])

    // Agrégation transactions par deal (1 passe).
    const txByDeal = new Map<
      Id<'deals'>,
      { count: number; nIn: number; nOut: number; sumIn: number; sumOut: number }
    >()
    const dealIds = new Set(deals.map((d) => d._id))
    let txIn = 0
    let txOut = 0
    let txWithDeal = 0
    let txOrphanDeal = 0 // dealId pointant un deal inexistant / hors org
    for (const t of transactions) {
      if (t.direction === 'in') txIn += 1
      else txOut += 1
      if (t.dealId) {
        txWithDeal += 1
        if (!dealIds.has(t.dealId)) txOrphanDeal += 1
        const e = txByDeal.get(t.dealId) ?? {
          count: 0,
          nIn: 0,
          nOut: 0,
          sumIn: 0,
          sumOut: 0,
        }
        e.count += 1
        if (t.direction === 'in') {
          e.nIn += 1
          e.sumIn += t.amount
        } else {
          e.nOut += 1
          e.sumOut += t.amount
        }
        txByDeal.set(t.dealId, e)
      }
    }

    const companiesByKind: Record<string, number> = {}
    for (const c of companies) {
      companiesByKind[c.kind] = (companiesByKind[c.kind] ?? 0) + 1
    }

    const fallbackBank = bankAccounts.find((b) => b.airtableId === SENTINEL_BANK)
    const txOnFallbackBank = fallbackBank
      ? transactions.filter((t) => t.bankAccountId === fallbackBank._id).length
      : 0
    const importInvestor = companies.find((c) => c.airtableId === SENTINEL_INVESTOR)

    // Échantillon : deals avec le plus de transactions (le plus parlant pour
    // le contrôle in/out), enrichis avec la company cible.
    const sampleDeals = [...deals]
      .sort(
        (a, b) =>
          (txByDeal.get(b._id)?.count ?? 0) -
          (txByDeal.get(a._id)?.count ?? 0),
      )
      .slice(0, n)
    const samples = await Promise.all(
      sampleDeals.map(async (d) => {
        const target = await ctx.db.get(d.targetCompanyId)
        const investor = await ctx.db.get(d.investorCompanyId)
        const agg = txByDeal.get(d._id) ?? {
          count: 0,
          nIn: 0,
          nOut: 0,
          sumIn: 0,
          sumOut: 0,
        }
        return {
          airtableId: d.airtableId,
          instrument: d.instrumentKind,
          status: d.status,
          targetCompany: target?.name ?? null,
          targetSameOrg: target?.orgId === orgId,
          investorCompany: investor?.name ?? null,
          investorIsGroupRoot: investor?.kind === 'group_root',
          paidAmountCents: d.paidAmount ?? null,
          sharesAcquired: d.sharesAcquired ?? null,
          tx: agg,
        }
      }),
    )

    return {
      org: { slug: org.slug, id: orgId },
      counts: {
        companies: companies.length,
        companiesByKind,
        deals: deals.length,
        bankAccounts: bankAccounts.length,
        transactions: transactions.length,
        valuations: valuations.length,
        forecasts: forecasts.length,
      },
      transactionsBreakdown: {
        in: txIn,
        out: txOut,
        withDeal: txWithDeal,
        withoutDeal: transactions.length - txWithDeal,
        onFallbackBank: txOnFallbackBank,
      },
      integrity: {
        // tous doivent valoir 0 / true :
        orphanDealRefs: txOrphanDeal,
        importInvestorPresent: Boolean(importInvestor),
        importInvestorIsGroupRoot: importInvestor?.kind === 'group_root',
        samplesAllTargetSameOrg: samples.every((s) => s.targetSameOrg),
        samplesAllInvestorGroupRoot: samples.every((s) => s.investorIsGroupRoot),
      },
      samples,
    }
  },
})

// ─── Consolidation des group_root (fusion du placeholder d'import) ───────────

/**
 * Repointe les deals + comptes de l'entité d'import « CALTE (import) » vers le
 * group_root canonique de l'org (la CALTE du seed), puis supprime le
 * placeholder. Idempotent (no-op si le placeholder n'existe plus).
 *   pnpm exec convex run --prod airtableImport:consolidateImportInvestor
 */
export const consolidateImportInvestor = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const roots = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', 'group_root'),
      )
      .collect()
    const importEntity = roots.find((c) => c.airtableId === SENTINEL_INVESTOR)
    if (!importEntity) {
      return { consolidated: false, reason: 'no_import_entity' }
    }
    const canonicals = roots.filter((c) => c._id !== importEntity._id)
    if (canonicals.length !== 1) {
      throw new ConvexError(
        `expected_single_canonical_root_got_${canonicals.length}`,
      )
    }
    const canonical = canonicals[0]

    let dealsRepointed = 0
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org_investor', (q) =>
        q.eq('orgId', orgId).eq('investorCompanyId', importEntity._id),
      )
      .collect()
    for (const d of deals) {
      await ctx.db.patch(d._id, { investorCompanyId: canonical._id })
      dealsRepointed += 1
    }

    let banksRepointed = 0
    const banks = await ctx.db
      .query('bankAccounts')
      .withIndex('by_owner', (q) =>
        q.eq('orgId', orgId).eq('ownerCompanyId', importEntity._id),
      )
      .collect()
    for (const b of banks) {
      await ctx.db.patch(b._id, { ownerCompanyId: canonical._id })
      banksRepointed += 1
    }

    // Le placeholder n'a plus aucune référence entrante → suppression sûre.
    await ctx.db.delete(importEntity._id)

    return {
      consolidated: true,
      canonical: { id: canonical._id, name: canonical.name },
      dealsRepointed,
      banksRepointed,
    }
  },
})

// ─── Reconcile orphelins (read-only) ─────────────────────────────────────────

/**
 * Compare l'airtableId des lignes Convex aux recId Airtable ACTUELS et liste
 * les orphelins (lignes importées dont le record source a disparu d'Airtable).
 * Read-only — ne supprime rien.
 *   pnpm exec convex run --prod airtableImport:reconcileOrphans
 */
export const reconcileOrphans = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const [ent, cb, mv] = await Promise.all([
      fetchAll(TBL.entreprise),
      fetchAll(TBL.compte),
      fetchAll(TBL.mouvement),
    ])
    return await ctx.runQuery(internal.airtableImport.orphanReport, {
      entIds: ent.map((r) => r.id),
      cbIds: cb.map((r) => r.id),
      mvIds: mv.map((r) => r.id),
    })
  },
})

export const orphanReport = internalQuery({
  args: {
    entIds: v.array(v.string()),
    cbIds: v.array(v.string()),
    mvIds: v.array(v.string()),
  },
  handler: async (ctx, { entIds, cbIds, mvIds }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const entSet = new Set(entIds)
    const cbSet = new Set(cbIds)
    const mvSet = new Set(mvIds)

    const [companies, bankAccounts, deals, transactions] = await Promise.all([
      ctx.db.query('companies').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('bankAccounts').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('deals').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('transactions').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
    ])

    const orphanCompanies = companies
      .filter(
        (c) =>
          c.airtableId &&
          c.airtableId !== SENTINEL_INVESTOR &&
          !entSet.has(c.airtableId),
      )
      .map((c) => ({ id: c._id, airtableId: c.airtableId, name: c.name, kind: c.kind }))

    const orphanBankAccounts = bankAccounts
      .filter(
        (b) =>
          b.airtableId &&
          b.airtableId !== SENTINEL_BANK &&
          !cbSet.has(b.airtableId),
      )
      .map((b) => ({
        id: b._id,
        airtableId: b.airtableId,
        label: b.label,
        currentBalanceCents: b.currentBalance ?? null,
      }))

    const orphanTransactions = transactions
      .filter((t) => t.airtableId && !mvSet.has(t.airtableId))
      .map((t) => ({
        id: t._id,
        airtableId: t.airtableId,
        rawLabel: t.rawLabel,
        direction: t.direction,
        amountCents: t.amount,
        transactionDate: t.transactionDate,
      }))

    // Un deal est orphelin si la société (préfixe recId de l'airtableId) a
    // disparu d'Airtable.
    const orphanDeals = deals
      .filter((d) => d.airtableId && !entSet.has(d.airtableId.split(':')[0]))
      .map((d) => ({
        id: d._id,
        airtableId: d.airtableId,
        instrument: d.instrumentKind,
        paidAmountCents: d.paidAmount ?? null,
      }))

    return {
      airtableCurrent: {
        entreprise: entIds.length,
        compteBancaire: cbIds.length,
        mouvement: mvIds.length,
      },
      orphanCounts: {
        companies: orphanCompanies.length,
        bankAccounts: orphanBankAccounts.length,
        deals: orphanDeals.length,
        transactions: orphanTransactions.length,
      },
      orphanCompanies,
      orphanBankAccounts,
      orphanDeals,
      orphanTransactions,
    }
  },
})

// ─── Détection de doublons (read-only) ───────────────────────────────────────

/**
 * Détecte les doublons d'insertion : plusieurs lignes Convex partageant le même
 * `airtableId` (non détectables par reconcileOrphans, qui ne voit que les
 * suppressions). 100 % Convex, read-only — ne supprime rien.
 *   pnpm exec convex run --prod airtableImport:duplicateReport
 *
 * `extraRows` par table = nombre de lignes en trop (= total avec airtableId −
 * airtableId distincts). Les lignes sans airtableId (ex. entités du seed) sont
 * comptées à part dans `withoutAirtableId`.
 */
export const duplicateReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const analyze = <
      T extends { _id: string; _creationTime: number; airtableId?: string },
    >(
      rows: Array<T>,
      detail: (r: T) => Record<string, unknown>,
    ) => {
      const byId = new Map<string, Array<T>>()
      const unanchoredRows: Array<Record<string, unknown>> = []
      for (const r of rows) {
        if (!r.airtableId) {
          unanchoredRows.push({
            id: r._id,
            creationTime: new Date(r._creationTime).toISOString(),
            ...detail(r),
          })
          continue
        }
        const arr = byId.get(r.airtableId) ?? []
        arr.push(r)
        byId.set(r.airtableId, arr)
      }
      const withoutAirtableId = unanchoredRows.length
      const duplicates = [...byId.entries()]
        .filter(([, a]) => a.length > 1)
        .map(([airtableId, a]) => ({
          airtableId,
          count: a.length,
          rows: a
            .slice()
            .sort((x, y) => x._creationTime - y._creationTime)
            .map((r) => ({
              id: r._id,
              creationTime: new Date(r._creationTime).toISOString(),
              ...detail(r),
            })),
        }))
      const withAirtableId = rows.length - withoutAirtableId
      return {
        total: rows.length,
        withAirtableId,
        distinctAirtableIds: byId.size,
        withoutAirtableId,
        extraRows: withAirtableId - byId.size,
        duplicates,
        unanchoredRows,
      }
    }

    const [companies, bankAccounts, deals, transactions, valuations, forecasts] =
      await Promise.all([
        ctx.db.query('companies').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('bankAccounts').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('deals').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('transactions').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('valuations').withIndex('by_org_asof', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('forecasts').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
      ])

    return {
      companies: analyze(companies, (c) => ({ name: c.name, kind: c.kind })),
      bankAccounts: analyze(bankAccounts, (b) => ({
        label: b.label,
        currentBalanceCents: b.currentBalance ?? null,
      })),
      deals: analyze(deals, (d) => ({
        instrument: d.instrumentKind,
        paidAmountCents: d.paidAmount ?? null,
      })),
      transactions: analyze(transactions, (t) => ({
        rawLabel: t.rawLabel,
        direction: t.direction,
        amountCents: t.amount,
        transactionDate: new Date(t.transactionDate).toISOString().slice(0, 10),
      })),
      valuations: analyze(valuations, (vn) => ({
        fairValueCents: vn.fairValue,
      })),
      forecasts: analyze(forecasts, (fc) => ({
        label: fc.label,
        direction: fc.direction,
        expectedAmountCents: fc.expectedAmount,
      })),
    }
  },
})

// ─── Nettoyage ciblé des données de test (chat front) ────────────────────────

// IDs explicites à supprimer (essais via le chat, sans airtableId). NE PAS
// confondre avec les 8 companies du seed (également sans airtableId) qui ne
// figurent PAS dans cette liste.
const TEST_DELETE = {
  companies: [
    'jx7d7hw606b0t4n0w8ge1gdwcd87fs0p', // Maslow
    'jx7e5j0y8t6yn4f6q8m5ax86qh87g5yk', // Iroko (doublon)
  ],
  deals: [
    'k57d5htyqprg2n39awzvrzmwx187e9am',
    'k57fswq87har2c80n2e20gnqed87f5z5',
    'k57ef9wchckd0wf9q63yqkwrc587h5ym',
  ],
  transactions: [
    'kh7dqq8rq6ca1t7ycdct4gpg2n87hqng',
    'kh75z5191gzm0h2qgp1pm1x78x87gpzc',
    'kh720h512j50ebmhfv6rj35bw587h1r2',
    'kh76sxajnvy14n2rpx6nn61jp187h9b0',
    'kh7aevmq0gvy2jxsn8n45d7xas87h6y0',
  ],
  bankAccounts: [
    'js73fz8bkn4kd4c5sqwbzfpmhs87hg8q', // Qonto CALTE
    'js70d4zq613g409x0a0wbt8e2s87gj4p', // Qonto CALTE
  ],
} as const

/**
 * Supprime UNIQUEMENT les lignes de test listées dans TEST_DELETE (par id).
 * Gardes : refuse toute ligne hors org calte ou portant un `airtableId`
 * (donnée importée), et BLOQUE si une ligne à supprimer est référencée par une
 * ligne CONSERVÉE. Ordre : transactions → deals → bankAccounts → companies.
 *
 *   pnpm exec convex run --prod airtableImport:cleanupTestData              # dry-run
 *   pnpm exec convex run --prod airtableImport:cleanupTestData '{"apply":true}'
 */
export const cleanupTestData = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const companyIds = TEST_DELETE.companies.map((s) => s as Id<'companies'>)
    const dealIds = TEST_DELETE.deals.map((s) => s as Id<'deals'>)
    const txIds = TEST_DELETE.transactions.map((s) => s as Id<'transactions'>)
    const bankIds = TEST_DELETE.bankAccounts.map((s) => s as Id<'bankAccounts'>)

    const companySet = new Set<string>(companyIds)
    const dealSet = new Set<string>(dealIds)
    const txSet = new Set<string>(txIds)
    const bankSet = new Set<string>(bankIds)

    const problems: Array<string> = []
    const plan: Record<string, Array<{ id: string; label: string }>> = {
      companies: [],
      deals: [],
      transactions: [],
      bankAccounts: [],
    }

    // 1. Validation : existence, org, absence d'airtableId.
    for (const id of companyIds) {
      const d = await ctx.db.get(id)
      if (!d) problems.push(`company ${id} introuvable`)
      else if (d.orgId !== orgId) problems.push(`company ${id} hors org calte`)
      else if (d.airtableId)
        problems.push(`company ${id} a un airtableId (${d.airtableId}) — refus`)
      else plan.companies.push({ id, label: d.name })
    }
    for (const id of dealIds) {
      const d = await ctx.db.get(id)
      if (!d) problems.push(`deal ${id} introuvable`)
      else if (d.orgId !== orgId) problems.push(`deal ${id} hors org calte`)
      else if (d.airtableId)
        problems.push(`deal ${id} a un airtableId (${d.airtableId}) — refus`)
      else plan.deals.push({ id, label: d.instrumentKind })
    }
    for (const id of txIds) {
      const d = await ctx.db.get(id)
      if (!d) problems.push(`transaction ${id} introuvable`)
      else if (d.orgId !== orgId) problems.push(`transaction ${id} hors org calte`)
      else if (d.airtableId)
        problems.push(`transaction ${id} a un airtableId (${d.airtableId}) — refus`)
      else plan.transactions.push({ id, label: d.rawLabel })
    }
    for (const id of bankIds) {
      const d = await ctx.db.get(id)
      if (!d) problems.push(`bankAccount ${id} introuvable`)
      else if (d.orgId !== orgId) problems.push(`bankAccount ${id} hors org calte`)
      else if (d.airtableId)
        problems.push(`bankAccount ${id} a un airtableId (${d.airtableId}) — refus`)
      else plan.bankAccounts.push({ id, label: d.label })
    }

    // 2. Références entrantes depuis des lignes CONSERVÉES → bloqueur.
    const [allDeals, allTx, allValuations, allForecasts, allRelations, allKpis] =
      await Promise.all([
        ctx.db.query('deals').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('transactions').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('valuations').withIndex('by_org_asof', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('forecasts').withIndex('by_org_date', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('companyRelations').withIndex('by_org', (q) => q.eq('orgId', orgId)).collect(),
        ctx.db.query('kpiSnapshots').withIndex('by_org_period', (q) => q.eq('orgId', orgId)).collect(),
      ])

    // companies référencées par des deals / comptes / relations / kpis conservés
    for (const d of allDeals) {
      if (dealSet.has(d._id)) continue
      for (const ref of [d.investorCompanyId, d.targetCompanyId, d.viaSpvCompanyId]) {
        if (ref && companySet.has(ref))
          problems.push(`company ${ref} référencée par deal conservé ${d._id}`)
      }
    }
    const allBanks = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const b of allBanks) {
      if (bankSet.has(b._id)) continue
      if (companySet.has(b.ownerCompanyId))
        problems.push(`company ${b.ownerCompanyId} référencée par compte conservé ${b._id}`)
    }
    for (const r of allRelations) {
      if (companySet.has(r.parentCompanyId) || companySet.has(r.childCompanyId))
        problems.push(`company référencée par companyRelation ${r._id}`)
    }
    for (const k of allKpis) {
      if (companySet.has(k.companyId))
        problems.push(`company ${k.companyId} référencée par kpiSnapshot ${k._id}`)
    }

    // deals référencés par tx / valuations / forecasts conservés
    for (const t of allTx) {
      if (txSet.has(t._id)) continue
      if (t.dealId && dealSet.has(t.dealId))
        problems.push(`deal ${t.dealId} référencé par transaction conservée ${t._id}`)
    }
    for (const vrow of allValuations) {
      if (dealSet.has(vrow.dealId))
        problems.push(`deal ${vrow.dealId} référencé par valuation conservée ${vrow._id}`)
    }
    for (const f of allForecasts) {
      if (f.dealId && dealSet.has(f.dealId))
        problems.push(`deal ${f.dealId} référencé par forecast conservé ${f._id}`)
    }

    // bankAccounts référencés par tx / forecasts conservés
    for (const t of allTx) {
      if (txSet.has(t._id)) continue
      if (bankSet.has(t.bankAccountId))
        problems.push(`bankAccount ${t.bankAccountId} référencé par transaction conservée ${t._id}`)
    }
    for (const f of allForecasts) {
      if (f.bankAccountId && bankSet.has(f.bankAccountId))
        problems.push(`bankAccount ${f.bankAccountId} référencé par forecast conservé ${f._id}`)
    }

    // transactions référencées par forecasts.realizedTransactionId conservés
    for (const f of allForecasts) {
      if (f.realizedTransactionId && txSet.has(f.realizedTransactionId))
        problems.push(`transaction ${f.realizedTransactionId} référencée par forecast ${f._id}`)
    }

    if (problems.length > 0) {
      return { ok: false, deleted: false, problems, plan }
    }
    if (!apply) {
      return {
        ok: true,
        deleted: false,
        dryRun: true,
        willDelete: {
          companies: plan.companies.length,
          deals: plan.deals.length,
          transactions: plan.transactions.length,
          bankAccounts: plan.bankAccounts.length,
        },
        plan,
      }
    }

    // 3. Suppression dans l'ordre de dépendance.
    for (const id of txIds) await ctx.db.delete(id)
    for (const id of dealIds) await ctx.db.delete(id)
    for (const id of bankIds) await ctx.db.delete(id)
    for (const id of companyIds) await ctx.db.delete(id)

    return {
      ok: true,
      deleted: true,
      counts: {
        companies: companyIds.length,
        deals: dealIds.length,
        transactions: txIds.length,
        bankAccounts: bankIds.length,
      },
    }
  },
})
