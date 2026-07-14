import { normalizeSearch } from './searchText'

import type { Doc } from '../_generated/dataModel'

/**
 * Broad treasury categories ("plan de trésorerie" of an investment holding —
 * deliberately coarse, no analytical accounting). Slugs are dev-facing and
 * stable; user-facing labels live in i18n (`common:categories.<slug>`).
 *
 * Only `charge` / `product` transactions carry a stored `category` (subtype
 * of their status). Every other status maps to a DERIVED bucket — cf.
 * `effectiveCategory` below.
 *
 * Mirror copy of `src/lib/categories.ts` (convex/ and src/ share no runtime
 * modules) — keep both in sync (tested by tests/categories.test.ts).
 */
export const CHARGE_CATEGORIES = [
  'salaries',
  'fees',
  'subscriptions',
  'rent',
  'bank_fees',
  'general',
] as const

export const PRODUCT_CATEGORIES = [
  'investment_income',
  'rent_income',
  'other_income',
] as const

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number]
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
export type StoredCategory = ChargeCategory | ProductCategory

export function isValidCategory(
  status: 'charge' | 'product',
  category: string,
): category is StoredCategory {
  return status === 'charge'
    ? (CHARGE_CATEGORIES as ReadonlyArray<string>).includes(category)
    : (PRODUCT_CATEGORIES as ReadonlyArray<string>).includes(category)
}

/**
 * Analysis bucket of a transaction, derived from the pointage state:
 * - deal match → 'deals' (investments out / returns in — the direction is
 *   carried separately by the caller);
 * - liability allocation → 'equity' | 'intercos';
 * - tax → 'taxes'; charge/product → stored category or 'uncategorized';
 * - unmatched (or pre-backfill absent status) → 'unmatched';
 * - ignored / internal_transfer → null: EXCLUDED from the analysis (an
 *   internal transfer is not a flow; an explicit "ignored" is an explicit
 *   opt-out) — callers tally them separately for visibility.
 */
export function effectiveCategory(
  tx: Pick<Doc<'transactions'>, 'matchStatus' | 'allocation' | 'category'>,
): string | null {
  const status = tx.matchStatus ?? 'unmatched'
  switch (status) {
    case 'matched':
      if (tx.allocation?.kind === 'equity') return 'equity'
      if (tx.allocation?.kind === 'intercompany_loan') return 'intercos'
      return 'deals'
    case 'tax':
      return 'taxes'
    case 'charge':
    case 'product':
      return tx.category ?? 'uncategorized'
    case 'unmatched':
      return 'unmatched'
    case 'ignored':
    case 'internal_transfer':
      return null
  }
}

/**
 * Stable pattern of a transaction label, used as the key of a learned
 * categorization rule. Prefers the counterparty (already clean) and falls
 * back to the raw label with its volatile tokens removed (dates, references,
 * amounts — any token that is half digits or more). Bank labels repeat their
 * stable words month after month while references churn, so the surviving
 * first tokens identify the recurring flow.
 *
 * Returns null when nothing stable remains (all-numeric labels).
 */
export function deriveCategoryPattern(
  rawLabel: string,
  counterparty?: string | null,
): string | null {
  const base = counterparty?.trim() ? counterparty : rawLabel
  const tokens = normalizeSearch(base)
    .split(/\s+/)
    .filter((token) => {
      if (token.length <= 1) return false
      const digits = token.replace(/\D/g, '').length
      return digits < token.length / 2
    })
  if (tokens.length === 0) return null
  return tokens.slice(0, 4).join(' ')
}

/**
 * Does a transaction match a rule pattern? Token-subset test on the
 * normalized `searchText` (pattern tokens are non-consecutive in the
 * original label — the volatile tokens between them were dropped).
 */
export function matchesCategoryPattern(
  searchText: string | undefined,
  pattern: string,
): boolean {
  if (!searchText) return false
  const haystack = new Set(searchText.split(/\s+/))
  return pattern.split(' ').every((token) => haystack.has(token))
}

/**
 * First matching rule for a transaction, most specific first (longest
 * pattern = most stable tokens). Pure — the caller loads the org's rules.
 */
export function findMatchingRule<TRule extends { pattern: string }>(
  rules: Array<TRule>,
  searchText: string | undefined,
): TRule | null {
  const sorted = [...rules].sort(
    (a, b) => b.pattern.length - a.pattern.length,
  )
  for (const rule of sorted) {
    if (matchesCategoryPattern(searchText, rule.pattern)) return rule
  }
  return null
}
