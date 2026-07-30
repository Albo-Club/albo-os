/**
 * Single source of truth for portfolio company sectors (`companies.sector`).
 * Imported by the sector picker, the agent tools and the normalisation
 * migration — NEVER redeclare this list elsewhere (same rule as
 * `lib/instruments.ts`).
 *
 * The field itself stays a free-form string in the schema: a predefined sector
 * is stored as its slug, a free-typed one verbatim. Display resolves the label
 * via i18n with a fallback to the raw value (`participations:sectors.<slug>`).
 * A free-typed value is therefore possible but is a SIGNAL — it means the list
 * is missing a bucket, and the answer is to arbitrate and extend this list, not
 * to let the value live on.
 *
 * Assignment rules — a sector answers "which market does this company sell
 * to?", and nothing else. Keep them in mind before adding a slug or tagging a
 * company; they are what stopped the list from drifting back into a dumping
 * ground:
 *
 *  1. The MARKET, never the vehicle. SPV, fund, studio, carried structure:
 *     that is already carried by the deal's `instrumentKind` (`fund_lp`,
 *     `carry_vehicle`, `lead_spv`, `spv_share`). `fund` is the single bucket
 *     for holdings with no market of their own — never one slug per vehicle.
 *  2. The VERTICAL beats the model — when that vertical exists in this list.
 *     Software sold to a vertical takes the vertical (medical imaging → health,
 *     farm software → agrifood). `saas` only keeps horizontal B2B software.
 *     Same for `deeptech`: a scientific breakthrough serving one listed market
 *     takes that market; `deeptech` is for the ones no listed vertical covers.
 *  3. `marketplace` is the ONE deliberate exception to rule 2: a marketplace
 *     stays a marketplace even with a clear vertical. Split it B2B/B2C only if
 *     the count ever justifies two buckets.
 *  4. No transversal lens. Climate/impact was tried as a sector and removed:
 *     with an impact thesis, three quarters of the portfolio can claim it, so
 *     it discriminates nothing and attracts everything (it had swallowed a
 *     SaaS, a real-estate play and two funds). A lens belongs on its own field,
 *     never here.
 *
 * Labels have a hard width budget: the participations table sizes its sector
 * column on the widest predefined label (cf. `COL_WIDTHS.sector` in
 * `src/components/participations/ParticipationsTable.tsx`). Keep new labels
 * under ~22 characters or the badge spills into the next column.
 */
export const SECTOR_SLUGS = [
  'saas',
  'fintech',
  'health',
  'silver',
  'agrifood',
  'consumer',
  'marketplace',
  'industry',
  'deeptech',
  'realestate',
  'fund',
  'mobility',
  'edtech',
  'other',
] as const

export type SectorSlug = (typeof SECTOR_SLUGS)[number]

export function isSectorSlug(value: string): value is SectorSlug {
  return (SECTOR_SLUGS as ReadonlyArray<string>).includes(value)
}
