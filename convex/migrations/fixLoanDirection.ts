/**
 * One-off correction: an inter-company current account recorded in the wrong
 * direction (creditor and debtor swapped).
 *
 * `intercompanyLoans` carries the direction in `fromOrgId` (creditor) /
 * `toOrgId` (debtor); the balances are never stored, each org derives its own
 * from the transactions it has allocated (Σ out − Σ in, cf. lib/liabilities).
 * So a row entered backwards produces two balances whose signs BOTH
 * contradict the recorded side: the "creditor" comes out negative (it cashed
 * in) and the "debtor" positive (it paid out). That is the tell `inspect`
 * reports as `looksReversed` — the money movements, not the label, say who
 * lent.
 *
 * Found on the CALTE ↔ Albo current account: recorded Albo → CALTE, while
 * CALTE's transactions are outflows and Albo's are inflows. CALTE is the
 * lender.
 *
 * `apply` swaps the two fields on ONE loan. A swap is not idempotent — running
 * it twice would put the error back — so it takes the direction it expects to
 * find and refuses anything else (`direction_mismatch`). A second run
 * therefore fails loudly instead of silently undoing the fix. The allocated
 * transactions are untouched: they point at the loan, and each side's balance
 * is re-derived from the swapped roles.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/fixLoanDirection:inspect
 *   # STOP: read `looksReversed` and the two balances, then
 *   pnpm exec convex run --prod migrations/fixLoanDirection:apply \
 *     '{"loanId":"…","currentFromSlug":"albo","currentToSlug":"calte"}'
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { computeLoanBalanceCents } from '../lib/liabilities'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Balance and matched-movement count of one org's side of a loan. */
async function sideOf(ctx: Ctx, orgId: Id<'organizations'>, loanId: string) {
  const txs = (
    await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', loanId),
      )
      .collect()
  ).filter((tx) => tx.allocation?.kind === 'intercompany_loan')
  return {
    balanceCents: computeLoanBalanceCents(txs),
    allocatedTransactions: txs.length,
  }
}

async function orgRef(ctx: Ctx, orgId: Id<'organizations'>) {
  const org = await ctx.db.get('organizations', orgId)
  return { slug: org?.slug ?? null, name: org?.name ?? null }
}

/**
 * Read-only: every inter-company loan with its recorded direction, both
 * derived balances, and whether the movements contradict the label.
 */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db.query('intercompanyLoans').collect()
    return await Promise.all(
      loans.map(async (loan) => {
        const creditor = await sideOf(ctx, loan.fromOrgId, loan._id)
        const debtor = await sideOf(ctx, loan.toOrgId, loan._id)
        return {
          loanId: loan._id,
          from: await orgRef(ctx, loan.fromOrgId), // recorded creditor
          to: await orgRef(ctx, loan.toOrgId), // recorded debtor
          creditorSide: creditor,
          debtorSide: debtor,
          // Both signs contradict the recorded roles: the "creditor" cashed
          // in, the "debtor" paid out. Only meaningful once both sides have
          // allocated at least one movement.
          looksReversed:
            creditor.allocatedTransactions > 0 &&
            debtor.allocatedTransactions > 0 &&
            creditor.balanceCents < 0 &&
            debtor.balanceCents > 0,
        }
      }),
    )
  },
})

/** Swap creditor and debtor on one loan. Refuses any other direction. */
export const apply = internalMutation({
  args: {
    loanId: v.id('intercompanyLoans'),
    currentFromSlug: v.string(),
    currentToSlug: v.string(),
  },
  handler: async (ctx, { loanId, currentFromSlug, currentToSlug }) => {
    const loan = await ctx.db.get('intercompanyLoans', loanId)
    if (!loan) throw new ConvexError('loan_not_found')

    const [from, to] = await Promise.all([
      orgRef(ctx, loan.fromOrgId),
      orgRef(ctx, loan.toOrgId),
    ])
    // Guard against a second run putting the error back.
    if (from.slug !== currentFromSlug || to.slug !== currentToSlug) {
      throw new ConvexError(`direction_mismatch:${from.slug}->${to.slug}`)
    }

    await ctx.db.patch('intercompanyLoans', loanId, {
      fromOrgId: loan.toOrgId,
      toOrgId: loan.fromOrgId,
    })

    return {
      swapped: true as const,
      creditor: to.slug, // the new creditor is the former debtor
      debtor: from.slug,
    }
  },
})
