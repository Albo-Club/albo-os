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
  kind: 'equity' | 'intercompany_loan' | 'loan' | 'property'
  /** Target _id as a string (`transactions.allocation` convention). */
  targetId: string
  label: string
  sublabel: string
}

/** The four target groups of the combobox, built separately. */
export type LiabilityOptionGroups = {
  equityOptions: Array<LiabilityOption>
  loanOptions: Array<LiabilityOption>
  /** Bank debt (`loans`) — NOT the shareholder current accounts above. */
  bankLoanOptions: Array<LiabilityOption>
  /**
   * Real-estate assets (`properties`). The only group whose targets need a
   * second choice — the nature of the flow (SPEC D42) — which the combobox
   * asks for before it emits the target.
   */
  propertyOptions: Array<LiabilityOption>
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
    counterpartyName: string | null
  }>
}

/**
 * Subset of the `loans:listOptions` return consumed by the combobox. A
 * SEPARATE source from `LiabilitiesForOptions` on purpose: each group is fed
 * directly from its own query, never from a flattened list re-filtered by
 * `kind` — that is the wiring the tests lock down.
 */
export type BankLoansForOptions = Array<{
  _id: string
  label: string
  lenderName: string
}>

/** Subset of the `properties:listOptions` return consumed by the combobox. */
export type PropertiesForOptions = Array<{
  _id: string
  name: string
  address: string
}>

/** Resolved labels (i18n on the caller side). */
export type LiabilityOptionLabels = {
  /** Label of an equity position type (e.g. « Capital social »). */
  equityType: (type: string) => string
  /** « Dette » (payable) — a C/C is only ever pointable by its debtor. */
  payable: string
}

/**
 * Builds the « Capitaux propres », « Comptes courants », « Prêts » and
 * « Biens » group options of the pointage combobox. A loan is identified by
 * its `_id` (an `intercompanyLoan` has NO `orgId` — only
 * fromOrgId/toOrgId), and only the C/C the org OWES reach this list: the
 * lender's side of an advance is pointed on its `cca` deal, in the Deals
 * group.
 *
 * `bankLoans` and `properties` are undefined while their own queries are
 * still loading: the group then renders EMPTY rather than absent —
 * « missing » and « empty » must stay distinguishable (KNOWN_ISSUES
 * « Passif »).
 */
export function buildLiabilityOptions(
  liabilities: LiabilitiesForOptions,
  labels: LiabilityOptionLabels,
  bankLoans: BankLoansForOptions = [],
  properties: PropertiesForOptions = [],
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
      sublabel: labels.payable,
    })),
    bankLoanOptions: bankLoans.map((loan) => ({
      kind: 'loan' as const,
      targetId: loan._id,
      label: loan.label,
      sublabel: loan.lenderName,
    })),
    propertyOptions: properties.map((property) => ({
      kind: 'property' as const,
      targetId: property._id,
      label: property.name,
      sublabel: property.address,
    })),
  }
}
