/**
 * Drops the frozen « versé » snapshot on CALTE's current account with Albo
 * Club, which claims 400 000 € where 1 880 000 € are actually pointed.
 *
 * `paidAmount` on an Airtable-imported deal is a snapshot: `airtableImport`
 * summed the outgoing movements Airtable knew that day and nothing has
 * refreshed it since, while the real figure is derived on every read from the
 * pointed transactions. No computation reads it — participations, KPIs, NAV
 * and deployed capital all go through `paidActual` — so it survives only as
 * an editable field on the deal sheet, quietly contradicting the line below
 * it. Refreshing it once would only re-stale it; the field goes away.
 *
 * WHY IT ONLY CLEARS WHEN THE POINTING IS AHEAD. Thirteen CALTE deals carry a
 * `paidAmount` that differs from what is pointed, and they are NOT one
 * problem. Seven of them have NO pointed transaction at all (an old deal
 * whose statements predate the imported ones): there, the snapshot is the
 * ONLY figure that exists and erasing it would destroy data rather than
 * clean it. The guard below — clear only when `paidActual` EXCEEDS
 * `paidAmount` — is what separates «the snapshot is behind the bank» from
 * «the bank is not in the app yet». It is the whole safety of this script,
 * not a detail: the same code without it is a data loss.
 *
 * Scope is deliberately this single line, targeted by company name rather
 * than by a typed id. The three other deals whose pointing is ahead are left
 * alone — they were not reviewed with the user.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/clearAlboCcaPaidAmount:inspect
 *   pnpm exec convex run --prod migrations/clearAlboCcaPaidAmount:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'
const TARGET_COMPANY = 'ALBO CLUB'

type Plan = {
  /** Already cleared: nothing to do. */
  done: boolean
  deal: Doc<'deals'>
  paidAmount: number | undefined
  paidActual: number
}

/** Sum of the outgoing transactions pointed on a deal, minus what came back. */
async function paidActualOf(ctx: Ctx, deal: Doc<'deals'>): Promise<number> {
  const transactions = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', deal._id))
    .collect()
  return transactions
    .filter((tx) => tx.direction === 'out')
    .reduce((sum, tx) => sum + tx.amount, 0)
}

/**
 * Read-only plan. Throws when the target is not what was reviewed — an
 * unknown company, no `cca` line, or more than one.
 */
async function buildPlan(ctx: Ctx): Promise<Plan> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${ORG_SLUG}`)

  const company = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', org._id))
    .filter((q) => q.eq(q.field('name'), TARGET_COMPANY))
    .first()
  if (!company) throw new ConvexError(`company_not_found:${TARGET_COMPANY}`)

  const deals = await ctx.db
    .query('deals')
    .withIndex('by_org', (q) => q.eq('orgId', org._id))
    .collect()
  const lines = deals.filter(
    (deal) =>
      deal.instrumentKind === 'cca' && deal.targetCompanyId === company._id,
  )
  if (lines.length !== 1) {
    throw new ConvexError(`unexpected_cca_count:${lines.length}`)
  }

  const deal = lines[0]
  const paidActual = await paidActualOf(ctx, deal)
  return {
    // Nothing to clear, or the pointing is NOT ahead — see the header.
    done: deal.paidAmount == null || paidActual <= deal.paidAmount,
    deal,
    paidAmount: deal.paidAmount,
    paidActual,
  }
}

export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const plan = await buildPlan(ctx)
    return {
      done: plan.done,
      dealId: plan.deal._id,
      paidAmountToClear: plan.done ? null : (plan.paidAmount ?? null),
      paidActual: plan.paidActual,
    }
  },
})

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const plan = await buildPlan(ctx)
    if (plan.done) return { cleared: null, paidActual: plan.paidActual }
    await ctx.db.patch('deals', plan.deal._id, { paidAmount: undefined })
    return { cleared: plan.paidAmount ?? null, paidActual: plan.paidActual }
  },
})
