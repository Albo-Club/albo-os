import { literals } from 'convex-helpers/validators'

/**
 * Single source of truth for instrument kinds (deal.instrumentKind).
 * Imported by the schema, the deals mutations and the agent tools —
 * NEVER redeclare this list elsewhere.
 */
export const INSTRUMENTS = [
  'share',
  'bsa',
  'bsa_air',
  'safe',
  'oc', // convertible bond (obligation convertible)
  'os', // plain bond (obligation simple)
  'convertible_note',
  'cca', // shareholder current account (compte courant associé)
  'royalty',
  'fund_lp', // LP commitment in a fund
  'spv_share', // shares of an SPV
  'lead_spv', // management revenue as lead of an SPV (fees + carried)
  'carry_vehicle', // equity stake we HOLD in a carried-interest / management vehicle (e.g. OPRTRS & Co): the vehicle distributes carry — distinct from lead_spv (which models the fees + carried WE earn managing an SPV)
  'real_estate_direct',
  'scpi',
  'cto',
  'dat', // term deposit (dépôt à terme)
  'crypto',
  'loan', // loan (Airtable « Prêt »)
  'capitalization_account', // capitalization contract (Airtable « Compte de Capitalisation »)
  'unknown', // Attio deal with no/unmapped type_d_invest — sync fallback, shows a neutral placeholder until the real type is set
] as const

export type InstrumentKind = (typeof INSTRUMENTS)[number]

export const instrumentValidator = literals(...INSTRUMENTS)

/**
 * Instrument-archetype enums (dashboard refonte). Single source of truth for
 * the per-archetype `deals` columns: the schema and the deals mutations read
 * the validators, the edit UI reads the value arrays (same lists). NEVER
 * redeclare these elsewhere — see convex/lib/instrumentMapping.ts for the
 * instrumentKind → fields mapping.
 */

export const ROUND_TYPES = [
  'preseed',
  'seed',
  'serieA',
  'serieB',
  'serieC_plus',
  'bridge',
  'secondary',
] as const
export const roundTypeValidator = literals(...ROUND_TYPES)

// Validator keeps 'oc' valid (dormant): legacy deals may still carry
// safeType='oc'. Tightening this needs a prod check first that no deal holds
// that value — see KNOWN_ISSUES "Séparation BSA/OC".
export const SAFE_TYPES = ['safe', 'bsa_air', 'oc'] as const
export const safeTypeValidator = literals(...SAFE_TYPES)

// Values offered in the deal-sheet select: oc deals now have their own config,
// so the safe config only offers SAFE / BSA Air.
export const SAFE_TYPE_OPTIONS = ['safe', 'bsa_air'] as const

export const COUPON_PERIODICITIES = [
  'mensuel',
  'trimestriel',
  'semestriel',
  'annuel',
  'in_fine',
] as const
export const couponPeriodicityValidator = literals(...COUPON_PERIODICITIES)

export const REPAYMENT_MODALITIES = [
  'in_fine',
  'amortissable',
  'bullet',
] as const
export const repaymentModalityValidator = literals(...REPAYMENT_MODALITIES)

export const TERM_DURATIONS = ['1m', '3m', '6m', '12m', '24m'] as const
export const termDurationValidator = literals(...TERM_DURATIONS)

export const FUND_TYPES = ['vc', 'pe', 'dette', 'secondaire', 'fof'] as const
export const fundTypeValidator = literals(...FUND_TYPES)

export const PROPERTY_TYPES = [
  'residentiel',
  'commercial',
  'bureau',
  'autre',
] as const
export const propertyTypeValidator = literals(...PROPERTY_TYPES)

/** Field name → value array, for the enum-rendered editable fields. */
export const ENUM_FIELD_VALUES: Record<string, ReadonlyArray<string>> = {
  roundType: ROUND_TYPES,
  safeType: SAFE_TYPE_OPTIONS,
  couponPeriodicity: COUPON_PERIODICITIES,
  repaymentModality: REPAYMENT_MODALITIES,
  termDuration: TERM_DURATIONS,
  fundType: FUND_TYPES,
  propertyType: PROPERTY_TYPES,
}
