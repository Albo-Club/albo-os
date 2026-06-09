import { literals } from 'convex-helpers/validators'

/**
 * Source unique des types d'instruments (deal.instrumentKind).
 * Importée par le schéma, les mutations deals et les outils agent —
 * ne JAMAIS redéclarer cette liste ailleurs.
 */
export const INSTRUMENTS = [
  'share',
  'bsa',
  'bsa_air',
  'safe',
  'oc', // obligation convertible
  'os', // obligation simple
  'convertible_note',
  'cca', // compte courant associé
  'royalty',
  'fund_lp', // commitment LP dans un fond
  'spv_share', // titres d'un SPV
  'secondary',
  'real_estate_direct',
  'scpi',
  'cto',
  'dat', // dépôt à terme
  'crypto',
  'loan', // prêt (Airtable « Prêt »)
  'capitalization_account', // contrat de capitalisation (Airtable « Compte de Capitalisation »)
] as const

export type InstrumentKind = (typeof INSTRUMENTS)[number]

export const instrumentValidator = literals(...INSTRUMENTS)
