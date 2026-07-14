import { deriveCategoryPattern, findMatchingRule } from './categories'

import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Learned auto-categorization rules — DB glue (the pure pattern logic lives
 * in lib/categories.ts). A rule memorizes one manual gesture (status +
 * category + VAT rate) keyed by the stable pattern of the transaction label,
 * and is replayed on newly ingested transactions and on demand.
 *
 * Rule applications NEVER write to `matchingDecisions` (machine decision —
 * same principle as the backfills, cf. KNOWN_ISSUES.md « Pointage ») and
 * never touch `reconciled` / `dealId` / `allocation` (they only target
 * `unmatched` rows, where those are already unset).
 */

export type CategoryRuleStatus =
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

/** An org's rules, loaded once per mutation (the table stays small). */
export async function loadOrgRules(
  ctx: MutCtx,
  orgId: Id<'organizations'>,
): Promise<Array<Doc<'categoryRules'>>> {
  return await ctx.db
    .query('categoryRules')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
}

/**
 * Memorizes a categorization gesture as a rule (upsert by org + pattern —
 * the latest gesture wins). Returns null when no stable pattern can be
 * derived from the label (all-numeric). `category`/`vatRateBps` are only
 * kept on the charge/product statuses (schema invariant).
 */
export async function upsertRuleFromGesture(
  ctx: MutCtx,
  args: {
    orgId: Id<'organizations'>
    tx: Doc<'transactions'>
    status: CategoryRuleStatus
    category?: string
    vatRateBps?: 0 | 550 | 1000 | 2000
    createdBy: Id<'users'>
  },
): Promise<{ created: boolean; pattern: string } | null> {
  const pattern = deriveCategoryPattern(args.tx.rawLabel, args.tx.counterparty)
  if (!pattern) return null

  const detailed = args.status === 'charge' || args.status === 'product'
  const fields = {
    status: args.status,
    category: detailed ? args.category : undefined,
    vatRateBps: detailed ? args.vatRateBps : undefined,
  }

  const existing = await ctx.db
    .query('categoryRules')
    .withIndex('by_org_and_pattern', (q) =>
      q.eq('orgId', args.orgId).eq('pattern', pattern),
    )
    .unique()
  if (existing) {
    await ctx.db.patch('categoryRules', existing._id, {
      ...fields,
      createdBy: args.createdBy,
    })
    return { created: false, pattern }
  }
  await ctx.db.insert('categoryRules', {
    orgId: args.orgId,
    pattern,
    ...fields,
    createdBy: args.createdBy,
  })
  return { created: true, pattern }
}

/**
 * Rule fields to merge into a transaction insert/patch, or null when no
 * rule matches. Shared by the ingestion hooks (Powens webhook, Mémo CSV)
 * and `transactions:applyCategoryRules`.
 */
export function ruleFieldsFor(
  rules: Array<Doc<'categoryRules'>>,
  searchText: string | undefined,
): {
  matchStatus: CategoryRuleStatus
  category?: string
  vatRateBps?: 0 | 550 | 1000 | 2000
} | null {
  const rule = findMatchingRule(rules, searchText)
  if (!rule) return null
  return {
    matchStatus: rule.status,
    category: rule.category,
    vatRateBps: rule.vatRateBps,
  }
}
