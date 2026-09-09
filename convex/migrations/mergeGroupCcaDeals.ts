/**
 * One current account per subsidiary — merges the duplicate `cca` deals
 * CALTE carries on three of its group entities.
 *
 * CALTE funds its subsidiaries through their shareholder current account, and
 * nothing else: their capital is 1 000 €, subscribed at incorporation and
 * never increased (cf. `migrations/seedGroupCapTables`). Five of those
 * advances had been recorded as `real_estate_direct` — CALTE holding real
 * estate directly, which it does not: the bank labels read « RDB Compte
 * courant » and « Virement vers Compte Courant ». Requalifying them to `cca`
 * left Caltimo, SCI Chapelle and SCI Upload with TWO `cca` lines each,
 * splitting one relation in two.
 *
 * This merges each pair back into one line: the absorbed deal's transactions
 * are re-pointed onto the survivor, then the emptied deal is deleted.
 *
 * The survivor is the line carrying the MOST transactions (earliest
 * `signedDate` breaks a tie) — never an id typed by hand, so the script picks
 * the same row whatever happened to the database since it was written. It
 * then takes:
 *   - the EARLIER `signedDate` of the two, so the line covers the whole
 *     history of the advance;
 *   - NO `paidAmount` at all. That field is a snapshot frozen by the Airtable
 *     import (the sum of the movements Airtable knew that day) that nothing
 *     has refreshed since, while the real figure is derived on every read
 *     from the pointed transactions. A stale number is worse than none.
 *
 * `matchingDecisions` is deliberately NOT touched: the table is append-only
 * by contract, a frozen snapshot of what the decision-maker saw at the time.
 * Rewriting it to follow a merge would falsify history; the current state has
 * always lived on `transactions`.
 *
 * Every OTHER reference to the absorbed deal (valuation, projection,
 * document, guarantee, forecast) BLOCKS its pair — the script refuses rather
 * than leave a row pointing at nothing. Same rule as `deals:remove`.
 *
 * Idempotent: a target already down to one `cca` line is reported `done` and
 * skipped, so `inspect` stays readable after `apply`.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/mergeGroupCcaDeals:inspect
 *   # STOP: read the report — `blocked` must be empty
 *   pnpm exec convex run --prod migrations/mergeGroupCcaDeals:apply
 *   pnpm exec convex run --prod migrations/mergeGroupCcaDeals:inspect  # all done
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** The three group entities CALTE ended up funding through two `cca` lines. */
const TARGET_COMPANIES = ['Caltimo', 'SCI Chapelle', 'SCI Upload'] as const

/** What still points at the absorbed deal and would be orphaned by its deletion. */
type Blockers = {
  valuations: number
  dealProjections: number
  documents: number
  guarantees: number
  forecasts: number
  forecastRules: number
  forecastEntries: number
}

type PlannedMerge = {
  label: string
  /** Already down to one line: nothing to do. */
  done: boolean
  survivor: Doc<'deals'> | null
  absorbed: Doc<'deals'> | null
  transactionIds: Array<Id<'transactions'>>
  blockers: Blockers
  /** Append-only history, reported for transparency and left alone. */
  matchingDecisions: number
  newSignedDate: number | undefined
  paidAmountToClear: number | null
}

const NO_BLOCKERS: Blockers = {
  valuations: 0,
  dealProjections: 0,
  documents: 0,
  guarantees: 0,
  forecasts: 0,
  forecastRules: 0,
  forecastEntries: 0,
}

/** Counts every live reference to a deal — all but the two we handle ourselves. */
async function blockersOf(
  ctx: Ctx,
  dealId: Id<'deals'>,
  orgId: Id<'organizations'>,
): Promise<Blockers> {
  // `forecastRules` has no by-deal index (org-scoped table, a handful of rows).
  const rules = await ctx.db
    .query('forecastRules')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  return {
    valuations: (
      await ctx.db
        .query('valuations')
        .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
        .collect()
    ).length,
    dealProjections: (
      await ctx.db
        .query('dealProjections')
        .withIndex('by_deal_version', (q) => q.eq('dealId', dealId))
        .collect()
    ).length,
    documents: (
      await ctx.db
        .query('documents')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect()
    ).length,
    guarantees: (
      await ctx.db
        .query('guarantees')
        .withIndex('by_subject_deal', (q) => q.eq('subjectDealId', dealId))
        .collect()
    ).length,
    forecasts: (
      await ctx.db
        .query('forecasts')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect()
    ).length,
    forecastRules: rules.filter((rule) => rule.dealId === dealId).length,
    forecastEntries: (
      await ctx.db
        .query('forecastEntries')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect()
    ).length,
  }
}

/** The transactions currently pointed on a deal. */
async function transactionsOf(ctx: Ctx, dealId: Id<'deals'>) {
  return await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .collect()
}

/**
 * Read-only plan, shared by `inspect` and `apply`. Throws when a target does
 * not look like what was reviewed — an unknown company, or three `cca` lines
 * where two were expected. A merge of the wrong rows cannot be undone.
 */
async function buildPlan(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${ORG_SLUG}`)

  const deals = await ctx.db
    .query('deals')
    .withIndex('by_org', (q) => q.eq('orgId', org._id))
    .collect()

  const planned: Array<PlannedMerge> = []
  for (const name of TARGET_COMPANIES) {
    const company = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .filter((q) => q.eq(q.field('name'), name))
      .first()
    if (!company) throw new ConvexError(`company_not_found:${name}`)

    const lines = deals.filter(
      (deal) =>
        deal.instrumentKind === 'cca' && deal.targetCompanyId === company._id,
    )
    if (lines.length === 1) {
      planned.push({
        label: name,
        done: true,
        survivor: lines[0],
        absorbed: null,
        transactionIds: [],
        blockers: NO_BLOCKERS,
        matchingDecisions: 0,
        newSignedDate: undefined,
        paidAmountToClear: null,
      })
      continue
    }
    if (lines.length !== 2) {
      throw new ConvexError(`unexpected_cca_count:${name}:${lines.length}`)
    }

    // Survivor = the line carrying the most transactions; the earlier
    // `signedDate` breaks a tie. Deterministic, so inspect and apply agree.
    const withCounts = await Promise.all(
      lines.map(async (deal) => ({
        deal,
        transactions: await transactionsOf(ctx, deal._id),
      })),
    )
    withCounts.sort(
      (a, b) =>
        b.transactions.length - a.transactions.length ||
        (a.deal.signedDate ?? Infinity) - (b.deal.signedDate ?? Infinity),
    )
    const survivor = withCounts[0].deal
    const absorbed = withCounts[1].deal

    // The survivor must cover the whole history of the advance, so it takes
    // the absorbed line's date when that one is older.
    const absorbedIsEarlier =
      absorbed.signedDate != null &&
      (survivor.signedDate == null || absorbed.signedDate < survivor.signedDate)

    const decisions = await ctx.db
      .query('matchingDecisions')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()

    planned.push({
      label: name,
      done: false,
      survivor,
      absorbed,
      transactionIds: withCounts[1].transactions.map((tx) => tx._id),
      blockers: await blockersOf(ctx, absorbed._id, org._id),
      matchingDecisions: decisions.filter((d) => d.dealId === absorbed._id)
        .length,
      newSignedDate: absorbedIsEarlier ? absorbed.signedDate : undefined,
      paidAmountToClear: survivor.paidAmount ?? null,
    })
  }
  return planned
}

/** True when nothing but transactions points at the absorbed deal. */
function isClear(blockers: Blockers) {
  return Object.values(blockers).every((count) => count === 0)
}

/**
 * Read-only report: what `apply` would move, clear and delete. Run it first —
 * `blocked` must be empty. After `apply`, every target reads `done`.
 */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const planned = await buildPlan(ctx)
    return {
      merges: planned.map((p) => ({
        label: p.label,
        done: p.done,
        survivorId: p.survivor?._id ?? null,
        absorbedId: p.absorbed?._id ?? null,
        transactionsToMove: p.transactionIds.length,
        // Non-empty = STOP: deleting the absorbed deal would orphan these.
        blockers: Object.fromEntries(
          Object.entries(p.blockers).filter(([, count]) => count > 0),
        ),
        // Left untouched on purpose (append-only history).
        matchingDecisionsKept: p.matchingDecisions,
        signedDateChangesTo: p.newSignedDate ?? null,
        paidAmountToClear: p.paidAmountToClear,
      })),
      blocked: planned
        .filter((p) => !p.done && !isClear(p.blockers))
        .map((p) => p.label),
    }
  },
})

/**
 * Moves the transactions, clears the stale `paidAmount`, backdates the
 * survivor when needed, then deletes the emptied deal. Refuses a pair when
 * anything else still points at the absorbed line.
 */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const planned = await buildPlan(ctx)

    const merged: Array<{
      label: string
      transactionsMoved: number
      paidAmountCleared: number | null
      signedDateSetTo: number | null
    }> = []
    const refused: Array<string> = []

    for (const plan of planned) {
      if (plan.done || !plan.survivor || !plan.absorbed) continue
      if (!isClear(plan.blockers)) {
        refused.push(`${plan.label}: ${JSON.stringify(plan.blockers)}`)
        continue
      }

      for (const transactionId of plan.transactionIds) {
        await ctx.db.patch('transactions', transactionId, {
          dealId: plan.survivor._id,
        })
      }

      // `undefined` removes the field (Convex patch): the survivor keeps only
      // the derived figure.
      await ctx.db.patch('deals', plan.survivor._id, {
        paidAmount: undefined,
        ...(plan.newSignedDate != null
          ? { signedDate: plan.newSignedDate }
          : {}),
      })

      await ctx.db.delete('deals', plan.absorbed._id)

      merged.push({
        label: plan.label,
        transactionsMoved: plan.transactionIds.length,
        paidAmountCleared: plan.paidAmountToClear,
        signedDateSetTo: plan.newSignedDate ?? null,
      })
    }

    return { merged, refused }
  },
})
