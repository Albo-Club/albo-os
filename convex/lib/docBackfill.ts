/**
 * Deterministic layer of the Albo legal-doc backfill
 * (`convex/migrations/alboDocBackfill.ts`).
 *
 * Split of responsibilities — this file decides NOTHING about reading:
 *   - an LLM reads ONE document and returns a `DocExtraction`: every value as
 *     WRITTEN in the paper (euros, percents, ISO dates), each one carrying a
 *     verbatim quote, `null` when absent. It never converts, never derives,
 *     never arbitrates between two documents.
 *   - this file arbitrates (source hierarchy), converts to storage
 *     conventions (cents / bps / ms), derives the valuations, and sorts every
 *     candidate into PROPOSITION / ÉCART / NON TRAITÉ.
 *
 * Everything here is pure and synchronous, which is what makes the Auxicare
 * reference case testable without a network call
 * (`convex/regression.docBackfill.test.ts`).
 *
 * The three rules that carry the whole thing, all three learned on Auxicare
 * where 480 000, 548 943 and 609 936 shares are all correct in their own
 * context:
 *   1. `totalShares` takes the ISSUED count, never the fully-diluted base.
 *   2. `ownershipPct` takes the cap table's own figure as-is when there is
 *      one; a non-diluted computation is a fallback and is FLAGGED as such.
 *   3. the valuations are FD × round price, hence DERIVED — and flagged when
 *      instruments converted at a discount, because the product then
 *      mechanically inflates the post-money.
 */

import { ROUND_TYPES } from './instruments'

/**
 * Source hierarchy. Lower rank wins. A kind absent from this map is not a
 * source at all for these fields (`bp`, `reporting`, `other`, `attestation`)
 * and is never even sent to the model.
 *
 * `term_sheet` is present but NEVER authoritative (rank 4): pre-signature,
 * non-binding. It corroborates a value obtained elsewhere; alone it fills
 * nothing.
 */
export const SOURCE_RANK: Record<string, number | undefined> = {
  legal: 1, // PV / statuts — the constated legal fact
  subscription: 2, // bulletin de souscription — Albo's amounts and share count
  pacte: 3, // pacte d'associés — cap table, %, round qualification
  term_sheet: 4, // corroboration only
}

const TERM_SHEET_RANK = 4

/** A value the model read, with the verbatim excerpt that justifies it. */
export interface Cited<T> {
  value: T
  quote: string
}

/** One LLM call → one of these. `null` everywhere the paper is silent. */
export interface DocExtraction {
  documentId: string
  documentTitle: string
  /** `documents.kind` */
  documentKind: string
  company: {
    legalName: Cited<string> | null
    legalForm: Cited<string> | null
    countryCode: Cited<string> | null
    siren: Cited<string> | null
    /** Shares actually ISSUED after the operation (→ `companies.totalShares`). */
    issuedShares: Cited<number> | null
    /** Fully-diluted base post-operation (→ deal notes + valuation base). */
    fullyDilutedShares: Cited<number> | null
    /** What the non-issued part of the FD base is, e.g. "pool BSPCE". */
    dilutionLabel: string | null
  }
  deal: {
    sharesAcquired: Cited<number> | null
    pricePerShareEur: Cited<number> | null
    /** Albo's % as PRINTED in a cap table — taken as-is, never recomputed. */
    ownershipPctFromCapTable: Cited<number> | null
    roundSizeEur: Cited<number> | null
    roundType: Cited<string> | null
    closingDate: Cited<string> | null
    signedDate: Cited<string> | null
    maturityDate: Cited<string> | null
    interestRatePct: Cited<number> | null
    discountPct: Cited<number> | null
    valuationCapEur: Cited<number> | null
    principalAmountEur: Cited<number> | null
    preMoneyValuationEur: Cited<number> | null
    postMoneyValuationEur: Cited<number> | null
    entryValuationEur: Cited<number> | null
  }
  /** Set when instruments converted at a discounted price (BSA Air, SAFE, OC, BSPCE). */
  discountedConversion: Cited<string> | null
}

/** Values already in base, in STORAGE units (cents / bps / ms epoch). */
export interface CurrentValues {
  company: Record<string, string | number | undefined>
  deal: Record<string, string | number | undefined>
}

export interface PlanInput {
  companyId: string
  companyName: string
  dealId: string
  dealLabel: string
  current: CurrentValues
  extractions: Array<DocExtraction>
}

export type Section = 'PROPOSITION' | 'ECART' | 'NON_TRAITE'
export type EntityType = 'company' | 'deal'

export interface Row {
  section: Section
  entityType: EntityType
  entityId: string
  entityLabel: string
  field: string
  /** Formatted for the report; empty when the field is unset. */
  currentValue: string
  /** Storage-unit value, empty on a NON_TRAITE row. */
  proposedValue: string
  docId: string
  docTitle: string
  quote: string
  derived: boolean
  flags: Array<string>
}

export interface Plan {
  rows: Array<Row>
  /** Fields whose document value already matches the base — nothing to do. */
  confirmed: Array<string>
}

// ─── Units ───────────────────────────────────────────────────────────────────

/** Euros (as written) → integer cents. */
export const eurToCents = (eur: number): number => Math.round(eur * 100)

/** Percent (as written) → basis points. 2.34 → 234. */
export const pctToBps = (pct: number): number => Math.round(pct * 100)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** ISO `YYYY-MM-DD` → ms epoch UTC. Throws on anything else. */
export function isoToMs(iso: string): number {
  if (!ISO_DATE.test(iso)) throw new Error(`invalid_date:${iso}`)
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new Error(`invalid_date:${iso}`)
  return ms
}

/** ms epoch → ISO `YYYY-MM-DD`, for comparing a stored date to a read one. */
export const msToIso = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10)

/**
 * Thousands grouped with a plain space — NOT `Intl.NumberFormat('fr-FR')`,
 * which emits a narrow no-break space (U+202F). The deal note is compared
 * character for character in the reference test, and lands in a text field
 * read by a human: a plain space is what both expect.
 */
export function frNum(n: number): string {
  const [int, dec] = String(n).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return dec ? `${grouped},${dec}` : grouped
}

// ─── Source arbitration ──────────────────────────────────────────────────────

interface Candidate<T> {
  value: T
  quote: string
  docId: string
  docTitle: string
  rank: number
}

type Picked<T> =
  | { kind: 'ok'; pick: Candidate<T> }
  | { kind: 'none' }
  | { kind: 'blocked'; reason: string; docId: string; docTitle: string }

/** The provenance triple a report row needs, without the arbitration noise. */
const src = (c: { docId: string; docTitle: string; quote: string }) => ({
  docId: c.docId,
  docTitle: c.docTitle,
  quote: c.quote,
})

/**
 * Picks the value of the highest-ranked document that states the field.
 *
 * Three outcomes, and only the first one fills anything:
 *   - `ok`      — one value, from a document allowed to be authoritative;
 *   - `blocked` — a term sheet is the ONLY source (never authoritative), or
 *                 two documents of the SAME rank disagree. Empty + flag beats
 *                 a coin toss, per the cardinal rule;
 *   - `none`    — no document says anything.
 */
function pick<T>(
  extractions: Array<DocExtraction>,
  read: (e: DocExtraction) => Cited<T> | null,
): Picked<T> {
  const candidates: Array<Candidate<T>> = []
  for (const e of extractions) {
    const rank = SOURCE_RANK[e.documentKind]
    if (rank === undefined) continue
    const cited = read(e)
    if (!cited || cited.quote.trim() === '') continue
    candidates.push({
      value: cited.value,
      quote: cited.quote,
      docId: e.documentId,
      docTitle: e.documentTitle,
      rank,
    })
  }
  if (candidates.length === 0) return { kind: 'none' }

  const best = Math.min(...candidates.map((c) => c.rank))
  const top = candidates.filter((c) => c.rank === best)

  if (best === TERM_SHEET_RANK) {
    return {
      kind: 'blocked',
      reason: 'term_sheet_seul_non_autoritatif',
      docId: top[0].docId,
      docTitle: top[0].docTitle,
    }
  }
  const distinct = new Set(top.map((c) => JSON.stringify(c.value)))
  if (distinct.size > 1) {
    return {
      kind: 'blocked',
      reason: 'conflit_sources_meme_rang',
      docId: top.map((c) => c.docId).join(' + '),
      docTitle: top.map((c) => c.docTitle).join(' + '),
    }
  }
  return { kind: 'ok', pick: top[0] }
}

// ─── Plan building ───────────────────────────────────────────────────────────

class Builder {
  readonly rows: Array<Row> = []
  readonly confirmed: Array<string> = []

  constructor(
    private readonly companyId: string,
    private readonly companyName: string,
    private readonly dealId: string,
    private readonly dealLabel: string,
    private readonly current: CurrentValues,
  ) {}

  private target(entityType: EntityType) {
    return entityType === 'company'
      ? { id: this.companyId, label: this.companyName }
      : { id: this.dealId, label: this.dealLabel }
  }

  /**
   * The cardinal rule, in one place: a field already holding a value is NEVER
   * silently overwritten. Same value → nothing at all (`confirmed`), different
   * value → ÉCART, empty field → PROPOSITION.
   */
  propose(args: {
    entityType: EntityType
    field: string
    value: string | number
    docId: string
    docTitle: string
    quote: string
    derived?: boolean
    flags?: Array<string>
  }) {
    const { entityType, field } = args
    const { id, label } = this.target(entityType)
    const stored = this.current[entityType][field]
    const currentValue = stored === undefined ? '' : String(stored)
    const proposedValue = String(args.value)

    if (currentValue !== '' && currentValue === proposedValue) {
      this.confirmed.push(`${entityType}.${field}`)
      return
    }
    this.rows.push({
      section: currentValue === '' ? 'PROPOSITION' : 'ECART',
      entityType,
      entityId: id,
      entityLabel: label,
      field,
      currentValue,
      proposedValue,
      docId: args.docId,
      docTitle: args.docTitle,
      quote: args.quote,
      derived: args.derived ?? false,
      flags: args.flags ?? [],
    })
  }

  skip(
    entityType: EntityType,
    field: string,
    reason: string,
    doc?: { docId: string; docTitle: string },
  ) {
    const { id, label } = this.target(entityType)
    this.rows.push({
      section: 'NON_TRAITE',
      entityType,
      entityId: id,
      entityLabel: label,
      field,
      currentValue:
        this.current[entityType][field] === undefined
          ? ''
          : String(this.current[entityType][field]),
      proposedValue: '',
      docId: doc?.docId ?? '',
      docTitle: doc?.docTitle ?? '',
      quote: '',
      derived: false,
      flags: [reason],
    })
  }
}

/**
 * Turns the extractions of ONE (company, deal) pair into report rows.
 *
 * Never writes, never calls anything: hand it the same input twice and it
 * returns the same plan — which is what makes a re-run on the delta free.
 */
export function planDeal(input: PlanInput): Plan {
  const { extractions, current } = input
  const b = new Builder(
    input.companyId,
    input.companyName,
    input.dealId,
    input.dealLabel,
    current,
  )

  const usable = extractions.filter(
    (e) => SOURCE_RANK[e.documentKind] !== undefined,
  )
  if (usable.length === 0) {
    b.skip('company', '*', 'aucun_document_source')
    return { rows: b.rows, confirmed: b.confirmed }
  }

  // ── Company identity ───────────────────────────────────────────────────────
  const identity: Array<[string, (e: DocExtraction) => Cited<string> | null]> =
    [
      ['legalName', (e) => e.company.legalName],
      ['legalForm', (e) => e.company.legalForm],
      ['countryCode', (e) => e.company.countryCode],
      ['siren', (e) => e.company.siren],
    ]
  for (const [field, read] of identity) {
    const got = pick(usable, read)
    if (got.kind === 'blocked') b.skip('company', field, got.reason, got)
    if (got.kind !== 'ok') continue
    const value =
      field === 'siren'
        ? got.pick.value.replace(/\s/g, '')
        : field === 'countryCode'
          ? got.pick.value.trim().toUpperCase()
          : got.pick.value.trim()
    if (field === 'siren' && !/^\d{9}$/.test(value)) {
      b.skip('company', field, 'siren_non_conforme', got.pick)
      continue
    }
    b.propose({ entityType: 'company', field, value, ...src(got.pick) })
  }

  // ── totalShares: ISSUED shares, never the FD base ─────────────────────────
  const issued = pick(usable, (e) => e.company.issuedShares)
  const fd = pick(usable, (e) => e.company.fullyDilutedShares)
  if (issued.kind === 'blocked')
    b.skip('company', 'totalShares', issued.reason, issued)
  if (issued.kind === 'none' && fd.kind === 'ok') {
    // A cap table's FD total is NOT a share count: it counts instruments not
    // yet issued (voted BSPCE pool, warrants). It goes to the deal notes.
    b.skip(
      'company',
      'totalShares',
      'base_FD_seule_non_ecrite_en_actions',
      fd.pick,
    )
  }
  if (issued.kind === 'ok') {
    const flags: Array<string> = []
    if (fd.kind === 'ok' && fd.pick.value < issued.pick.value) {
      flags.push('base_FD_inferieure_aux_emises')
    }
    b.propose({
      entityType: 'company',
      field: 'totalShares',
      value: issued.pick.value,
      ...src(issued.pick),
      flags,
    })
  }

  // ── Deal: values read straight off the paper ───────────────────────────────
  const shares = pick(usable, (e) => e.deal.sharesAcquired)
  if (shares.kind === 'blocked')
    b.skip('deal', 'sharesAcquired', shares.reason, shares)
  if (shares.kind === 'ok') {
    b.propose({
      entityType: 'deal',
      field: 'sharesAcquired',
      value: shares.pick.value,
      ...src(shares.pick),
    })
  }

  const price = pick(usable, (e) => e.deal.pricePerShareEur)
  if (price.kind === 'blocked')
    b.skip('deal', 'pricePerShare', price.reason, price)
  if (price.kind === 'ok') {
    b.propose({
      entityType: 'deal',
      field: 'pricePerShare',
      value: eurToCents(price.pick.value),
      ...src(price.pick),
    })
  }

  const roundSize = pick(usable, (e) => e.deal.roundSizeEur)
  if (roundSize.kind === 'blocked')
    b.skip('deal', 'roundSize', roundSize.reason, roundSize)
  if (roundSize.kind === 'ok') {
    b.propose({
      entityType: 'deal',
      field: 'roundSize',
      value: eurToCents(roundSize.pick.value),
      ...src(roundSize.pick),
    })
  }

  const eurFields: Array<[string, (e: DocExtraction) => Cited<number> | null]> =
    [
      ['valuationCap', (e) => e.deal.valuationCapEur],
      ['principalAmount', (e) => e.deal.principalAmountEur],
      ['entryValuation', (e) => e.deal.entryValuationEur],
    ]
  for (const [field, read] of eurFields) {
    const got = pick(usable, read)
    if (got.kind === 'blocked') b.skip('deal', field, got.reason, got)
    if (got.kind !== 'ok') continue
    b.propose({
      entityType: 'deal',
      field,
      value: eurToCents(got.pick.value),
      ...src(got.pick),
    })
  }

  const bpsFields: Array<[string, (e: DocExtraction) => Cited<number> | null]> =
    [
      ['interestRate', (e) => e.deal.interestRatePct],
      ['discount', (e) => e.deal.discountPct],
    ]
  for (const [field, read] of bpsFields) {
    const got = pick(usable, read)
    if (got.kind === 'blocked') b.skip('deal', field, got.reason, got)
    if (got.kind !== 'ok') continue
    b.propose({
      entityType: 'deal',
      field,
      value: pctToBps(got.pick.value),
      ...src(got.pick),
    })
  }

  // `signedDate` = signature of the subscription form; `closingDate` = the PV
  // constating the definitive completion. Distinct facts, distinct documents.
  const dateFields: Array<
    [string, (e: DocExtraction) => Cited<string> | null]
  > = [
    ['closingDate', (e) => e.deal.closingDate],
    ['signedDate', (e) => e.deal.signedDate],
    ['maturityDate', (e) => e.deal.maturityDate],
  ]
  for (const [field, read] of dateFields) {
    const got = pick(usable, read)
    if (got.kind === 'blocked') b.skip('deal', field, got.reason, got)
    if (got.kind !== 'ok') continue
    if (!ISO_DATE.test(got.pick.value)) {
      b.skip('deal', field, 'date_non_iso', got.pick)
      continue
    }
    b.propose({
      entityType: 'deal',
      field,
      value: got.pick.value,
      ...src(got.pick),
    })
  }

  // ── roundType: only if a document qualifies the round ──────────────────────
  const roundType = pick(usable, (e) => e.deal.roundType)
  if (roundType.kind === 'blocked')
    b.skip('deal', 'roundType', roundType.reason, roundType)
  if (roundType.kind === 'none') {
    b.skip('deal', 'roundType', 'non_qualifie_par_les_documents')
  }
  if (roundType.kind === 'ok') {
    const value = roundType.pick.value.trim()
    if (!(ROUND_TYPES as ReadonlyArray<string>).includes(value)) {
      b.skip('deal', 'roundType', `hors_enum:${value}`, roundType.pick)
    } else {
      b.propose({
        entityType: 'deal',
        field: 'roundType',
        value,
        ...src(roundType.pick),
      })
    }
  }

  // ── ownershipPct: cap table as-is, else non-diluted + flag ────────────────
  const capTablePct = pick(usable, (e) => e.deal.ownershipPctFromCapTable)
  if (capTablePct.kind === 'ok') {
    const flags = ['base=FD_cap_table']
    // Consistency guard on the FD base — the number the valuations get
    // multiplied by. Auxicare: 14 286 / 609 936 = 2,342 % against a printed
    // 2,34 %. A base off by a whole operation shows up here, before it
    // silently inflates the post-money.
    if (shares.kind === 'ok' && fd.kind === 'ok' && fd.pick.value > 0) {
      const recomputed = (shares.pick.value / fd.pick.value) * 100
      if (Math.abs(recomputed - capTablePct.pick.value) > 0.1) {
        flags.push(
          `coherence_base_FD_douteuse:${recomputed.toFixed(2)}%_vs_${capTablePct.pick.value}%`,
        )
      }
    }
    b.propose({
      entityType: 'deal',
      field: 'ownershipPct',
      value: pctToBps(capTablePct.pick.value),
      ...src(capTablePct.pick),
      flags,
    })
  } else if (capTablePct.kind === 'blocked') {
    b.skip('deal', 'ownershipPct', capTablePct.reason, capTablePct)
  } else if (
    shares.kind === 'ok' &&
    issued.kind === 'ok' &&
    issued.pick.value > 0
  ) {
    // No printed %: computed on the ISSUED base, hence non-diluted. Flagged —
    // presenting it as fully diluted would be a lie by omission.
    const pct = (shares.pick.value / issued.pick.value) * 100
    b.propose({
      entityType: 'deal',
      field: 'ownershipPct',
      value: pctToBps(pct),
      docId: issued.pick.docId,
      docTitle: issued.pick.docTitle,
      quote: issued.pick.quote,
      derived: true,
      flags: ['base=non_dilué'],
    })
  } else {
    b.skip('deal', 'ownershipPct', 'ni_cap_table_ni_base_calculable')
  }

  // ── Valuations: FD × round price, derived ─────────────────────────────────
  const discounted = usable.find((e) => e.discountedConversion !== null)
  const valuationFlags: Array<string> = []
  if (discounted) {
    // The convention stays FD × round price, but multiplying the WHOLE FD base
    // by the round price when part of it converted cheaper mechanically
    // inflates the post-money. The line must say so.
    valuationFlags.push('instruments_convertis_a_prix_reduit')
  }

  const statedPost = pick(usable, (e) => e.deal.postMoneyValuationEur)
  const statedPre = pick(usable, (e) => e.deal.preMoneyValuationEur)

  let postCents: number | null = null
  let postSource: { docId: string; docTitle: string; quote: string } | null =
    null
  let postDerived = false

  if (statedPost.kind === 'ok') {
    postCents = eurToCents(statedPost.pick.value)
    postSource = statedPost.pick
  } else if (price.kind === 'ok' && fd.kind === 'ok') {
    postCents = fd.pick.value * eurToCents(price.pick.value)
    postSource = {
      docId: `${fd.pick.docId} + ${price.pick.docId}`,
      docTitle: `${fd.pick.docTitle} + ${price.pick.docTitle}`,
      quote: `${fd.pick.quote} — ${price.pick.quote}`,
    }
    postDerived = true
  }

  if (postCents !== null && postSource) {
    const flags = [...valuationFlags]
    // A stated post-money that disagrees with FD × price: keep the paper's
    // figure (a constated fact beats an arithmetic reconstruction) and say so.
    if (!postDerived && price.kind === 'ok' && fd.kind === 'ok') {
      const derivedCents = fd.pick.value * eurToCents(price.pick.value)
      if (derivedCents !== postCents) {
        flags.push(`post_money_doc_vs_derive:${derivedCents}`)
      }
    }
    b.propose({
      entityType: 'deal',
      field: 'postMoneyValuation',
      value: postCents,
      ...postSource,
      derived: postDerived,
      flags,
    })
  } else {
    b.skip('deal', 'postMoneyValuation', 'base_FD_ou_prix_du_tour_manquant')
  }

  if (statedPre.kind === 'ok') {
    b.propose({
      entityType: 'deal',
      field: 'preMoneyValuation',
      value: eurToCents(statedPre.pick.value),
      ...src(statedPre.pick),
      flags: valuationFlags,
    })
  } else if (postCents !== null && postSource && roundSize.kind === 'ok') {
    b.propose({
      entityType: 'deal',
      field: 'preMoneyValuation',
      value: postCents - eurToCents(roundSize.pick.value),
      docId: postSource.docId,
      docTitle: postSource.docTitle,
      quote: postSource.quote,
      derived: true,
      flags: valuationFlags,
    })
  } else {
    b.skip('deal', 'preMoneyValuation', 'post_money_ou_taille_du_tour_manquant')
  }

  // ── Deal notes: the FD base, which has no column of its own ───────────────
  if (fd.kind === 'ok') {
    const label =
      usable.find((e) => e.company.dilutionLabel)?.company.dilutionLabel ?? null
    let note = `base FD post-money : ${frNum(fd.pick.value)} titres`
    if (issued.kind === 'ok') {
      const delta = fd.pick.value - issued.pick.value
      const detail = label
        ? `${label} ${frNum(delta)}`
        : `${frNum(delta)} non émis`
      note += ` (${frNum(issued.pick.value)} émis + ${detail})`
    }
    b.propose({
      entityType: 'deal',
      field: 'notes',
      value: note,
      ...src(fd.pick),
    })
  }

  return { rows: b.rows, confirmed: b.confirmed }
}
