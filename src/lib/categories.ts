/**
 * Broad treasury categories — front mirror of `convex/lib/categories.ts`
 * (convex/ and src/ share no runtime modules; sync is enforced by
 * tests/categories.test.ts). Slugs are dev-facing; labels resolve from
 * i18n (`common:categories.<slug>`).
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

export const DERIVED_FORECAST_CATEGORIES = [
  'deals',
  'equity',
  'intercos',
  'taxes',
] as const

/** Categories a forecast rule/entry can carry, by direction. */
export function forecastCategories(
  direction: 'in' | 'out',
): ReadonlyArray<string> {
  return direction === 'out'
    ? [...CHARGE_CATEGORIES, ...DERIVED_FORECAST_CATEGORIES]
    : [...PRODUCT_CATEGORIES, ...DERIVED_FORECAST_CATEGORIES]
}
