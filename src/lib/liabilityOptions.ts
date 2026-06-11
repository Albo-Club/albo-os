/**
 * Pure construction of the pointage combobox liability targets, from the
 * return of `liabilities:getLiabilities`.
 *
 * Extracted from the Pointage page to be testable in node:test
 * (tests/liabilityOptions.test.ts): the wiring « a loan in getLiabilities
 * MUST produce a Comptes courants group option » is locked by test — a C/C
 * missing from the combobox can no longer come from a mapping oversight or
 * a wrong kind filter (each group is fed directly from its source, without
 * an intermediate flattened list).
 *
 * Deliberately free of React/i18n dependencies: labels arrive resolved.
 */

/** Pointable liability target (option of a pointage combobox group). */
export type LiabilityOption = {
  kind: 'equity' | 'intercompany_loan'
  /** Target _id as a string (`transactions.allocation` convention). */
  targetId: string
  label: string
  sublabel: string
}

/** The two liability groups of the combobox, built separately. */
export type LiabilityOptionGroups = {
  equityOptions: Array<LiabilityOption>
  loanOptions: Array<LiabilityOption>
}

/** Subset of the `getLiabilities` return consumed by the combobox. */
export type LiabilitiesForOptions = {
  equityPositions: Array<{
    _id: string
    type: string
    holderName: string | null
  }>
  loans: Array<{
    _id: string
    side: 'creditor' | 'debtor'
    counterpartyName: string | null
  }>
}

/** Resolved labels (i18n on the caller side). */
export type LiabilityOptionLabels = {
  /** Label of an equity position type (e.g. « Capital social »). */
  equityType: (type: string) => string
  /** « Créance » (receivable) */
  receivable: string
  /** « Dette » (payable) */
  payable: string
}

/**
 * Builds the « Capitaux propres » and « Comptes courants » group options of
 * the pointage combobox. A loan is identified by its `_id` (an
 * `intercompanyLoan` has NO `orgId` — only fromOrgId/toOrgId).
 */
export function buildLiabilityOptions(
  liabilities: LiabilitiesForOptions,
  labels: LiabilityOptionLabels,
): LiabilityOptionGroups {
  return {
    equityOptions: liabilities.equityPositions.map((position) => ({
      kind: 'equity' as const,
      targetId: position._id,
      label: labels.equityType(position.type),
      sublabel: position.holderName ?? '—',
    })),
    loanOptions: liabilities.loans.map((loan) => ({
      kind: 'intercompany_loan' as const,
      targetId: loan._id,
      label: loan.counterpartyName ?? '—',
      sublabel: loan.side === 'creditor' ? labels.receivable : labels.payable,
    })),
  }
}
