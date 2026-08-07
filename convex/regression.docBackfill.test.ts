/**
 * Reference case of the legal-doc backfill: AUXICARE, done by hand and
 * validated. The pipeline must reproduce it exactly.
 *
 * Why a frozen fixture rather than a live read: the extraction is an LLM call,
 * so it is not reproducible in CI. What IS reproducible — and where the whole
 * risk sits — is everything downstream of the reading: source arbitration,
 * the choice between three correct-but-different share counts, the unit
 * conversions, the derivations, and the propose-vs-overwrite decision. That
 * is what these tests pin. That the model itself returns 548 943 rather than
 * 480 000 is verified on the first real dry-run, not here.
 *
 * Auxicare's trap, and the reason this file exists: 480 000 (capital after the
 * capital increase alone), 548 943 (after the concomitant BSA Air exercise —
 * the right figure for `totalShares`) and 609 936 (fully diluted, with the
 * BSPCE pool — the right base for the valuations) are three different numbers,
 * all three correct in their own context. An extractor that grabs the first
 * share count it meets gets it wrong.
 */
import { describe, expect, it } from 'vitest'
import { planDeal } from './lib/docBackfill'
import type { CurrentValues, DocExtraction } from './lib/docBackfill'

const COMPANY_ID = 'jx75dbb7q4zp0p1234ayc6zy8187wq18'
const DEAL_ID = 'k57dthzdvxwqv6rk7p07mxdhq587wqwg'

const cited = <T>(value: T, quote: string) => ({ value, quote })

const emptyDoc = (
  documentId: string,
  documentTitle: string,
  documentKind: string,
): DocExtraction => ({
  documentId,
  documentTitle,
  documentKind,
  company: {
    legalName: null,
    legalForm: null,
    countryCode: null,
    siren: null,
    issuedShares: null,
    fullyDilutedShares: null,
    dilutionLabel: null,
  },
  deal: {
    sharesAcquired: null,
    pricePerShareEur: null,
    ownershipPctFromCapTable: null,
    roundSizeEur: null,
    roundType: null,
    closingDate: null,
    signedDate: null,
    maturityDate: null,
    interestRatePct: null,
    discountPct: null,
    valuationCapEur: null,
    principalAmountEur: null,
    preMoneyValuationEur: null,
    postMoneyValuationEur: null,
    entryValuationEur: null,
  },
  discountedConversion: null,
})

/** PV du Président — rank 1, the constated legal fact. */
const pv = (): DocExtraction => {
  const d = emptyDoc(
    'doc_pv',
    'PV du Président — réalisation définitive',
    'legal',
  )
  d.company.legalName = cited(
    'AUXICARE',
    'la société AUXICARE, société par actions simplifiée',
  )
  d.company.legalForm = cited(
    'SAS',
    'société par actions simplifiée au capital de',
  )
  d.company.countryCode = cited('FR', 'RCS de Paris')
  d.company.siren = cited('930844105', '930 844 105 R.C.S. Paris')
  d.company.issuedShares = cited(
    548943,
    'le capital social est désormais divisé en 548 943 actions, après exercice concomitant des BSA Air',
  )
  d.deal.roundSizeEur = cited(560000, "d'un montant total de 560 000 euros")
  d.deal.closingDate = cited(
    '2026-06-09',
    'Le 9 juin 2026, le Président constate la réalisation définitive',
  )
  d.discountedConversion = cited(
    '1,72 € par action',
    'les BSA Air ont été exercés au prix de 1,72 € par action, soit 105 000 € pour 60 993 actions',
  )
  return d
}

/** Bulletin de souscription — rank 2, Albo's own amounts. */
const bulletin = (): DocExtraction => {
  const d = emptyDoc(
    'doc_bulletin',
    'Bulletin de souscription Albo Club',
    'subscription',
  )
  d.deal.sharesAcquired = cited(14286, 'souscrit 14 286 actions nouvelles')
  d.deal.pricePerShareEur = cited(
    7,
    'au prix unitaire de 7,00 euros (0,01 € de nominal et 6,99 € de prime)',
  )
  d.deal.signedDate = cited('2026-05-29', 'Fait le 29 mai 2026')
  return d
}

/** Pacte d'associés — rank 3, cap table and round qualification. */
const pacte = (): DocExtraction => {
  const d = emptyDoc('doc_pacte', "Pacte d'associés", 'pacte')
  d.company.fullyDilutedShares = cited(
    609936,
    'Total en base pleinement diluée : 609 936 titres (annexe E)',
  )
  d.company.dilutionLabel = 'pool BSPCE'
  d.deal.ownershipPctFromCapTable = cited(2.34, 'ALBO CLUB — 14 286 — 2,34 %')
  d.deal.roundType = cited('seed', 'Sous-total Seed (Actions S3)')
  return d
}

/** The base as it stands before the run: what was already filled by hand. */
const currentAuxicare = (): CurrentValues => ({
  company: {
    legalName: undefined,
    legalForm: undefined,
    countryCode: undefined,
    siren: '930844105',
    totalShares: 548943,
    notes: undefined,
  },
  deal: {
    sharesAcquired: undefined,
    pricePerShare: undefined,
    ownershipPct: undefined,
    roundSize: undefined,
    roundType: undefined,
    preMoneyValuation: undefined,
    postMoneyValuation: undefined,
    entryValuation: undefined,
    closingDate: undefined,
    signedDate: '2026-05-29',
    maturityDate: undefined,
    interestRate: undefined,
    discount: undefined,
    valuationCap: undefined,
    principalAmount: undefined,
    notes: undefined,
  },
})

const planAuxicare = (extractions = [pv(), bulletin(), pacte()]) =>
  planDeal({
    companyId: COMPANY_ID,
    companyName: 'Auxicare',
    dealId: DEAL_ID,
    dealLabel: 'share — Auxicare',
    current: currentAuxicare(),
    extractions,
  })

const find = (
  plan: ReturnType<typeof planDeal>,
  entityType: string,
  field: string,
) => plan.rows.find((r) => r.entityType === entityType && r.field === field)

describe('backfill Auxicare — cas de référence', () => {
  it('propose exactement les champs de la fiche validée à la main', () => {
    const plan = planAuxicare()
    const proposals = plan.rows
      .filter((r) => r.section === 'PROPOSITION')
      .map((r) => [r.entityType, r.field, r.proposedValue] as const)

    expect(proposals).toEqual([
      ['company', 'legalName', 'AUXICARE'],
      ['company', 'legalForm', 'SAS'],
      ['company', 'countryCode', 'FR'],
      ['deal', 'sharesAcquired', '14286'],
      ['deal', 'pricePerShare', '700'],
      ['deal', 'roundSize', '56000000'],
      ['deal', 'closingDate', '2026-06-09'],
      ['deal', 'roundType', 'seed'],
      ['deal', 'ownershipPct', '234'],
      ['deal', 'postMoneyValuation', '426955200'],
      ['deal', 'preMoneyValuation', '370955200'],
      [
        'deal',
        'notes',
        'base FD post-money : 609 936 titres (548 943 émis + pool BSPCE 60 993)',
      ],
    ])
  })

  it('ne touche pas les champs déjà justes et ne produit ni écart ni non-traité', () => {
    const plan = planAuxicare()
    expect(plan.confirmed).toEqual([
      'company.siren',
      'company.totalShares',
      'deal.signedDate',
    ])
    expect(plan.rows.filter((r) => r.section === 'ECART')).toEqual([])
    expect(plan.rows.filter((r) => r.section === 'NON_TRAITE')).toEqual([])
  })

  it('reprend le % du pacte tel quel, sans le recalculer, et le marque base FD', () => {
    const row = find(planAuxicare(), 'deal', 'ownershipPct')
    // 14 286 / 548 943 (non dilué) donnerait 260 bps — c'est le chiffre que la
    // fiche société affiche, et ce n'est PAS celui qu'on stocke.
    expect(row?.proposedValue).toBe('234')
    expect(row?.derived).toBe(false)
    expect(row?.flags).toEqual(['base=FD_cap_table'])
    expect(row?.quote).toBe('ALBO CLUB — 14 286 — 2,34 %')
  })

  it('marque les valorisations comme dérivées et signale la conversion à prix réduit', () => {
    const plan = planAuxicare()
    for (const field of ['postMoneyValuation', 'preMoneyValuation']) {
      const row = find(plan, 'deal', field)
      expect(row?.derived).toBe(true)
      expect(row?.flags).toContain('instruments_convertis_a_prix_reduit')
    }
  })

  it('sans instrument converti à prix réduit, les valorisations ne portent pas le flag', () => {
    const noDiscount = pv()
    noDiscount.discountedConversion = null
    const plan = planAuxicare([noDiscount, bulletin(), pacte()])
    expect(find(plan, 'deal', 'postMoneyValuation')?.flags).toEqual([])
  })
})

describe('backfill — les trois nombres d’actions', () => {
  it('totalShares prend les actions émises, jamais la base pleinement diluée', () => {
    // The base is empty here so the row surfaces instead of being confirmed.
    const plan = planDeal({
      companyId: COMPANY_ID,
      companyName: 'Auxicare',
      dealId: DEAL_ID,
      dealLabel: 'share — Auxicare',
      current: {
        ...currentAuxicare(),
        company: { ...currentAuxicare().company, totalShares: undefined },
      },
      extractions: [pv(), bulletin(), pacte()],
    })
    const row = find(plan, 'company', 'totalShares')
    expect(row?.proposedValue).toBe('548943')
    expect(row?.proposedValue).not.toBe('609936')
  })

  it("n'écrit rien dans totalShares quand seule la base FD est connue", () => {
    const pvWithoutIssued = pv()
    pvWithoutIssued.company.issuedShares = null
    const plan = planAuxicare([pvWithoutIssued, bulletin(), pacte()])
    const row = find(plan, 'company', 'totalShares')
    expect(row?.section).toBe('NON_TRAITE')
    expect(row?.proposedValue).toBe('')
    expect(row?.flags).toEqual(['base_FD_seule_non_ecrite_en_actions'])
  })

  it('signale une base FD incohérente avec le % imprimé', () => {
    const wrongBase = pacte()
    // 480 000 is the capital after the capital increase ALONE — the wrong base.
    wrongBase.company.fullyDilutedShares = cited(
      480000,
      'Total : 480 000 titres',
    )
    const row = find(
      planAuxicare([pv(), bulletin(), wrongBase]),
      'deal',
      'ownershipPct',
    )
    expect(
      row?.flags.some((f) => f.startsWith('coherence_base_FD_douteuse')),
    ).toBe(true)
  })
})

describe('backfill — hiérarchie des sources et règle cardinale', () => {
  it('le PV prime sur le pacte quand les deux datent le closing', () => {
    const latePacte = pacte()
    latePacte.deal.closingDate = cited(
      '2026-07-01',
      'clôture prévue le 1er juillet 2026',
    )
    const row = find(
      planAuxicare([pv(), bulletin(), latePacte]),
      'deal',
      'closingDate',
    )
    expect(row?.proposedValue).toBe('2026-06-09')
    expect(row?.docTitle).toBe('PV du Président — réalisation définitive')
  })

  it('un term sheet seul ne remplit aucun champ', () => {
    const ts = emptyDoc('doc_ts', 'Term sheet', 'term_sheet')
    ts.deal.valuationCapEur = cited(8000000, 'cap de 8 000 000 €')
    const row = find(
      planAuxicare([pv(), bulletin(), pacte(), ts]),
      'deal',
      'valuationCap',
    )
    expect(row?.section).toBe('NON_TRAITE')
    expect(row?.flags).toEqual(['term_sheet_seul_non_autoritatif'])
  })

  it('un BP n’est jamais une source', () => {
    const bp = emptyDoc('doc_bp', 'Business plan', 'bp')
    bp.deal.roundSizeEur = cited(9999999, 'levée cible 9 999 999 €')
    const row = find(
      planAuxicare([pv(), bulletin(), pacte(), bp]),
      'deal',
      'roundSize',
    )
    expect(row?.proposedValue).toBe('56000000')
  })

  it('deux documents de même rang qui se contredisent ne remplissent rien', () => {
    const otherPv = pv()
    otherPv.documentId = 'doc_pv2'
    otherPv.company.issuedShares = cited(480000, 'divisé en 480 000 actions')
    const plan = planDeal({
      companyId: COMPANY_ID,
      companyName: 'Auxicare',
      dealId: DEAL_ID,
      dealLabel: 'share — Auxicare',
      current: {
        ...currentAuxicare(),
        company: { ...currentAuxicare().company, totalShares: undefined },
      },
      extractions: [pv(), otherPv, bulletin(), pacte()],
    })
    const row = find(plan, 'company', 'totalShares')
    expect(row?.section).toBe('NON_TRAITE')
    expect(row?.flags).toEqual(['conflit_sources_meme_rang'])
  })

  it('une valeur qui contredit la base part en ÉCART, jamais en proposition', () => {
    const current = currentAuxicare()
    current.deal.sharesAcquired = 14000
    const plan = planDeal({
      companyId: COMPANY_ID,
      companyName: 'Auxicare',
      dealId: DEAL_ID,
      dealLabel: 'share — Auxicare',
      current,
      extractions: [pv(), bulletin(), pacte()],
    })
    const row = find(plan, 'deal', 'sharesAcquired')
    expect(row?.section).toBe('ECART')
    expect(row?.currentValue).toBe('14000')
    expect(row?.proposedValue).toBe('14286')
  })

  it('une valeur sans extrait justificatif est rejetée', () => {
    const noQuote = bulletin()
    noQuote.deal.sharesAcquired = cited(14286, '   ')
    const plan = planAuxicare([pv(), noQuote, pacte()])
    expect(find(plan, 'deal', 'sharesAcquired')).toBeUndefined()
  })
})

describe('backfill — repli non dilué et roundType', () => {
  it('sans table de capitalisation, le % est calculé en non dilué ET flaggé', () => {
    const noCapTable = pacte()
    noCapTable.deal.ownershipPctFromCapTable = null
    const row = find(
      planAuxicare([pv(), bulletin(), noCapTable]),
      'deal',
      'ownershipPct',
    )
    // 14 286 / 548 943 = 2,602 % → 260 bps
    expect(row?.proposedValue).toBe('260')
    expect(row?.derived).toBe(true)
    expect(row?.flags).toEqual(['base=non_dilué'])
  })

  it('roundType reste vide et flaggé quand aucun document ne qualifie le tour', () => {
    const unqualified = pacte()
    unqualified.deal.roundType = null
    const row = find(
      planAuxicare([pv(), bulletin(), unqualified]),
      'deal',
      'roundType',
    )
    expect(row?.section).toBe('NON_TRAITE')
    expect(row?.flags).toEqual(['non_qualifie_par_les_documents'])
  })

  it('roundType hors enum ne passe pas', () => {
    const odd = pacte()
    odd.deal.roundType = cited(
      'pre-série A bis',
      'tour qualifié de pré-série A bis',
    )
    const row = find(planAuxicare([pv(), bulletin(), odd]), 'deal', 'roundType')
    expect(row?.section).toBe('NON_TRAITE')
    expect(row?.flags).toEqual(['hors_enum:pre-série A bis'])
  })
})
