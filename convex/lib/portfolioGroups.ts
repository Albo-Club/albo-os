/**
 * Pure portfolio-group logic: KPI block catalogue, consolidated aggregation,
 * block-config resolution and slug generation.
 *
 * Deliberately free of any Convex ctx dependency: tested via node:test
 * (tests/portfolioGroups.test.ts), same pattern as lib/liabilities.ts.
 */

export type BlockConfig = { key: string; visible: boolean }

/**
 * Ordered catalogue of the KPI blocks that are computable TODAY from the
 * portfolio data. Extending it later (TRI, duration…) is a one-line addition
 * here — `resolveBlocks` appends any new catalogue key to stored configs with
 * no migration.
 */
export const KPI_BLOCKS = ['expo_totale', 'verse', 'recu', 'tvpi'] as const

/** Default config: every catalogue block visible, catalogue order. */
export const DEFAULT_BLOCKS: Array<BlockConfig> = KPI_BLOCKS.map((key) => ({
  key,
  visible: true,
}))

export type EntityTotals = {
  committed: number
  paid: number
  received: number
  residual: number
}

export type GroupAggregate = EntityTotals & { tvpi: number | null }

/**
 * Consolidated totals of a group's entities (cents). TVPI =
 * (received + residual) / paid — same formula as the client reducer
 * (ParticipationsTable groups), single source of truth.
 */
export function aggregateEntities(
  rows: ReadonlyArray<EntityTotals>,
): GroupAggregate {
  const totals = rows.reduce(
    (acc, r) => ({
      committed: acc.committed + r.committed,
      paid: acc.paid + r.paid,
      received: acc.received + r.received,
      residual: acc.residual + r.residual,
    }),
    { committed: 0, paid: 0, received: 0, residual: 0 },
  )
  return {
    ...totals,
    tvpi: totals.paid > 0 ? (totals.received + totals.residual) / totals.paid : null,
  }
}

/**
 * Merges a stored block config with the catalogue: keeps the stored order,
 * drops keys no longer in the catalogue, and appends any missing catalogue
 * block (visible) at the end. Empty/undefined stored config → defaults.
 */
export function resolveBlocks(
  stored: ReadonlyArray<BlockConfig> | undefined,
): Array<BlockConfig> {
  if (!stored || stored.length === 0) return DEFAULT_BLOCKS.map((b) => ({ ...b }))
  const known = new Set<string>(KPI_BLOCKS)
  const kept = stored.filter((b) => known.has(b.key))
  const present = new Set(kept.map((b) => b.key))
  const appended = KPI_BLOCKS.filter((k) => !present.has(k)).map((key) => ({
    key,
    visible: true,
  }))
  return [...kept.map((b) => ({ ...b })), ...appended]
}

/** Keeps only catalogue keys from a config (used to validate mutation input). */
export function sanitizeBlocks(
  blocks: ReadonlyArray<BlockConfig>,
): Array<BlockConfig> {
  const known = new Set<string>(KPI_BLOCKS)
  return blocks.filter((b) => known.has(b.key)).map((b) => ({ ...b }))
}

/**
 * URL-safe slug from a group name: lowercased, accents stripped, non
 * alphanumerics collapsed to single dashes, trimmed. Falls back to 'groupe'
 * when nothing usable remains.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'groupe'
}

/**
 * Slug not colliding with `existing`: appends -2, -3… until free. Stable for a
 * given (base, existing) — the first free suffix wins.
 */
export function uniqueSlug(base: string, existing: ReadonlyArray<string>): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
