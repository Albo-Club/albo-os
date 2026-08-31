/**
 * Backfill `guarantees.orgId` — the org whose Passif a security is filed in.
 *
 * The field is new. Until it existed, a guarantee was reachable only through
 * its parties (borrower, guarantor, pledged asset), which is why a security
 * with no group party at all — a third party's surety on the same outside
 * debt as ours, SPEC § 10 line 10b — could not be recorded. `orgId` gives
 * every row an anchor of its own.
 *
 * The value is not invented: it is read off the parties already stored, in
 * the order they answer « whose page does this belong on ».
 *
 *   1. `pledgorOrgId` — we stand the security, so it is our commitment;
 *   2. `borrowerOrgId` — otherwise it covers our debt;
 *   3. `subjectOrgId`  — otherwise it bites on our asset.
 *
 * Every row written before this migration has at least one of the three:
 * `create` refused the rest (`not_a_party`). A row with none would be data
 * that predates the check, and is reported rather than guessed at.
 *
 * This is step 1 of a purge-then-narrow (CLAUDE.md § Workflow déploiement):
 * the field ships OPTIONAL, this migration fills it, and a second PR makes it
 * required once `verify` reports nothing left. The other order fails the
 * deploy — Convex refuses a schema stricter than the data.
 *
 * Idempotent: a row that already carries an `orgId` is skipped, so a second
 * run rewrites nothing.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/backfillGuaranteeOrg:dryRun
 *   # STOP: check `unresolvable` is 0, then
 *   pnpm exec convex run --prod migrations/backfillGuaranteeOrg:apply
 *   # then `verify` must report `clean: true` before the narrowing PR ships.
 */
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Which party the filing org is read from, or null when there is none. */
function resolveOrg(
  guarantee: Doc<'guarantees'>,
): { orgId: Id<'organizations'>; from: string } | null {
  if (guarantee.pledgorOrgId) {
    return { orgId: guarantee.pledgorOrgId, from: 'pledgorOrgId' }
  }
  if (guarantee.borrowerOrgId) {
    return { orgId: guarantee.borrowerOrgId, from: 'borrowerOrgId' }
  }
  if (guarantee.subjectOrgId) {
    return { orgId: guarantee.subjectOrgId, from: 'subjectOrgId' }
  }
  return null
}

async function scan(ctx: Ctx) {
  const rows = (await ctx.db.query('guarantees').collect()).filter(
    (row) => row.orgId == null,
  )
  const resolvable: Array<{
    row: Doc<'guarantees'>
    orgId: Id<'organizations'>
    from: string
  }> = []
  const unresolvable: Array<Doc<'guarantees'>> = []
  const byField: Record<string, number> = {}
  for (const row of rows) {
    const resolved = resolveOrg(row)
    if (!resolved) {
      unresolvable.push(row)
      continue
    }
    resolvable.push({ row, ...resolved })
    byField[resolved.from] = (byField[resolved.from] ?? 0) + 1
  }
  return { rows, resolvable, unresolvable, byField }
}

/** Read-only: how many rows would be filled, and from which party. */
export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { rows, resolvable, unresolvable, byField } = await scan(ctx)
    return {
      missing: rows.length,
      toFill: resolvable.length,
      byField,
      // A row with no party at all cannot be filed anywhere: it has to be
      // looked at by hand rather than assigned to an arbitrary org.
      unresolvable: unresolvable.length,
      unresolvableSample: unresolvable.slice(0, 20).map((row) => ({
        _id: row._id,
        form: row.form,
        borrowerLabel: row.borrowerLabel ?? null,
        pledgorLabel: row.pledgorLabel ?? null,
        subjectLabel: row.subjectLabel ?? null,
      })),
    }
  },
})

/** Fill `orgId` from the parties already stored. Idempotent. */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { resolvable, unresolvable, byField } = await scan(ctx)
    for (const { row, orgId } of resolvable) {
      await ctx.db.patch('guarantees', row._id, { orgId })
    }
    return {
      filled: resolvable.length,
      byField,
      skipped: unresolvable.length,
    }
  },
})

/**
 * Read-only gate for the narrowing PR: must report `clean: true` before
 * `orgId` stops being optional in the schema.
 */
export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { rows, unresolvable } = await scan(ctx)
    return {
      remaining: rows.length,
      unresolvable: unresolvable.length,
      clean: rows.length === 0,
    }
  },
})
