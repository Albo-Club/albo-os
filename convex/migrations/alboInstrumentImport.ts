/**
 * One-shot import of instrument detail fields for the 51 deals of the `albo`
 * org, extracted from the legal documents stored in the Google Drive folder
 * « ⚠️ Investissements » (subscription bulletins, bond issuance contracts,
 * royalty contracts, shareholder agreements, cap tables, board minutes).
 *
 * Every value below was extracted with a source document + supporting quote
 * (session extraction files + review table shared with Benjamin on
 * 13/07/2026). Review decisions applied:
 *   - 'semestriel' added to COUPON_PERIODICITIES (Parallel SPV 23, CDB).
 *   - Keenest requalified spv_share → bsa_air (direct BSA AIR, no SPV).
 *   - Waro stays 'share' (OCA 2024 converted into shares on 15/04/2026).
 *   - SPV structuring fees documented as % at SPV level → NOT imported
 *     (the column expects a euro amount billed to Albo).
 *   - Lead SPV: fee 5% one-shot, hurdle 0, carried 15% (ADP pool rate).
 *   - Royalty depreciationRate 20% = internal BP haircut (non-contractual,
 *     imported on purpose: that is the role of the field).
 *   - Secondary purchases (Resilience, RGOODS, Redesk): only closingDate,
 *     ownershipPct and the implied 100% valuation as postMoneyValuation.
 *   - Low-confidence estimates (SPV % computed on max emission, unknown
 *     round valuations) are NOT imported.
 *   - signedDate / amounts / statuses entered by hand are NEVER touched.
 *
 * Idempotent & non-destructive: `apply` only fills fields that are currently
 * `undefined` on the deal (except the explicit Keenest requalification,
 * which rewrites instrumentKind and is idempotent by value). Deals are
 * anchored by their prod `_id`, cross-checked against org slug + target
 * company name — any mismatch skips the deal and is reported.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/alboInstrumentImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/alboInstrumentImport:apply
 *   pnpm exec convex run --prod migrations/alboInstrumentImport:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'albo'

/** ms epoch at UTC midnight. */
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day)

type DealPatch = {
  dealId: string
  /** Exact prod target company name — safety cross-check before patching. */
  expectedTarget: string
  /** Fields written only if currently undefined on the deal. */
  fields: Record<string, number | string>
  /** Written unconditionally (explicit requalification). */
  force?: Record<string, string>
}

// Amounts in CENTS, rates in BASIS POINTS, dates in ms epoch (UTC),
// floor/cap multiples as decimals — same conventions as convex/schema.ts.
const PATCHES: Array<DealPatch> = [
  // ── Obligations simples ────────────────────────────────────────────────
  {
    dealId: 'k5794kndta6n243wp0kg5d056n87rgy5',
    expectedTarget: 'Parallel Invest SPV 10 (Arcachon)',
    fields: {
      closingDate: d(2024, 11, 19),
      principalAmount: 200_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
      // maturityDate: contractual (18 months after funds reach the target),
      // no calendar date in the docs.
    },
  },
  {
    dealId: 'k57ddjdsadd243g9bvnhgk07ph87rpdm',
    expectedTarget: 'Parallel Invest SPV 13 (Bernay)',
    fields: {
      closingDate: d(2025, 3, 5),
      principalAmount: 100_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    dealId: 'k57d729ctftwg8627ahhzqabvn87sbmv',
    expectedTarget: 'Parallel Invest SPV 18 (Bour)',
    fields: {
      closingDate: d(2025, 12, 11),
      principalAmount: 100_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    dealId: 'k57ct418pbqtfbb9r45b0zm26d87sh2z',
    expectedTarget: 'Parallel Invest SPV 23 (STOA - Pessac)',
    fields: {
      closingDate: d(2026, 4, 29),
      principalAmount: 100_000_00,
      interestRate: 1050,
      couponPeriodicity: 'semestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    dealId: 'k57fb555kzss55k5dnqf5x7bg587rb9x',
    expectedTarget: 'Les constructeurs du bois',
    fields: {
      closingDate: d(2025, 1, 30),
      principalAmount: 200_000_00,
      interestRate: 1200,
      couponPeriodicity: 'semestriel',
      // Derived: issuance "at the latest 28/02/2025" + 18 months.
      maturityDate: d(2026, 8, 28),
      repaymentModality: 'in_fine',
    },
  },
  {
    dealId: 'k573n3553m4jqbx3tw9ngx3r8h87rcvj',
    expectedTarget: 'Rewatt',
    fields: {
      closingDate: d(2025, 5, 26),
      principalAmount: 310_000_00,
      interestRate: 700,
      couponPeriodicity: 'in_fine',
      maturityDate: d(2026, 12, 4), // jouissance 04/06/2025 + 18 months
      repaymentModality: 'in_fine',
    },
  },
  {
    dealId: 'k57frfhjsq7ws6t7mzewsd99nx87rhpx',
    expectedTarget: 'Rewatt',
    fields: {
      closingDate: d(2026, 2, 23),
      principalAmount: 115_000_00,
      interestRate: 600, // + 20% performance fee on the operation's net result
      couponPeriodicity: 'in_fine',
      maturityDate: d(2027, 9, 4), // jouissance 04/03/2026 + 18 months
      repaymentModality: 'in_fine',
    },
  },
  // ── Convertibles ───────────────────────────────────────────────────────
  {
    dealId: 'k57dt9hda5p80qhvf9n00sx0as87syhk',
    expectedTarget: 'Jeen',
    fields: {
      closingDate: d(2025, 12, 18),
      interestRate: 800,
      maturityDate: d(2032, 12, 31),
      conversionDiscount: 2000,
      // conversionRatio: formula (1 € / next-round share value), not a number.
    },
  },
  {
    dealId: 'k57bdjqteyb91m5md2s1rw3ats87rd65',
    expectedTarget: 'Eclo Beauty',
    fields: {
      closingDate: d(2025, 4, 17),
      safeType: 'bsa_air',
      valuationCap: 5_000_000_00,
      discount: 2000,
      conversionDeadlineDate: d(2027, 1, 31),
    },
  },
  // ── Royalties ──────────────────────────────────────────────────────────
  {
    dealId: 'k57dqt4bahgdpbn9hj27zap56s87s6yp',
    expectedTarget: 'La Vie de Quartier - Rue du RDV',
    fields: {
      capitalInvested: 50_000_00,
      depreciationRate: 2000,
      royaltyRate: 217,
      investmentDate: d(2026, 4, 1),
      royaltyStartDate: d(2026, 4, 1),
      floorMultiple: 1.25,
      capMultiple: 2,
      endDate: d(2031, 5, 31),
    },
  },
  {
    dealId: 'k57e8x1dk0q6cnt7b0xf9d7vrh87syvz',
    expectedTarget: 'La Vie de Quartier - Rue St Maur',
    fields: {
      capitalInvested: 50_000_00,
      depreciationRate: 2000,
      royaltyRate: 217,
      investmentDate: d(2025, 7, 1),
      royaltyStartDate: d(2025, 10, 1),
      floorMultiple: 1.25,
      capMultiple: 2,
      endDate: d(2031, 5, 31),
    },
  },
  {
    dealId: 'k57894m4z1t3pfk2pjg3xhvh7h89kdvd',
    expectedTarget: 'La Vie de Quartier - Bdv Voltaire',
    fields: {
      capitalInvested: 50_000_00,
      depreciationRate: 2000,
      royaltyRate: 217,
      floorMultiple: 1.25,
      capMultiple: 2,
      endDate: d(2031, 5, 31),
      // investmentDate / royaltyStartDate: no Voltaire-specific document.
    },
  },
  {
    dealId: 'k5723pf35sphx497c8xgaffmjn87rtcd',
    expectedTarget: 'JOONE Paris',
    fields: {
      capitalInvested: 300_000_00,
      depreciationRate: 2000,
      royaltyRate: 52,
      investmentDate: d(2025, 7, 24),
      royaltyStartDate: d(2025, 12, 1),
      floorMultiple: 1.3,
      capMultiple: 2,
      endDate: d(2028, 7, 31),
    },
  },
  {
    dealId: 'k576vfy7dyggs111xkj9b6d2rs87skf4',
    expectedTarget: 'The Fat Broccoli',
    fields: {
      capitalInvested: 50_000_00,
      depreciationRate: 2000,
      royaltyRate: 383,
      investmentDate: d(2025, 6, 16),
      royaltyStartDate: d(2026, 1, 1),
      floorMultiple: 1.15,
      capMultiple: 2,
      endDate: d(2028, 6, 30),
    },
  },
  // ── Equity direct (tours primaires) ────────────────────────────────────
  {
    dealId: 'k57evghp0zczw6ff8eeq5td49187s984',
    expectedTarget: 'CarbonFarm',
    fields: {
      closingDate: d(2026, 5, 11),
      roundSize: 3_643_636_26,
      roundType: 'serieA',
      preMoneyValuation: 14_998_655_32,
      postMoneyValuation: 18_642_291_58,
      ownershipPct: 80.47,
    },
  },
  {
    dealId: 'k570evmfcj1ctgv9bx18qhmv5n87sm73',
    expectedTarget: 'Goodvest',
    fields: {
      closingDate: d(2025, 7, 31),
      roundSize: 7_816_879_36,
      roundType: 'serieB',
      preMoneyValuation: 25_825_117_36,
      postMoneyValuation: 33_641_996_72,
      ownershipPct: 74.33,
    },
  },
  {
    dealId: 'k578rt5scem6tfw02v2ekhk70587s24d',
    expectedTarget: 'Komeet',
    fields: {
      closingDate: d(2025, 12, 8),
      roundSize: 349_974_78,
      roundType: 'bridge',
      preMoneyValuation: 19_493_668_26,
      postMoneyValuation: 19_843_643_04,
      ownershipPct: 37.79,
    },
  },
  {
    dealId: 'k57654ar7h4k6tp94gt0seedk187rty6',
    expectedTarget: 'ACT Running',
    fields: {
      closingDate: d(2025, 9, 5),
      roundSize: 143_920_00,
      roundType: 'seed',
      preMoneyValuation: 2_856_080_00,
      postMoneyValuation: 3_000_000_00,
      ownershipPct: 83.47,
    },
  },
  {
    dealId: 'k5769ha7b122w80m0ecz3cq15n87rvp1',
    expectedTarget: 'Bleen',
    fields: {
      closingDate: d(2024, 12, 16),
      roundSize: 391_968_00,
      roundType: 'seed',
      preMoneyValuation: 5_000_000_00,
      postMoneyValuation: 5_391_968_00,
      ownershipPct: 93.14,
    },
  },
  {
    dealId: 'k57dh8a1gtn1zrjm8semtx5dhs87s4cq',
    expectedTarget: 'Losanje',
    fields: {
      closingDate: d(2025, 4, 1),
      roundSize: 1_625_076_20,
      roundType: 'serieA',
      preMoneyValuation: 4_287_800_00,
      postMoneyValuation: 5_912_876_20,
      ownershipPct: 42.29,
    },
  },
  {
    dealId: 'k57f6vqqbpk8qgvc17bm7abrv187ss44',
    expectedTarget: 'Ouisub',
    fields: {
      closingDate: d(2025, 11, 14),
      roundSize: 349_980_00,
      roundType: 'seed',
      preMoneyValuation: 1_500_000_00,
      postMoneyValuation: 1_849_980_00,
      ownershipPct: 540,
    },
  },
  {
    dealId: 'k57d3kfhcbj1tvz8t3f9jqzt2187sb6f',
    expectedTarget: 'Reekom',
    fields: {
      closingDate: d(2025, 4, 16),
      roundSize: 451_906_86,
      roundType: 'seed',
      preMoneyValuation: 5_316_102_64,
      postMoneyValuation: 5_768_009_50,
      ownershipPct: 171.9,
    },
  },
  {
    dealId: 'k57ad4cy5kw85wg0q45aswkaxh87snxh',
    expectedTarget: 'Tango',
    fields: {
      closingDate: d(2025, 12, 16),
      roundSize: 359_919_00,
      roundType: 'seed',
      preMoneyValuation: 2_100_000_00,
      postMoneyValuation: 2_459_919_00,
      ownershipPct: 101.59,
    },
  },
  {
    dealId: 'k571b3sa745668fe6pajr73xn987rvwg',
    expectedTarget: 'Cockpit Agriculture',
    fields: {
      closingDate: d(2025, 8, 8),
      roundSize: 675_136_00,
      roundType: 'seed',
      preMoneyValuation: 2_800_000_00,
      postMoneyValuation: 3_475_136_00,
      ownershipPct: 144,
    },
  },
  {
    dealId: 'k572np7en51emfamxem8w090ws87rcf4',
    expectedTarget: 'RegenSchool',
    fields: {
      closingDate: d(2025, 7, 30),
      roundSize: 1_675_010_40,
      roundType: 'seed',
      preMoneyValuation: 10_000_000_00,
      postMoneyValuation: 12_000_000_00,
      ownershipPct: 44,
    },
  },
  {
    dealId: 'k57ar58ca745qncm18jzj1e9px87r2h6',
    expectedTarget: 'Beyond Green',
    fields: {
      closingDate: d(2025, 2, 17),
      roundSize: 1_242_399_52,
      roundType: 'bridge',
      preMoneyValuation: 5_393_361_00,
      postMoneyValuation: 6_635_760_96,
      ownershipPct: 75,
    },
  },
  {
    dealId: 'k57dthzdvxwqv6rk7p07mxdhq587wqwg',
    expectedTarget: 'Auxicare',
    fields: {
      closingDate: d(2026, 5, 29),
      roundSize: 560_000_00,
      roundType: 'seed',
      preMoneyValuation: 2_800_000_00,
      postMoneyValuation: 3_360_000_00,
      ownershipPct: 260,
    },
  },
  {
    dealId: 'k5713p6axhdyqwr0fxevh0jwv587snqz',
    expectedTarget: 'Waro',
    fields: {
      // OCA 2024 (75 k€, 6%/yr) converted into 240 shares on 15/04/2026.
      // No priced round → no pre/post-money; ownership estimate too fragile.
      closingDate: d(2024, 11, 28),
      roundSize: 390_000_00,
      roundType: 'bridge',
    },
  },
  {
    dealId: 'k57bfj3mt6w3h9a252qwr33w5588db3q',
    expectedTarget: 'Wheelee - Loewi',
    fields: {
      closingDate: d(2025, 7, 15),
      roundSize: 390_389_69,
      roundType: 'seed',
      preMoneyValuation: 6_492_810_37,
      postMoneyValuation: 6_932_158_14,
      ownershipPct: 145,
    },
  },
  {
    dealId: 'k5737vashjjr04y4ynxkkeb4d987ss5x',
    expectedTarget: 'The Fat Broccoli',
    fields: {
      closingDate: d(2025, 7, 18),
      roundSize: 59_504_00,
      roundType: 'bridge',
      preMoneyValuation: 1_206_000_00,
      postMoneyValuation: 1_265_504_00,
      ownershipPct: 40,
    },
  },
  {
    dealId: 'k57ckerxcddgw0j6kg8k43dsxd87sy7z',
    expectedTarget: 'La vie de Quartier - Holding',
    fields: {
      // BSA AIR (50 k€, 05/06/2025) converted at the seed round of 29/07/2025.
      closingDate: d(2025, 6, 5),
      roundSize: 250_605_75,
      roundType: 'seed',
      preMoneyValuation: 2_700_000_00,
      postMoneyValuation: 3_069_815_00,
      ownershipPct: 194,
    },
  },
  // ── Rachats secondaires (no round) ─────────────────────────────────────
  {
    dealId: 'k57ah2x7ekz1n7pdfjaxdtcb9d87ranf',
    expectedTarget: 'Resilience',
    fields: {
      closingDate: d(2024, 11, 21),
      // Implied 100% valuation at the 56,20 €/share purchase price.
      postMoneyValuation: 106_066_035_00,
      ownershipPct: 23.57,
    },
  },
  {
    dealId: 'k57bs9q9s636cgnmpamnxbr7v987swm3',
    expectedTarget: 'RGOODS',
    fields: {
      closingDate: d(2024, 12, 2),
      postMoneyValuation: 5_400_000_00,
      ownershipPct: 170.83,
    },
  },
  {
    dealId: 'k57dmy590be53ayydzdy8pgpv58a617c',
    expectedTarget: 'Redesk',
    fields: {
      closingDate: d(2026, 6, 25),
      postMoneyValuation: 1_800_000_00,
      ownershipPct: 556,
    },
  },
  {
    dealId: 'k577zr8t94j8jjk26qbwzp3jhn88q42e',
    expectedTarget: 'Oprtrs & Co',
    fields: {
      // Off-market share purchase recorded under the fonds/secondary config.
      fundType: 'secondaire',
      vintageYear: 2026,
    },
  },
  // ── Fonds ──────────────────────────────────────────────────────────────
  {
    dealId: 'k57byeb74fmtx6hz0drh4552dn8acy2n',
    expectedTarget: 'Hexa Sprint Carbone Zero',
    fields: {
      // Vehicle legal name: « Hexa Sprint Climate SSi » (Belgian société
      // simple). Side letter: carried reduced to 10% flat for Albo Club.
      fundType: 'vc',
      vintageYear: 2026,
      managementCompany: 'eClub Administration SRL (Hexa)',
    },
  },
  // ── Via SPV ────────────────────────────────────────────────────────────
  {
    dealId: 'k5753jy27x41r2w0dx6c5spks187sfcc',
    expectedTarget: 'Wandercraft',
    fields: { closingDate: d(2025, 4, 28), spvName: 'PPLFIRST-RNO' },
  },
  {
    dealId: 'k579envxkt9bykb4w1na87ws6d87s5tt',
    expectedTarget: 'BackMarket',
    fields: { closingDate: d(2025, 12, 17), spvName: 'PPLFIRST-SPK' },
  },
  {
    dealId: 'k574vtdt7scdvtszc513fq4ma987sq4b',
    expectedTarget: 'Ziwig',
    fields: {
      closingDate: d(2025, 1, 15),
      spvName: 'ZIWIG SPV 2',
      spvOwnershipPct: 1199,
    },
  },
  {
    dealId: 'k57a96gcs7nw378j8w9pc6frpn87s9yz',
    expectedTarget: 'AZmed',
    fields: { closingDate: d(2024, 11, 12), spvName: 'PPLFIRST-FCO' },
  },
  {
    dealId: 'k57bhdttdv0ag7ykjch73aa2vn87rcnr',
    expectedTarget: 'Upcyclea',
    fields: {
      closingDate: d(2024, 11, 8),
      spvName: 'Family Ventures Side Upcyclea',
      preMoneyValuation: 5_900_000_00,
    },
  },
  {
    dealId: 'k571bb6q2mp72278tb16zs2hr187ss8p',
    expectedTarget: 'Versant',
    fields: { closingDate: d(2025, 1, 10), spvName: 'Versant SPV' },
  },
  {
    dealId: 'k57ev84p0j30y7sv231gb6js2x87savr',
    expectedTarget: 'Genomines',
    fields: { closingDate: d(2025, 7, 18), spvName: 'PPLFIRST-INN' },
  },
  {
    dealId: 'k572800bm3v4gj4c7ah3aeg9z187sr0c',
    expectedTarget: 'Hectarea',
    fields: {
      closingDate: d(2026, 3, 30),
      spvName: 'Roundtable - Hectarea - Albo',
      preMoneyValuation: 2_700_000_00,
      postMoneyValuation: 3_809_255_41,
    },
  },
  {
    dealId: 'k571h5ad689a4syxf9mc6gd0en87smqy',
    expectedTarget: 'Eben Home',
    fields: {
      closingDate: d(2026, 3, 25),
      spvName: 'Roundtable - Ebenhome - Calte',
      preMoneyValuation: 5_888_464_00,
      postMoneyValuation: 6_238_463_00,
    },
  },
  {
    dealId: 'k574ra5htzht65k4kc9tjmyz9d87s0rh',
    expectedTarget: 'Eben Home',
    fields: {
      closingDate: d(2025, 9, 8),
      spvName: 'Roundtable - Ebenhome - Calte',
      spvOwnershipPct: 29,
      preMoneyValuation: 5_300_673_00,
      postMoneyValuation: 5_832_622_00,
    },
  },
  {
    dealId: 'k57afb4vf6dyq0r7bgmn4e9wsx87rhae',
    expectedTarget: 'Sezame Immo 6',
    fields: {
      closingDate: d(2026, 4, 13),
      spvName: 'Sezame Immo 6',
      spvOwnershipPct: 625,
    },
  },
  {
    dealId: 'k5740d0qd028kqytwe2y80td4d87saym',
    expectedTarget: 'Sezame Immo 2',
    // Real-estate club deal at par: round/valuation fields do not apply.
    fields: { closingDate: d(2025, 3, 27) },
  },
  // ── Keenest: requalification spv_share → bsa_air ───────────────────────
  {
    dealId: 'k57e083mb3awn1c9e788epxz7n87rjt5',
    expectedTarget: 'Keenest',
    force: { instrumentKind: 'bsa_air', safeType: 'bsa_air' },
    fields: {
      // Direct BSA AIR in Keen Impact SAS — no SPV involved. Possible
      // conversion in Oct 2025 (Drive folder), not confirmed by a document.
      closingDate: d(2025, 3, 14),
      valuationCap: 6_000_000_00,
      discount: 1000,
      conversionDeadlineDate: d(2025, 10, 12),
    },
  },
  // ── Lead SPV ───────────────────────────────────────────────────────────
  {
    dealId: 'k5736rshnvhdmx4nms48fjj4qd89ghz9',
    expectedTarget: 'Hectarea',
    fields: {
      // amountRaised estimated (target investment 289 749,62 € / 0,95).
      amountRaised: 305_000_00,
      managementFeeRate: 500, // 5% one-shot at closing (not annual)
      hurdleRate: 0,
      carriedRate: 1500, // ADP pool rate; Albo holds 8 688/10 000 ADP
    },
  },
  {
    dealId: 'k575gc1eyfb9zvfvgbc61ah8yd89gn28',
    expectedTarget: 'Eben Home',
    fields: {
      // Estimated (two convergent derivations: ~341-345 k€).
      amountRaised: 343_000_00,
      managementFeeRate: 500,
      hurdleRate: 0,
      carriedRate: 1500, // Albo holds 9 267/10 000 ADP
    },
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAlboOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('albo_org_not_found')
  return org
}

/**
 * Resolve a patch spec to its deal + the subset of fields that would be
 * written. Returns a skip reason instead when the safety checks fail.
 */
async function resolvePatch(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: DealPatch,
): Promise<
  | {
      deal: Doc<'deals'>
      toWrite: Record<string, number | string>
      alreadySet: Array<string>
    }
  | { skip: string }
> {
  const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
  if (!deal) return { skip: 'deal_not_found' }
  if (deal.orgId !== orgId) return { skip: 'wrong_org' }
  const target = await ctx.db.get('companies', deal.targetCompanyId)
  if (!target || target.name !== spec.expectedTarget)
    return { skip: `target_mismatch (found: ${target?.name ?? 'none'})` }

  const record = deal as unknown as Record<string, unknown>
  const toWrite: Record<string, number | string> = {}
  const alreadySet: Array<string> = []
  for (const [key, value] of Object.entries(spec.fields)) {
    if (record[key] === undefined) toWrite[key] = value
    else alreadySet.push(key)
  }
  for (const [key, value] of Object.entries(spec.force ?? {})) {
    if (record[key] !== value) toWrite[key] = value
  }
  return { deal, toWrite, alreadySet }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const plan = []
    const skipped = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ dealId: spec.dealId, target: spec.expectedTarget, reason: resolved.skip })
        continue
      }
      plan.push({
        target: spec.expectedTarget,
        dealId: spec.dealId,
        instrumentKind: resolved.deal.instrumentKind,
        willWrite: resolved.toWrite,
        alreadySet: resolved.alreadySet,
      })
    }
    return {
      org: org.slug,
      dealsPlanned: plan.length,
      fieldsToWrite: plan.reduce((n, p) => n + Object.keys(p.willWrite).length, 0),
      skipped,
      plan,
      note:
        'Lecture seule. Valider ce rapport puis lancer ' +
        'migrations/alboInstrumentImport:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    let dealsPatched = 0
    let fieldsWritten = 0
    const untouched: Array<string> = []
    const skipped: Array<{ dealId: string; target: string; reason: string }> = []

    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ dealId: spec.dealId, target: spec.expectedTarget, reason: resolved.skip })
        continue
      }
      const keys = Object.keys(resolved.toWrite)
      if (keys.length === 0) {
        untouched.push(spec.expectedTarget)
        continue
      }
      await ctx.db.patch(
        'deals',
        resolved.deal._id,
        resolved.toWrite as Partial<Doc<'deals'>>,
      )
      dealsPatched++
      fieldsWritten += keys.length
    }

    return { dealsPatched, fieldsWritten, untouched, skipped }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const issues = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        issues.push({ target: spec.expectedTarget, dealId: spec.dealId, issue: resolved.skip })
        continue
      }
      // After apply, every planned field must be set (toWrite empty).
      const missing = Object.keys(resolved.toWrite)
      if (missing.length > 0)
        issues.push({ target: spec.expectedTarget, dealId: spec.dealId, issue: `not_written: ${missing.join(', ')}` })
    }
    return { org: org.slug, allOk: issues.length === 0, dealsChecked: PATCHES.length, issues }
  },
})
