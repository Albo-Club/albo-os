/**
 * Backfill of the `companies` / `deals` fields from the legal documentation
 * already uploaded on the Albo portfolio (org `albo` ONLY — `calte` is out of
 * scope and never read).
 *
 * Not a one-shot: the operation is meant to be REPLAYED. A new participation,
 * or new documents uploaded on an existing one, and the same two commands
 * process only what changed — the extraction cache is keyed by
 * (documentId, text hash), and `applyRows` refuses anything already applied.
 *
 * Reading is an LLM's job, arbitration is code's job:
 *   - `extractDocument` sends ONE document to the model and gets back values
 *     AS WRITTEN, each with a verbatim excerpt. No regex: French legal prose
 *     defeats it, and a clean script that fills wrong data is the worst of
 *     both worlds. A value whose excerpt is not literally in the document is
 *     dropped here, before it can reach a report line.
 *   - `convex/lib/docBackfill.ts` (pure, tested) arbitrates the sources,
 *     converts to cents/bps/ISO, derives the valuations and sorts the lines.
 *   - `applyRows` writes ONLY the lines Benjamin ticked in the CSV.
 *
 * Cardinal rule, enforced in `applyRows` and not merely in the report: a write
 * only lands if the field still holds EXACTLY what the dry-run saw. An empty
 * field that got filled meanwhile, or a value that changed, blocks the line.
 * Nothing existing is ever overwritten in silence.
 *
 * Which documents feed which deal:
 *   - a document carrying `dealId` feeds that deal only;
 *   - on a company holding a SINGLE deal, its company-level documents feed
 *     that deal too (the usual case: one participation, one round);
 *   - on a company holding SEVERAL deals, an unattached document feeds the
 *     company identity but no deal field — attributing a pacte to the wrong
 *     round is exactly the kind of plausible mistake this script must not make.
 *
 * Execution (prod, manual — cf. MIGRATIONS.md), AFTER the merge has deployed:
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   node scripts/backfill-deal-fields.mjs                    # dry-run, 0 write
 *   # tick `ok=1` in the CSV on the validated lines, then:
 *   node scripts/backfill-deal-fields.mjs --apply <fichier.csv>
 *
 * ⚠️ `convex run --prod` calls the code DEPLOYED in prod, and prod deploys
 * from the Vercel build on `main`: these functions do not exist in prod before
 * this PR is merged. Merging is safe — nothing here runs on deploy.
 */
import { generateObject } from 'ai'
import { ConvexError, v } from 'convex/values'
import { z } from 'zod/v3'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import { getModel } from '../agent'
import { assertSirenFree, normalizeSiren } from '../companies'
import { ROUND_TYPES } from '../lib/instruments'
import { isoToMs, msToIso, planDeal } from '../lib/docBackfill'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DocExtraction, Row } from '../lib/docBackfill'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

const ORG_SLUG = 'albo'

/** Same window as the MCP document reader (`agentTools.ts`). */
const TEXT_WINDOW = 40_000

/**
 * Text budget of ONE extraction call. A pacte runs long; beyond this the tail
 * is dropped rather than silently splitting the document across two calls
 * (one call per document, and a cap table cut in half reads worse than a cap
 * table absent). The script reports the truncation on the line.
 */
const MAX_EXTRACT_CHARS = 220_000

/** Document kinds worth an LLM call — cf. SOURCE_RANK in lib/docBackfill.ts. */
const SOURCE_KINDS = new Set(['legal', 'subscription', 'pacte', 'term_sheet'])

// ─── Extraction schema ───────────────────────────────────────────────────────

const cited = <T extends z.ZodTypeAny>(inner: T, what: string) =>
  z
    .object({
      value: inner,
      quote: z
        .string()
        .describe(
          'Extrait VERBATIM du document, copié mot pour mot, qui justifie la valeur',
        ),
    })
    .nullable()
    .describe(`${what} — null si le document ne le dit pas`)

const extractionSchema = z.object({
  company: z.object({
    legalName: cited(z.string(), 'Dénomination sociale exacte'),
    legalForm: cited(z.string(), 'Forme juridique (SAS, SASU, SARL, SCI…)'),
    countryCode: cited(
      z.string(),
      "Pays d'immatriculation en ISO-3166-1 alpha-2 (FR, BE…)",
    ),
    siren: cited(z.string(), 'SIREN à 9 chiffres'),
    issuedShares: cited(
      z.number(),
      "Nombre TOTAL d'actions EFFECTIVEMENT ÉMISES après l'opération constatée, opérations concomitantes incluses (exercice de BSA Air, conversion d'obligations). PAS la base pleinement diluée, PAS un état intermédiaire du capital avant les opérations concomitantes",
    ),
    fullyDilutedShares: cited(
      z.number(),
      "Base PLEINEMENT DILUÉE post-opération (actions émises + pool BSPCE voté + BSA non exercés). C'est le total d'une table de capitalisation en base FD",
    ),
    dilutionLabel: z
      .string()
      .nullable()
      .describe(
        'Ce qu\'est la part NON ÉMISE de la base FD, en 2-3 mots, tel que nommé dans le document (ex. "pool BSPCE"). null si le document ne la nomme pas',
      ),
  }),
  deal: z.object({
    sharesAcquired: cited(
      z.number(),
      "Nombre d'actions/titres souscrits par ALBO CLUB (personne d'autre)",
    ),
    pricePerShareEur: cited(
      z.number(),
      'Prix unitaire de souscription en euros (nominal + prime), tel quel',
    ),
    ownershipPctFromCapTable: cited(
      z.number(),
      "Pourcentage de détention d'ALBO CLUB tel qu'IMPRIMÉ dans une table de capitalisation (en %, ex. 2.34). Ne le calcule JAMAIS toi-même : null si aucune table ne l'affiche",
    ),
    roundSizeEur: cited(z.number(), 'Montant TOTAL levé sur le tour, en euros'),
    roundType: cited(
      z.enum(ROUND_TYPES),
      'Qualification du tour SEULEMENT si le document la nomme explicitement (« Investisseurs Seed », « Série A »…). Ne devine JAMAIS depuis le montant ou la valorisation : null si le document ne qualifie pas le tour',
    ),
    closingDate: cited(
      z.string(),
      "Date (ISO YYYY-MM-DD) du PV/acte CONSTATANT LA RÉALISATION DÉFINITIVE de l'augmentation de capital",
    ),
    signedDate: cited(
      z.string(),
      'Date (ISO YYYY-MM-DD) de SIGNATURE du bulletin de souscription par Albo Club',
    ),
    maturityDate: cited(
      z.string(),
      "Date d'échéance (ISO YYYY-MM-DD) d'un instrument de dette",
    ),
    interestRatePct: cited(
      z.number(),
      "Taux d'intérêt annuel en % (ex. 11 pour 11 %)",
    ),
    discountPct: cited(
      z.number(),
      'Décote de conversion en % (SAFE / BSA Air / OC)',
    ),
    valuationCapEur: cited(
      z.number(),
      'Plafond de valorisation (cap) en euros',
    ),
    principalAmountEur: cited(
      z.number(),
      'Montant nominal du prêt / des obligations en euros',
    ),
    preMoneyValuationEur: cited(
      z.number(),
      'Valorisation pre-money en euros SEULEMENT si le document la chiffre explicitement',
    ),
    postMoneyValuationEur: cited(
      z.number(),
      'Valorisation post-money en euros SEULEMENT si le document la chiffre explicitement',
    ),
    entryValuationEur: cited(
      z.number(),
      "Valorisation d'entrée en euros si le document la chiffre",
    ),
  }),
  discountedConversion: cited(
    z.string(),
    "Présence d'instruments ayant converti à PRIX RÉDUIT par rapport au prix du tour (BSA Air, SAFE, OC, BSPCE exercés) : indique le prix de conversion constaté",
  ),
})

const SYSTEM_PROMPT = `Tu es juriste corporate. Tu lis UN document juridique français (pacte d'associés, bulletin de souscription, PV d'assemblée ou de président, statuts, term sheet) et tu en extrais des données chiffrées pour la base de suivi de participations d'ALBO CLUB.

RÈGLES ABSOLUES :
1. Tu n'extrais QUE ce qui est ÉCRIT dans le document. Un champ non trouvé = null. Jamais d'approximation, jamais de déduction « au plus probable ». Un champ vide est BIEN MEILLEUR qu'une valeur inventée.
2. Chaque valeur est accompagnée d'un extrait VERBATIM du document, copié mot pour mot (phrase ou fragment de tableau). Sans extrait littéral, mets null.
3. Tu ne convertis rien : les montants restent en euros tels qu'écrits, les taux en %, les dates en ISO YYYY-MM-DD. Le calcul est fait ailleurs.
4. Tu ne calcules rien : ni pourcentage, ni valorisation, ni total. Si le document ne l'affiche pas, c'est null.
5. L'investisseur qui t'intéresse est ALBO CLUB uniquement. Les titres et montants des autres souscripteurs ne sont jamais 'sharesAcquired' ni 'ownershipPctFromCapTable'.

PIÈGE PRINCIPAL — LES NOMBRES D'ACTIONS. Un même document contient souvent plusieurs totaux, tous exacts dans leur contexte :
- le capital après la seule augmentation de capital ;
- le capital après les opérations CONCOMITANTES (exercice de BSA Air, conversion d'obligations) → c'est CELUI-LÀ, 'issuedShares' ;
- la base PLEINEMENT DILUÉE incluant un pool BSPCE voté mais non attribué → 'fullyDilutedShares', jamais 'issuedShares'.
Un pool voté et non attribué n'est PAS une action émise. Relis le document avant de choisir, et cite le passage exact.`

// ─── Reads ───────────────────────────────────────────────────────────────────

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** The `albo` org, or a hard failure. `calte` is never reachable from here. */
async function albo(ctx: Ctx): Promise<Doc<'organizations'>> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError(`org_not_found:${ORG_SLUG}`)
  return org
}

/**
 * Everything the run needs, WITHOUT a single character of document text:
 * companies, their deals with the current value of every target field, and
 * the metadata of the documents that could feed them.
 */
export const listTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await albo(ctx)
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'portfolio'),
      )
      .collect()

    const out = []
    for (const c of companies) {
      if (c.archivedAt !== undefined) continue
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', org._id).eq('targetCompanyId', c._id),
        )
        .collect()
      const documents = await ctx.db
        .query('documents')
        .withIndex('by_company', (q) => q.eq('companyId', c._id))
        .collect()

      out.push({
        companyId: c._id,
        companyName: c.name,
        current: {
          legalName: c.legalName,
          legalForm: c.legalForm,
          countryCode: c.countryCode,
          siren: c.siren,
          totalShares: c.totalShares,
          notes: c.notes,
        },
        deals: deals.map((d) => ({
          dealId: d._id,
          label: d.name ?? `${d.instrumentKind} — ${c.name}`,
          current: {
            sharesAcquired: d.sharesAcquired,
            pricePerShare: d.pricePerShare,
            ownershipPct: d.ownershipPct,
            roundSize: d.roundSize,
            roundType: d.roundType,
            preMoneyValuation: d.preMoneyValuation,
            postMoneyValuation: d.postMoneyValuation,
            entryValuation: d.entryValuation,
            // Dates are compared as ISO — the report speaks ISO, the base ms.
            closingDate:
              d.closingDate === undefined ? undefined : msToIso(d.closingDate),
            signedDate:
              d.signedDate === undefined ? undefined : msToIso(d.signedDate),
            maturityDate:
              d.maturityDate === undefined
                ? undefined
                : msToIso(d.maturityDate),
            interestRate: d.interestRate,
            discount: d.discount,
            valuationCap: d.valuationCap,
            principalAmount: d.principalAmount,
            notes: d.notes,
          },
        })),
        documents: documents.map((doc) => ({
          documentId: doc._id,
          title: doc.title,
          kind: doc.kind,
          dealId: doc.dealId ?? null,
          ocrState: doc.ocrState ?? null,
          ocrDetail: doc.ocrDetail ?? null,
          ocrChars: doc.ocrChars ?? null,
          isSource: SOURCE_KINDS.has(doc.kind),
        })),
      })
    }
    return { orgId: org._id, companies: out }
  },
})

/** One 40 000-char window of a document's text. */
export const getDocText = internalQuery({
  args: { documentId: v.id('documents'), offset: v.number() },
  handler: async (ctx, { documentId, offset }) => {
    const org = await albo(ctx)
    const doc = await ctx.db.get('documents', documentId)
    if (!doc || doc.orgId !== org._id) throw new ConvexError('not_found')
    const row = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    if (!row)
      return { text: '', totalChars: 0, nextOffset: null as number | null }
    const start = Math.max(0, Math.trunc(offset))
    const text = row.text.slice(start, start + TEXT_WINDOW)
    const end = start + text.length
    return {
      text,
      totalChars: row.text.length,
      nextOffset: end < row.text.length ? end : null,
    }
  },
})

// ─── Extraction ──────────────────────────────────────────────────────────────

/** Whitespace-insensitive containment — OCR reflows lines, quotes must survive it. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Drops every value whose excerpt is not literally in the document.
 *
 * This is the anti-hallucination guard: the model is asked for a verbatim
 * quote precisely so that it can be checked, and a quote that is not in the
 * text means the value was reconstructed rather than read.
 */
function keepOnlyQuoted(
  raw: z.infer<typeof extractionSchema>,
  text: string,
): {
  company: DocExtraction['company']
  deal: DocExtraction['deal']
  discountedConversion: DocExtraction['discountedConversion']
  dropped: Array<string>
} {
  const haystack = flat(text)
  const dropped: Array<string> = []
  const check = <T>(field: string, c: { value: T; quote: string } | null) => {
    if (!c) return null
    if (c.quote.trim() === '' || !haystack.includes(flat(c.quote))) {
      dropped.push(field)
      return null
    }
    return c
  }
  const company = {
    legalName: check('legalName', raw.company.legalName),
    legalForm: check('legalForm', raw.company.legalForm),
    countryCode: check('countryCode', raw.company.countryCode),
    siren: check('siren', raw.company.siren),
    issuedShares: check('issuedShares', raw.company.issuedShares),
    fullyDilutedShares: check(
      'fullyDilutedShares',
      raw.company.fullyDilutedShares,
    ),
    dilutionLabel: raw.company.dilutionLabel,
  }
  const deal = {
    sharesAcquired: check('sharesAcquired', raw.deal.sharesAcquired),
    pricePerShareEur: check('pricePerShareEur', raw.deal.pricePerShareEur),
    ownershipPctFromCapTable: check(
      'ownershipPctFromCapTable',
      raw.deal.ownershipPctFromCapTable,
    ),
    roundSizeEur: check('roundSizeEur', raw.deal.roundSizeEur),
    roundType: check('roundType', raw.deal.roundType),
    closingDate: check('closingDate', raw.deal.closingDate),
    signedDate: check('signedDate', raw.deal.signedDate),
    maturityDate: check('maturityDate', raw.deal.maturityDate),
    interestRatePct: check('interestRatePct', raw.deal.interestRatePct),
    discountPct: check('discountPct', raw.deal.discountPct),
    valuationCapEur: check('valuationCapEur', raw.deal.valuationCapEur),
    principalAmountEur: check(
      'principalAmountEur',
      raw.deal.principalAmountEur,
    ),
    preMoneyValuationEur: check(
      'preMoneyValuationEur',
      raw.deal.preMoneyValuationEur,
    ),
    postMoneyValuationEur: check(
      'postMoneyValuationEur',
      raw.deal.postMoneyValuationEur,
    ),
    entryValuationEur: check('entryValuationEur', raw.deal.entryValuationEur),
  }
  return {
    company,
    deal,
    discountedConversion: check(
      'discountedConversion',
      raw.discountedConversion,
    ),
    dropped,
  }
}

/**
 * Turns the text of ONE document into an extraction. One call per document,
 * never one per field.
 *
 * Takes the text rather than reading it: the caller (the script) already
 * walked the 40 000-char windows of `getDocText` and hashed the result, so it
 * knows whether the document moved since the last run. An unchanged document
 * never reaches this action at all — which is what makes a re-run on the delta
 * free rather than merely idempotent.
 */
export const extractDocument = internalAction({
  args: { text: v.string() },
  handler: async (
    _ctx,
    { text },
  ): Promise<{
    dropped: Array<string>
    extraction: Omit<
      DocExtraction,
      'documentId' | 'documentTitle' | 'documentKind'
    > | null
    error: string | null
  }> => {
    if (text.trim() === '') {
      return { dropped: [], extraction: null, error: 'texte_vide' }
    }
    try {
      const { object } = await generateObject({
        model: getModel(),
        schema: extractionSchema,
        system: SYSTEM_PROMPT,
        prompt: `DOCUMENT À LIRE :\n\n${text.slice(0, MAX_EXTRACT_CHARS)}`,
      })
      const { company, deal, discountedConversion, dropped } = keepOnlyQuoted(
        object,
        text,
      )
      return {
        dropped,
        extraction: { company, deal, discountedConversion },
        error: null,
      }
    } catch (err) {
      return {
        dropped: [],
        extraction: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
})

// ─── Planning ────────────────────────────────────────────────────────────────

const citedNumber = v.union(
  v.null(),
  v.object({ value: v.number(), quote: v.string() }),
)
const citedString = v.union(
  v.null(),
  v.object({ value: v.string(), quote: v.string() }),
)

const extractionValidator = v.object({
  documentId: v.string(),
  documentTitle: v.string(),
  documentKind: v.string(),
  company: v.object({
    legalName: citedString,
    legalForm: citedString,
    countryCode: citedString,
    siren: citedString,
    issuedShares: citedNumber,
    fullyDilutedShares: citedNumber,
    dilutionLabel: v.union(v.null(), v.string()),
  }),
  deal: v.object({
    sharesAcquired: citedNumber,
    pricePerShareEur: citedNumber,
    ownershipPctFromCapTable: citedNumber,
    roundSizeEur: citedNumber,
    roundType: citedString,
    closingDate: citedString,
    signedDate: citedString,
    maturityDate: citedString,
    interestRatePct: citedNumber,
    discountPct: citedNumber,
    valuationCapEur: citedNumber,
    principalAmountEur: citedNumber,
    preMoneyValuationEur: citedNumber,
    postMoneyValuationEur: citedNumber,
    entryValuationEur: citedNumber,
  }),
  discountedConversion: citedString,
})

/**
 * Report lines for one (company, deal) pair. Reads the CURRENT values itself
 * so the comparison is always against live data, never against what the
 * script believes it saw.
 */
export const planForDeal = internalQuery({
  args: {
    companyId: v.id('companies'),
    dealId: v.id('deals'),
    extractions: v.array(extractionValidator),
  },
  handler: async (
    ctx,
    { companyId, dealId, extractions },
  ): Promise<{ rows: Array<Row>; confirmed: Array<string> }> => {
    const org = await albo(ctx)
    const company = await ctx.db.get('companies', companyId)
    const deal = await ctx.db.get('deals', dealId)
    if (!company || company.orgId !== org._id)
      throw new ConvexError('company_not_found')
    if (!deal || deal.orgId !== org._id) throw new ConvexError('deal_not_found')

    return planDeal({
      companyId,
      companyName: company.name,
      dealId,
      dealLabel: deal.name ?? `${deal.instrumentKind} — ${company.name}`,
      current: {
        company: {
          legalName: company.legalName,
          legalForm: company.legalForm,
          countryCode: company.countryCode,
          siren: company.siren,
          totalShares: company.totalShares,
          notes: company.notes,
        },
        deal: {
          sharesAcquired: deal.sharesAcquired,
          pricePerShare: deal.pricePerShare,
          ownershipPct: deal.ownershipPct,
          roundSize: deal.roundSize,
          roundType: deal.roundType,
          preMoneyValuation: deal.preMoneyValuation,
          postMoneyValuation: deal.postMoneyValuation,
          entryValuation: deal.entryValuation,
          closingDate:
            deal.closingDate === undefined
              ? undefined
              : msToIso(deal.closingDate),
          signedDate:
            deal.signedDate === undefined
              ? undefined
              : msToIso(deal.signedDate),
          maturityDate:
            deal.maturityDate === undefined
              ? undefined
              : msToIso(deal.maturityDate),
          interestRate: deal.interestRate,
          discount: deal.discount,
          valuationCap: deal.valuationCap,
          principalAmount: deal.principalAmount,
          notes: deal.notes,
        },
      },
      extractions,
    })
  },
})

// ─── Apply ───────────────────────────────────────────────────────────────────

type FieldKind = 'string' | 'int' | 'siren' | 'date' | 'roundType'

const COMPANY_FIELDS: Record<string, FieldKind | undefined> = {
  legalName: 'string',
  legalForm: 'string',
  countryCode: 'string',
  siren: 'siren',
  totalShares: 'int',
  notes: 'string',
}

const DEAL_FIELDS: Record<string, FieldKind | undefined> = {
  sharesAcquired: 'int',
  pricePerShare: 'int',
  ownershipPct: 'int',
  roundSize: 'int',
  roundType: 'roundType',
  preMoneyValuation: 'int',
  postMoneyValuation: 'int',
  entryValuation: 'int',
  closingDate: 'date',
  signedDate: 'date',
  maturityDate: 'date',
  interestRate: 'int',
  discount: 'int',
  valuationCap: 'int',
  principalAmount: 'int',
  notes: 'string',
}

/** CSV string → the value that goes in the column. Throws on anything invalid. */
function parseValue(kind: FieldKind, raw: string): string | number {
  if (kind === 'int') {
    const n = Number(raw)
    if (!Number.isFinite(n) || !Number.isInteger(n))
      throw new Error(`valeur_non_entiere:${raw}`)
    return n
  }
  if (kind === 'date') return isoToMs(raw)
  if (kind === 'roundType') {
    if (!(ROUND_TYPES as ReadonlyArray<string>).includes(raw))
      throw new Error(`hors_enum:${raw}`)
    return raw
  }
  if (kind === 'siren') {
    const cleaned = normalizeSiren(raw)
    if (cleaned === undefined) throw new Error('siren_vide')
    return cleaned
  }
  const trimmed = raw.trim()
  if (trimmed === '') throw new Error('valeur_vide')
  return trimmed
}

const rowArg = v.object({
  entityId: v.string(),
  field: v.string(),
  value: v.string(),
  /**
   * What the dry-run saw in the column, '' for an empty field. The write only
   * lands if the column STILL holds exactly this — an optimistic lock that
   * makes the cardinal rule enforceable rather than merely documented, and
   * makes a second apply of the same CSV a no-op.
   */
  expectedCurrent: v.string(),
})

/**
 * Writes the validated lines. Every line is checked again against live data —
 * the CSV is an intention, not an authority.
 */
export const applyRows = internalMutation({
  args: {
    companyRows: v.array(rowArg),
    dealRows: v.array(rowArg),
  },
  handler: async (ctx, { companyRows, dealRows }) => {
    const org = await albo(ctx)
    const results: Array<string> = []
    let applied = 0
    let skipped = 0

    const record = (label: string, outcome: string, ok: boolean) => {
      results.push(`${ok ? '✅' : '⏭️ '} ${label} — ${outcome}`)
      if (ok) applied += 1
      else skipped += 1
    }

    for (const row of companyRows) {
      const label = `company/${row.field}`
      const kind = COMPANY_FIELDS[row.field]
      if (!kind) {
        record(label, 'champ_hors_perimetre', false)
        continue
      }
      const company = await ctx.db.get(
        'companies',
        row.entityId as Id<'companies'>,
      )
      if (!company || company.orgId !== org._id) {
        record(label, 'societe_introuvable_ou_hors_org', false)
        continue
      }
      const stored = company[row.field as keyof typeof company]
      const current = stored === undefined ? '' : String(stored)
      if (current !== row.expectedCurrent) {
        record(
          `${company.name}/${row.field}`,
          `valeur_modifiee_depuis_le_dry_run (base="${current}", csv="${row.expectedCurrent}")`,
          false,
        )
        continue
      }
      try {
        const value = parseValue(kind, row.value)
        if (kind === 'siren') {
          await assertSirenFree(ctx, org._id, value as string, company._id)
        }
        await ctx.db.patch('companies', company._id, { [row.field]: value })
        record(`${company.name}/${row.field}`, `→ ${value}`, true)
      } catch (err) {
        record(
          `${company.name}/${row.field}`,
          err instanceof ConvexError
            ? String(err.data)
            : err instanceof Error
              ? err.message
              : String(err),
          false,
        )
      }
    }

    for (const row of dealRows) {
      const label = `deal/${row.field}`
      const kind = DEAL_FIELDS[row.field]
      if (!kind) {
        record(label, 'champ_hors_perimetre', false)
        continue
      }
      const deal = await ctx.db.get('deals', row.entityId as Id<'deals'>)
      if (!deal || deal.orgId !== org._id) {
        record(label, 'deal_introuvable_ou_hors_org', false)
        continue
      }
      const stored = deal[row.field as keyof typeof deal]
      const current =
        stored === undefined
          ? ''
          : kind === 'date'
            ? msToIso(stored as number)
            : String(stored)
      if (current !== row.expectedCurrent) {
        record(
          `${deal._id}/${row.field}`,
          `valeur_modifiee_depuis_le_dry_run (base="${current}", csv="${row.expectedCurrent}")`,
          false,
        )
        continue
      }
      try {
        const value = parseValue(kind, row.value)
        await ctx.db.patch('deals', deal._id, { [row.field]: value })
        record(`${deal._id}/${row.field}`, `→ ${row.value}`, true)
      } catch (err) {
        record(
          `${deal._id}/${row.field}`,
          err instanceof Error ? err.message : String(err),
          false,
        )
      }
    }

    return { applied, skipped, results }
  },
})
