/**
 * Pitch fields (`oneLiner` + `summary`) shared across same-domain entities.
 *
 * Product rule (14/07/2026): entities that share a `domain` must show the
 * SAME one-liner and summary — editing one propagates to the whole group, and
 * the auto-enrichment reuses a sibling's text instead of paraphrasing. This
 * module holds the two primitives: pick the canonical pitch of a group, and
 * write a pitch across a domain group (fill empties, or overwrite all).
 */
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericMutationCtx<DataModel>

type Pitch = { oneLiner?: string; summary?: string }

/**
 * The canonical pitch of a group = the pair (oneLiner, summary) of the entity
 * with the LONGEST summary (proxy for most complete). Returns null when no
 * entity in the group has a summary.
 */
export function pickCanonicalPitch(entities: Array<Pitch>): Pitch | null {
  let best: Pitch | null = null
  let bestLen = 0
  for (const e of entities) {
    const s = e.summary?.trim()
    if (!s) continue
    if (best === null || s.length > bestLen) {
      best = { oneLiner: e.oneLiner, summary: e.summary }
      bestLen = s.length
    }
  }
  return best
}

/**
 * Write `fields` to every non-archived company of `orgId` sharing `domain`.
 * - `overwrite`: set the provided fields on all siblings (edit propagation,
 *   unify) — a provided `undefined` clears the field.
 * - `fill`: set a field only where it is currently `undefined` (enrichment).
 * Only the keys present in `fields` are touched. Returns the number of rows
 * patched.
 */
export async function applyPitchToDomainGroup(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  domain: string,
  fields: Pitch,
  mode: 'overwrite' | 'fill',
): Promise<number> {
  const companies = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  let patched = 0
  for (const c of companies) {
    if (c.archivedAt != null) continue
    if (c.domain !== domain) continue
    const patch: Pitch = {}
    if ('oneLiner' in fields && (mode === 'overwrite' || c.oneLiner === undefined))
      patch.oneLiner = fields.oneLiner
    if ('summary' in fields && (mode === 'overwrite' || c.summary === undefined))
      patch.summary = fields.summary
    if (Object.keys(patch).length === 0) continue
    await ctx.db.patch('companies', c._id, patch)
    patched++
  }
  return patched
}
