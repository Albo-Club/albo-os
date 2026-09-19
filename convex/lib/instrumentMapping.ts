import type { InstrumentKind } from './instruments'

/**
 * Instrument archetypes — single source of truth for the deal/instrument
 * dashboard refonte. The front (deal fiche, forms) and reporting read these
 * constants. NEVER duplicate this mapping elsewhere.
 *
 * Each `instrumentKind` (every value in ./instruments) belongs to exactly
 * one archetype and has exactly one render mode:
 *   - 'fields'      → INSTRUMENT_FIELDS lists the ordered `deals` columns to show
 *   - 'custom'      → a bespoke panel renders the central block (lead_spv →
 *                     LeadSpvPanel; royalty still on a placeholder)
 *   - 'placeholder' → layout not designed yet; show a neutral "type non encore
 *                     configuré" block (cto only).
 *
 * 'unassigned' is the holding bucket for the placeholder kinds (`cto`, lacking
 * a prod deal to model its layout from, and the Attio-sync `unknown` fallback),
 * so INSTRUMENT_ARCHETYPE stays a total Record over every InstrumentKind.
 */
export type Archetype =
  | 'equity'
  | 'debt'
  | 'funds_lp'
  | 'real_estate'
  | 'royalties'
  | 'management'
  | 'placement'
  | 'unassigned'

export type RenderMode = 'fields' | 'custom' | 'placeholder'

/**
 * Treasury placements — the deals tracked as an ACCOUNT (a balance you update
 * and an annualized yield), not as a participation: they live on the dedicated
 * Placements page and are excluded from the Participations list. Scope rule
 * (fixed with ALB-82): crypto, capitalization accounts, term deposits (dat)
 * and brokerage accounts (cto). Distinct from the 'placement' ARCHETYPE, which
 * only drives the deal-sheet field layout (dat keeps its debt fields, cto its
 * placeholder).
 */
export const TREASURY_PLACEMENT_KINDS: ReadonlySet<InstrumentKind> = new Set([
  'crypto',
  'capitalization_account',
  'dat',
  'cto',
])

/** Whether a deal belongs to the Placements page (loose string overload for
 * front rows typed `instrumentKind: string`). */
export function isTreasuryPlacement(kind: string): boolean {
  return TREASURY_PLACEMENT_KINDS.has(kind as InstrumentKind)
}

/**
 * Liquidity buckets of the Placements page, most liquid first. A placement's
 * bucket defaults from its instrument kind (DEFAULT_PLACEMENT_LIQUIDITY
 * below); the optional per-deal `deals.liquidity` override lets the user
 * reclassify a single placement.
 */
export type PlacementLiquidity = 'liquid' | 'semi_liquid' | 'illiquid'

export const PLACEMENT_LIQUIDITIES: ReadonlyArray<PlacementLiquidity> = [
  'liquid',
  'semi_liquid',
  'illiquid',
]

/** Default liquidity per treasury-placement kind (TREASURY_PLACEMENT_KINDS). */
const DEFAULT_PLACEMENT_LIQUIDITY: Record<string, PlacementLiquidity> = {
  cto: 'liquid',
  crypto: 'liquid',
  dat: 'semi_liquid',
  capitalization_account: 'illiquid',
}

/**
 * Resolves a placement's liquidity bucket: the per-deal override wins when it
 * is a valid bucket, otherwise the default for the instrument kind, with
 * 'semi_liquid' as a safe fallback for unknown kinds.
 */
export function placementLiquidity(
  kind: string,
  override?: string | null,
): PlacementLiquidity {
  if (
    override &&
    (PLACEMENT_LIQUIDITIES as ReadonlyArray<string>).includes(override)
  ) {
    return override as PlacementLiquidity
  }
  return DEFAULT_PLACEMENT_LIQUIDITY[kind] ?? 'semi_liquid'
}

/** instrumentKind → archetype. Total Record (every InstrumentKind). */
export const INSTRUMENT_ARCHETYPE: Record<InstrumentKind, Archetype> = {
  // equity. safe config keeps only safe / bsa_air; bsa has its own config
  // (warrants), oc + convertible_note share the oc config (convertible bond) —
  // see KNOWN_ISSUES "Archétypes d'instruments".
  share: 'equity',
  bsa: 'equity',
  bsa_air: 'equity',
  safe: 'equity',
  oc: 'equity',
  convertible_note: 'equity',
  // equity held indirectly through an SPV — the deal's target is the underlying
  // company (targetCompanyId), the SPV is just a holding method (spvName + fees).
  spv_share: 'equity',
  // equity stake we HOLD in a carried-interest / management vehicle (Manco,
  // e.g. OPRTRS & Co): the vehicle distributes carry. Not lead_spv — that's the
  // management side (fees + carried WE earn).
  carry_vehicle: 'equity',
  // management revenue as lead of an SPV (fees + carried) — not a placement:
  // the deal tracks what you earn managing the SPV, not an investment.
  lead_spv: 'management',
  // debt (loan reuses the os field config)
  os: 'debt',
  loan: 'debt',
  cca: 'debt',
  dat: 'debt',
  // funds_lp
  fund_lp: 'funds_lp',
  // real_estate
  real_estate_direct: 'real_estate',
  scpi: 'real_estate',
  // royalties (custom panel, reserved)
  royalty: 'royalties',
  // placement (minimal treasury statement; capitalization_account reuses the
  // placement field config)
  crypto: 'placement',
  capitalization_account: 'placement',
  // parked — layout deferred, render placeholder (cto has no prod deal yet;
  // `unknown` is the Attio-sync fallback until the real instrument is set)
  cto: 'unassigned',
  unknown: 'unassigned',
}

/**
 * Whether a deal counts as an INVESTMENT in the performance figures
 * (deployed / distributed / NAV, and the MOIC / TVPI / IRR ratios).
 *
 * False for the `management` archetype — `lead_spv` alone today: such a deal
 * tracks what the org EARNS running an SPV for other investors (fees +
 * carried), not capital it put at risk. Counting it as an investment made the
 * ratios meaningless (a few thousand euros of advanced fees against tens of
 * thousands of revenue gave a MOIC of 2,84x and an IRR of 635 %) and inflated
 * both totals with money that was never invested nor returned.
 *
 * `carry_vehicle` stays a performance deal on purpose: a stake we HOLD in a
 * carried-interest vehicle is real capital out. Its own ratios will spike the
 * day the carried is distributed, the stake being nominal — a known, accepted
 * trade-off, not an oversight.
 *
 * An unknown kind counts as an investment: the fallback must never drop money
 * out of the totals in silence.
 */
export function isPerformanceDeal(kind: string): boolean {
  return INSTRUMENT_ARCHETYPE[kind as InstrumentKind] !== 'management'
}

/**
 * Instruments whose deal carries a VALUATION history — the `valuations` rows
 * read back as the line's current value (deals:lastValuationCents), which
 * feeds the TVPI of the participations list, the pledge margins, the agent
 * and the MCP.
 *
 * Closed list, arbitrated with Benjamin (ALB-248). What earns a place is a
 * value someone can actually provide: the equity and quasi-equity kinds (the
 * last round, or a write-down to zero when the target dies), the invested
 * debt (worth its outstanding principal, so cost by default — the one useful
 * entry is the impairment of a defaulting borrower), a fund's NAV from its
 * reporting, and the share price a SCPI's management company publishes.
 *
 * Deliberately OUT, each for its own reason:
 *   - the treasury placements (TREASURY_PLACEMENT_KINDS): they already have a
 *     valuation path — the `currentValue` field and the statement import,
 *     which BOTH write a `valuations` row themselves. A second path that did
 *     not also write `currentValue` would drift the Placements balance away
 *     from the last valuation.
 *   - `real_estate_direct`: a building is valued in the real-estate module
 *     (`propertyValuations`), not on the deal.
 *   - `royalty`: the line is worth its remaining contractual flows, which the
 *     royalties panel already projects — a NAV on top would double-count.
 *   - `lead_spv`: management revenue, not capital at risk (isPerformanceDeal).
 *   - `unknown`: the Attio-sync fallback, until the real instrument is set.
 */
export const VALUATION_TRACKED_KINDS: ReadonlySet<InstrumentKind> = new Set([
  'share',
  'spv_share',
  'bsa',
  'safe',
  'bsa_air',
  'oc',
  'convertible_note',
  'carry_vehicle',
  'os',
  'loan',
  'cca',
  'fund_lp',
  'scpi',
])

/** Whether a deal's sheet offers a valuation history (loose string overload
 * for front rows typed `instrumentKind: string`). */
export function tracksValuation(kind: string): boolean {
  return VALUATION_TRACKED_KINDS.has(kind as InstrumentKind)
}

/** instrumentKind → render mode. Total Record (every InstrumentKind). */
export const INSTRUMENT_RENDER: Record<InstrumentKind, RenderMode> = {
  share: 'fields',
  bsa: 'fields',
  bsa_air: 'fields',
  safe: 'fields',
  oc: 'fields',
  convertible_note: 'fields',
  os: 'fields',
  loan: 'fields',
  cca: 'fields',
  dat: 'fields',
  fund_lp: 'fields',
  spv_share: 'fields',
  carry_vehicle: 'fields',
  lead_spv: 'custom',
  real_estate_direct: 'fields',
  scpi: 'fields',
  royalty: 'custom',
  crypto: 'fields',
  capitalization_account: 'fields',
  cto: 'placeholder',
  unknown: 'placeholder',
}

// Shared field configs — ordered `deals` column names (convex/schema.ts), in
// the order of the target mapping. Several kinds point at the same layout.
const EQUITY_FIELDS = [
  'closingDate',
  'roundSize',
  'roundType',
  'preMoneyValuation',
  'postMoneyValuation',
  'sharesAcquired',
  'pricePerShare',
]

const SAFE_FIELDS = [
  'closingDate',
  'safeType',
  'valuationCap',
  'discount',
  'conversionDeadlineDate',
  'conversionValuation',
  'sharesAcquired',
]

// BSA (warrants): own list. No conversionValuation marker → the deal sheet
// renders these flat (no pre/post tabs), unlike safe/oc — see KNOWN_ISSUES.
const BSA_FIELDS = [
  'grantDate',
  'warrantsCount',
  'warrantPrice',
  'strikePrice',
  'warrantParity',
  'exerciseDeadlineDate',
  // post-exercise
  'sharesAcquired',
]

// OC (convertible bond): own list. Reuses interestRate + maturityDate (debt)
// and the safe post-conversion trio. conversionValuation as split marker →
// the deal sheet shows pre/post tabs (same mechanism as safe).
const OC_FIELDS = [
  'closingDate',
  'interestRate',
  'maturityDate',
  'conversionRatio',
  'conversionDiscount',
  // post-conversion
  'conversionValuation',
  'sharesAcquired',
]

const OS_FIELDS = [
  'closingDate',
  'principalAmount',
  'interestRate',
  'couponPeriodicity',
  'maturityDate',
  'repaymentModality',
]

const CCA_FIELDS = [
  'closingDate',
  'principalAmount',
  'interestRate',
  'maturityDate',
]

const DAT_FIELDS = [
  'closingDate',
  'principalAmount',
  'interestRate',
  'termDuration',
  'maturityDate',
  'bankName',
]

const FONDS_FIELDS = [
  'signedDate',
  'closingDate',
  'committedAmount',
  'paidAmount',
  'fundType',
  'vintageYear',
  'managementCompany',
]

// Equity via SPV: equity archetype. The underlying target is carried by
// targetCompanyId (the deal's company), so underlyingTarget stays dormant in
// the schema but is no longer displayed (it duplicated targetCompanyId).
// spvOwnershipPct (not ownershipPct) holds the stake — kept as-is, no migration.
const SPV_FIELDS = [
  'closingDate',
  'spvName',
  'spvOwnershipPct',
  'structuringFees',
  // roundType describes the underlying company's funding round — same field as
  // equity direct (EQUITY_FIELDS), placed just before the valuations.
  'roundType',
  'preMoneyValuation',
  'postMoneyValuation',
]

// Lead SPV: declarative parameters (level 1, no waterfall). Rendered by the
// custom LeadSpvPanel, but listed here so the shared edit dialog (driven by
// INSTRUMENT_FIELDS + FIELD_FORMAT) edits them — render mode (custom) and
// editable fields stay orthogonal.
const LEAD_SPV_FIELDS = [
  'amountRaised',
  'managementFeeRate',
  'hurdleRate',
  'carriedRate',
]

// Carry vehicle (Manco / carried-interest structure): an equity stake we HOLD
// in a vehicle dedicated to carried interest (e.g. OPRTRS & Co). Equity params
// only — no round/valuation (the vehicle isn't a fundraising target) — plus the
// structure's carried rate. Ownership % is NOT a deal field (it's computed at
// the company level). Distinct from lead_spv, which models the fees + carried
// WE earn managing an SPV.
const CARRY_VEHICLE_FIELDS = [
  'closingDate',
  'sharesAcquired',
  'pricePerShare',
  'carriedRate',
]

// Royalties: the three declarative parameters (level 1). Rendered by the
// custom RoyaltiesPanel, but listed here so the shared edit dialog edits them
// (render mode ≠ editable fields). The BP / actuals lists are NOT here — they
// have a dedicated UI in the panel (deals.update patch).
const ROYALTY_FIELDS = [
  'capitalInvested',
  'depreciationRate',
  'royaltyRate',
  'investmentDate',
  'royaltyStartDate',
  'floorMultiple',
  'capMultiple',
  'endDate',
]

const SCPI_FIELDS = [
  'closingDate',
  'sharesAcquired',
  'pricePerShare',
  'distributionRate',
  'managementCompany',
  'enjoymentDelayMonths',
]

const IMMO_FIELDS = [
  'closingDate',
  'acquisitionFees',
  'surfaceSqm',
  'location',
  'propertyType',
  'rentReceived',
]

const PLACEMENT_FIELDS = [
  'closingDate',
  'currentValue',
  'bankName',
]

/**
 * instrumentKind → ordered `deals` columns for the fields-rendered kinds, plus
 * the custom-rendered lead_spv and royalty. Partial: only 'placeholder' (cto)
 * is absent. lead_spv and royalty are custom-rendered but kept here so the
 * shared edit dialog can edit their declarative scalar parameters (render mode
 * ≠ editable fields). Their lists (royalty BP / actuals) are NOT here — they
 * have a dedicated UI in RoyaltiesPanel.
 */
export const INSTRUMENT_FIELDS: Partial<Record<InstrumentKind, Array<string>>> =
  {
    share: EQUITY_FIELDS,
    safe: SAFE_FIELDS,
    bsa_air: SAFE_FIELDS,
    bsa: BSA_FIELDS,
    oc: OC_FIELDS,
    convertible_note: OC_FIELDS,
    os: OS_FIELDS,
    loan: OS_FIELDS,
    cca: CCA_FIELDS,
    dat: DAT_FIELDS,
    fund_lp: FONDS_FIELDS,
    spv_share: SPV_FIELDS,
    lead_spv: LEAD_SPV_FIELDS,
    carry_vehicle: CARRY_VEHICLE_FIELDS,
    royalty: ROYALTY_FIELDS,
    scpi: SCPI_FIELDS,
    real_estate_direct: IMMO_FIELDS,
    crypto: PLACEMENT_FIELDS,
    capitalization_account: PLACEMENT_FIELDS,
  }
