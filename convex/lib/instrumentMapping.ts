import type { InstrumentKind } from './instruments'

/**
 * Instrument archetypes — single source of truth for the deal/instrument
 * dashboard refonte. The front (deal fiche, forms) and reporting read these
 * constants. NEVER duplicate this mapping elsewhere.
 *
 * Each `instrumentKind` (the 20 values in ./instruments) belongs to exactly
 * one archetype and has exactly one render mode:
 *   - 'fields'      → INSTRUMENT_FIELDS lists the ordered `deals` columns to show
 *   - 'custom'      → a bespoke panel renders the central block (lead_spv →
 *                     LeadSpvPanel; royalty still on a placeholder)
 *   - 'placeholder' → layout not designed yet; show a neutral "type non encore
 *                     configuré" block (cto only).
 *
 * 'unassigned' is the holding bucket for the placeholder kinds (only `cto`
 * remains, lacking a prod deal to model its layout from), so
 * INSTRUMENT_ARCHETYPE stays a total Record over the 20 real values.
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

/** instrumentKind → archetype. Total Record (all 19 kinds). */
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
  // management revenue as lead of an SPV (fees + carried) — not a placement:
  // the deal tracks what you earn managing the SPV, not an investment.
  lead_spv: 'management',
  // debt (loan reuses the os field config)
  os: 'debt',
  loan: 'debt',
  cca: 'debt',
  dat: 'debt',
  // funds_lp (secondary reuses the fonds field config)
  fund_lp: 'funds_lp',
  secondary: 'funds_lp',
  // real_estate
  real_estate_direct: 'real_estate',
  scpi: 'real_estate',
  // royalties (custom panel, reserved)
  royalty: 'royalties',
  // placement (minimal treasury statement; capitalization_account reuses the
  // placement field config)
  crypto: 'placement',
  capitalization_account: 'placement',
  // parked — layout deferred, render placeholder (only cto, no prod deal yet)
  cto: 'unassigned',
}

/** instrumentKind → render mode. Total Record (all 19 kinds). */
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
  lead_spv: 'custom',
  secondary: 'fields',
  real_estate_direct: 'fields',
  scpi: 'fields',
  royalty: 'custom',
  crypto: 'fields',
  capitalization_account: 'fields',
  cto: 'placeholder',
}

// Shared field configs — ordered `deals` column names (convex/schema.ts), in
// the order of the target mapping. Several kinds point at the same layout.
const EQUITY_FIELDS = [
  'closingDate',
  'paidAmount',
  'roundSize',
  'roundType',
  'preMoneyValuation',
  'postMoneyValuation',
  'ownershipPct',
]

const SAFE_FIELDS = [
  'closingDate',
  'paidAmount',
  'safeType',
  'valuationCap',
  'discount',
  'conversionDeadlineDate',
  'conversionValuation',
  'sharesAcquired',
  'ownershipPct',
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
  'ownershipPct',
]

// OC (convertible bond): own list. Reuses interestRate + maturityDate (debt)
// and the safe post-conversion trio. conversionValuation as split marker →
// the deal sheet shows pre/post tabs (same mechanism as safe).
const OC_FIELDS = [
  'closingDate',
  'paidAmount',
  'interestRate',
  'maturityDate',
  'conversionRatio',
  'conversionDiscount',
  // post-conversion
  'conversionValuation',
  'sharesAcquired',
  'ownershipPct',
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
  'paidAmount',
  'spvName',
  'spvOwnershipPct',
  'structuringFees',
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

// Royalties: the three declarative parameters (level 1). Rendered by the
// custom RoyaltiesPanel, but listed here so the shared edit dialog edits them
// (render mode ≠ editable fields). The BP / actuals lists are NOT here — they
// have a dedicated UI in the panel (deals.update patch).
const ROYALTY_FIELDS = ['capitalInvested', 'depreciationRate', 'royaltyRate']

const SCPI_FIELDS = [
  'closingDate',
  'paidAmount',
  'sharesAcquired',
  'pricePerShare',
  'distributionRate',
  'managementCompany',
  'enjoymentDelayMonths',
]

const IMMO_FIELDS = [
  'closingDate',
  'paidAmount',
  'acquisitionFees',
  'surfaceSqm',
  'location',
  'propertyType',
  'rentReceived',
]

const PLACEMENT_FIELDS = [
  'closingDate',
  'paidAmount',
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
    secondary: FONDS_FIELDS,
    spv_share: SPV_FIELDS,
    lead_spv: LEAD_SPV_FIELDS,
    royalty: ROYALTY_FIELDS,
    scpi: SCPI_FIELDS,
    real_estate_direct: IMMO_FIELDS,
    crypto: PLACEMENT_FIELDS,
    capitalization_account: PLACEMENT_FIELDS,
  }
