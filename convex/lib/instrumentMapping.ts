import type { InstrumentKind } from './instruments'

/**
 * Instrument archetypes — single source of truth for the deal/instrument
 * dashboard refonte. The front (deal fiche, forms) and reporting read these
 * constants. NEVER duplicate this mapping elsewhere.
 *
 * Each `instrumentKind` (the 19 values in ./instruments) belongs to exactly
 * one archetype and has exactly one render mode:
 *   - 'fields'      → INSTRUMENT_FIELDS lists the ordered `deals` columns to show
 *   - 'custom'      → a bespoke panel renders the central block (royalty)
 *   - 'placeholder' → layout not designed yet; show a neutral "type non encore
 *                     configuré" block (cto / crypto / capitalization_account).
 *
 * 'unassigned' is the holding bucket for the placeholder kinds, so
 * INSTRUMENT_ARCHETYPE stays a total Record over the 19 real values. Their
 * dashboard design is deferred (decision before Lot 2).
 */
export type Archetype =
  | 'equity'
  | 'debt'
  | 'funds_lp'
  | 'real_estate'
  | 'royalties'
  | 'unassigned'

export type RenderMode = 'fields' | 'custom' | 'placeholder'

/** instrumentKind → archetype. Total Record (all 19 kinds). */
export const INSTRUMENT_ARCHETYPE: Record<InstrumentKind, Archetype> = {
  // equity (safe config absorbs safe / bsa_air / oc; bsa & convertible_note
  // reuse the safe field list — see KNOWN_ISSUES "Archétypes d'instruments").
  share: 'equity',
  bsa: 'equity',
  bsa_air: 'equity',
  safe: 'equity',
  oc: 'equity',
  convertible_note: 'equity',
  // debt (loan reuses the os field config)
  os: 'debt',
  loan: 'debt',
  cca: 'debt',
  dat: 'debt',
  // funds_lp (secondary reuses the fonds field config)
  fund_lp: 'funds_lp',
  spv_share: 'funds_lp',
  secondary: 'funds_lp',
  // real_estate
  real_estate_direct: 'real_estate',
  scpi: 'real_estate',
  // royalties (custom panel, reserved)
  royalty: 'royalties',
  // parked — layout deferred, render placeholder
  cto: 'unassigned',
  crypto: 'unassigned',
  capitalization_account: 'unassigned',
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
  secondary: 'fields',
  real_estate_direct: 'fields',
  scpi: 'fields',
  royalty: 'custom',
  cto: 'placeholder',
  crypto: 'placeholder',
  capitalization_account: 'placeholder',
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

const SPV_FIELDS = [
  'closingDate',
  'paidAmount',
  'underlyingTarget',
  'spvOwnershipPct',
  'structuringFees',
]

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

/**
 * instrumentKind → ordered `deals` columns for the 'fields'-rendered kinds.
 * Partial: 'custom' (royalty) and 'placeholder' (cto/crypto/
 * capitalization_account) kinds are intentionally absent.
 */
export const INSTRUMENT_FIELDS: Partial<Record<InstrumentKind, Array<string>>> =
  {
    share: EQUITY_FIELDS,
    safe: SAFE_FIELDS,
    bsa: SAFE_FIELDS,
    bsa_air: SAFE_FIELDS,
    oc: SAFE_FIELDS,
    convertible_note: SAFE_FIELDS,
    os: OS_FIELDS,
    loan: OS_FIELDS,
    cca: CCA_FIELDS,
    dat: DAT_FIELDS,
    fund_lp: FONDS_FIELDS,
    secondary: FONDS_FIELDS,
    spv_share: SPV_FIELDS,
    scpi: SCPI_FIELDS,
    real_estate_direct: IMMO_FIELDS,
  }
