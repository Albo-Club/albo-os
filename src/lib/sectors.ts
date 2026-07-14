// Single source of truth for the portfolio company sectors offered in the UI.
// `companies.sector` stays a free-form string (cf. convex/schema.ts): a
// predefined sector is stored as its slug, a free-typed value is stored
// verbatim. Display resolves the label via i18n with a fallback to the raw
// value (keys `participations:sectors.<slug>`), mirroring the instrument
// pattern. The list is a curated default — extend it as the portfolio grows.
export const SECTOR_SLUGS = [
  'saas',
  'fintech',
  'health',
  'climate',
  'agrifood',
  'mobility',
  'industry',
  'marketplace',
  'consumer',
  'media',
  'realestate',
  'services',
  'edtech',
  'fund',
  'crypto',
  'other',
] as const

export type SectorSlug = (typeof SECTOR_SLUGS)[number]
