import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel>

/**
 * Read helpers for internal transfers (`transfers` + the two transaction legs
 * carrying `allocation.kind === 'transfer'`). Shared by the queries
 * (convex/transactions.ts ledger, convex/transfers.ts) and the write core
 * (convex/lib/pointage.ts) so completeness is computed the same way
 * everywhere.
 *
 * Nothing about a transfer is stored beyond its identity: amount, dates,
 * amount gap and in-transit delay all derive from the legs
 * (cf. KNOWN_ISSUES.md « Virements internes »).
 */

/**
 * The transactions currently allocated to a transfer. Zero, one (incomplete)
 * or two — never more: `applyPairTransfer` refuses a third leg.
 */
export async function transferLegs(
  ctx: Ctx,
  transfer: Pick<Doc<'transfers'>, '_id' | 'orgId'>,
): Promise<Array<Doc<'transactions'>>> {
  return await ctx.db
    .query('transactions')
    .withIndex('by_org_allocation_target', (q) =>
      q.eq('orgId', transfer.orgId).eq('allocation.targetId', transfer._id),
    )
    .collect()
}

/**
 * Number of allocated legs per transfer, for a whole org, in ONE read — the
 * per-row alternative would be a query per transfer. Keyed by transfer id
 * (as stored in `allocation.targetId`, hence a plain string).
 */
export async function transferLegCounts(
  ctx: Ctx,
  orgId: Id<'organizations'>,
): Promise<Map<string, number>> {
  const legs = await ctx.db
    .query('transactions')
    .withIndex('by_org_allocation_kind', (q) =>
      q.eq('orgId', orgId).eq('allocation.kind', 'transfer'),
    )
    .collect()
  const counts = new Map<string, number>()
  for (const leg of legs) {
    const target = leg.allocation?.targetId
    if (!target) continue
    counts.set(target, (counts.get(target) ?? 0) + 1)
  }
  return counts
}

/**
 * Is this transaction an internal transfer still missing its counter-leg?
 *
 * Covers the two ways that happens: a transfer opened on one leg and never
 * paired, and — for free — every row tagged `internal_transfer` BEFORE
 * transfers became an object, which carries no allocation at all. Those
 * legacy rows are deliberately not backfilled: surfacing them as "to pair"
 * is a truthful worklist, where guessing their counter-leg would not be.
 */
export function isIncompleteTransferLeg(
  tx: Pick<Doc<'transactions'>, 'matchStatus' | 'allocation'>,
  legCounts: Map<string, number>,
): boolean {
  if (tx.matchStatus !== 'internal_transfer') return false
  if (tx.allocation?.kind !== 'transfer') return true
  return (legCounts.get(tx.allocation.targetId) ?? 0) < 2
}
