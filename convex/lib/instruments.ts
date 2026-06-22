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
  'secondary',
  'real_estate_direct',
  'scpi',
  'cto',
  'dat', // term deposit (dépôt à terme)
  'crypto',
  'loan', // loan (Airtable « Prêt »)
  'capitalization_account', // capitalization contract (Airtable « Compte de Capitalisation »)
  'unknown', // instrument not yet known (e.g. Attio deal without `type_d_invest`)
] as const

export type InstrumentKind = (typeof INSTRUMENTS)[number]

export const instrumentValidator = literals(...INSTRUMENTS)
