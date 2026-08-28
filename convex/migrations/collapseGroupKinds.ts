/**
 * Collapse the unused `companies.kind` sub-types into a single
 * `group_entity` (ALB-128 follow-up).
 *
 * `group_operating` / `group_sci` / `group_spv` / `group_manco` described the
 * nature of a group company — and nothing ever read them. Every test in the
 * codebase is either `kind.startsWith('group_')` (a deal's investor, a bank
 * account's owner, the two lists in the UI) or `kind === 'group_root'` /
 * `'portfolio'`. The four values only ever existed because the initial seed
 * wrote them; the create-company screen forces `portfolio`, so they cannot
 * even be produced from the app.
 *
 * This is step 1 of a purge-then-narrow (CLAUDE.md § Workflow déploiement):
 * the union now ALSO accepts `group_entity`, this migration rewrites the rows,
 * and a second PR drops the four deprecated values once no row carries them.
 * Doing it the other way round would fail the deploy — Convex refuses a schema
 * stricter than the data.
 *
 * `group_root` and `portfolio` are untouched: both are read on their own.
 *
 * Idempotent: a row already on `group_entity` (or on a kept value) is skipped,
 * so a second run rewrites nothing.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/collapseGroupKinds:dryRun
 *   # STOP: check the per-kind counts, then
 *   pnpm exec convex run --prod migrations/collapseGroupKinds:apply
 *   # then `verify` must report 0 remaining before the narrowing PR ships.
 */
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** The sub-types being retired, in favour of `group_entity`. */
const DEPRECATED_KINDS = [
  'group_operating',
  'group_sci',
  'group_spv',
  'group_manco',
] as const

type DeprecatedKind = (typeof DEPRECATED_KINDS)[number]

function isDeprecated(kind: Doc<'companies'>['kind']): kind is DeprecatedKind {
  return (DEPRECATED_KINDS as ReadonlyArray<string>).includes(kind)
}

/** Rows still carrying a deprecated kind, counted per value and per org. */
async function scan(ctx: Ctx) {
  const rows = (await ctx.db.query('companies').collect()).filter((c) =>
    isDeprecated(c.kind),
  )
  const byKind: Record<string, number> = {}
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1
  return { rows, byKind }
}

/** Read-only: how many rows would be rewritten, and from which value. */
export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { rows, byKind } = await scan(ctx)
    return {
      toRewrite: rows.length,
      byKind,
      // Named sample, enough to recognise the entities at a glance.
      sample: rows.slice(0, 20).map((c) => ({ name: c.name, kind: c.kind })),
    }
  },
})

/** Rewrite every deprecated kind to `group_entity`. Idempotent. */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { rows, byKind } = await scan(ctx)
    for (const row of rows) {
      await ctx.db.patch('companies', row._id, { kind: 'group_entity' })
    }
    return { rewritten: rows.length, byKind }
  },
})

/**
 * Read-only gate for the narrowing PR: must report `remaining: 0` before the
 * four deprecated values leave the schema union.
 */
export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { rows, byKind } = await scan(ctx)
    return { remaining: rows.length, byKind, clean: rows.length === 0 }
  },
})
