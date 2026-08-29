/**
 * Pure guarantee logic (no Convex dependency, no Node import): display order
 * of the security interests, and the available margin on a pledged asset.
 *
 * Tested by tests/guarantees.test.ts (node:test, deliberately outside
 * convex/ to stay out of the deployment bundle — same reason as
 * lib/recurrence.ts and lib/amortization.ts).
 */

export type GuaranteeForm =
  | 'nantissement'
  | 'hypotheque'
  | 'ppd'
  | 'caution'
  | 'garantie_organisme'

/**
 * Display order, strongest first (SPEC D48):
 *
 * 1. PPD — a real security over property whose rank dates back to the sale
 *    itself, so it primes a mortgage registered earlier.
 * 2. Mortgage — a real security over property.
 * 3. Nantissement — a real security over securities or a contract, quickly
 *    realizable.
 * 4. Institutional guarantee — personal, but the guarantor is capitalized.
 * 5. Caution — personal; worth exactly the guarantor's solvency.
 *
 * ⚠️ This is a DISPLAY convention, not a legal truth. The real strength of a
 * security also depends on its `rank` (a second rank is only worth what is
 * left after the first) and on the debtor's situation. The sort exists to
 * read fast, never to conclude.
 */
const FORM_STRENGTH: Record<GuaranteeForm, number> = {
  ppd: 1,
  hypotheque: 2,
  nantissement: 3,
  garantie_organisme: 4,
  caution: 5,
}

/** Fields the ordering needs. */
export type OrderableGuarantee = {
  form: GuaranteeForm
  /** 1 = first rank, 2 = second… Absent = unknown, sorted after the ranked. */
  rank?: number
  pledgedAmountCents?: number
  /** Released (mainlevée) guarantees sink to the bottom — history, not risk. */
  releasedAt?: number
}

/**
 * Comparator: released last, then by form strength, then by rank (a first
 * rank before a second), then by the biggest pledged amount. Unquantified
 * guarantees come after quantified ones of the same form and rank — they
 * cannot be weighed.
 */
export function compareGuaranteeStrength(
  a: OrderableGuarantee,
  b: OrderableGuarantee,
): number {
  const releasedA = a.releasedAt != null ? 1 : 0
  const releasedB = b.releasedAt != null ? 1 : 0
  if (releasedA !== releasedB) return releasedA - releasedB

  const byForm = FORM_STRENGTH[a.form] - FORM_STRENGTH[b.form]
  if (byForm !== 0) return byForm

  const rankA = a.rank ?? Number.MAX_SAFE_INTEGER
  const rankB = b.rank ?? Number.MAX_SAFE_INTEGER
  if (rankA !== rankB) return rankA - rankB

  const amountA = a.pledgedAmountCents ?? -1
  const amountB = b.pledgedAmountCents ?? -1
  return amountB - amountA
}

/** Sorted copy — never mutates the input. */
export function sortByStrength<T extends OrderableGuarantee>(
  guarantees: ReadonlyArray<T>,
): Array<T> {
  return [...guarantees].sort(compareGuaranteeStrength)
}

/** Whether a guarantee still bites. `releasedAt` set = mainlevée (C6). */
export function isActive(guarantee: { releasedAt?: number }): boolean {
  return guarantee.releasedAt == null
}

export type PledgeSummary = {
  /** Last known valuation of the asset. `null` when it has never been valued. */
  currentValueCents: number | null
  /** Σ of the QUANTIFIED active pledges. */
  pledgedTotalCents: number
  /** Value − total. `null` when the asset has no valuation to compare to. */
  availableMarginCents: number | null
  /** Active pledges carrying no amount — excluded from the total (C3). */
  unquantifiedCount: number
  activeCount: number
  releasedCount: number
}

/**
 * Available margin on a pledged asset (SPEC § 5.2).
 *
 * Three things this deliberately does NOT do:
 *
 * 1. **Unquantified guarantees are excluded from the total**, and counted
 *    apart. An unlimited caution does not add up; showing it as 0 would lie.
 * 2. **The pledged amount is not the asset's value** — it is the amount on
 *    the deed, and it may exceed the asset's worth. A negative margin is
 *    information, not a bug (C2).
 * 3. **The pledged amount does not decrease with the debt.** A 300 K€
 *    nantissement on a loan with 150 K€ left is still legally worth 300 K€
 *    until the mainlevée. The margin shown is therefore PESSIMISTIC — by
 *    design.
 */
export function summarizePledges(
  currentValueCents: number | null,
  pledges: ReadonlyArray<{
    pledgedAmountCents?: number
    releasedAt?: number
  }>,
): PledgeSummary {
  let pledgedTotalCents = 0
  let unquantifiedCount = 0
  let activeCount = 0
  let releasedCount = 0

  for (const pledge of pledges) {
    if (!isActive(pledge)) {
      releasedCount += 1
      continue
    }
    activeCount += 1
    if (pledge.pledgedAmountCents == null) unquantifiedCount += 1
    else pledgedTotalCents += pledge.pledgedAmountCents
  }

  return {
    currentValueCents,
    pledgedTotalCents,
    availableMarginCents:
      currentValueCents === null ? null : currentValueCents - pledgedTotalCents,
    unquantifiedCount,
    activeCount,
    releasedCount,
  }
}
