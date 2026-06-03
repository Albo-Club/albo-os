/**
 * Construction pure des cibles passif du combobox de pointage, à partir du
 * retour de `liabilities:getLiabilities`.
 *
 * Extraite de la page Pointage pour être testable en node:test
 * (tests/liabilityOptions.test.ts) : le câblage « un loan dans getLiabilities
 * DOIT produire une option de groupe Comptes courants » est verrouillé par
 * test — un C/C absent du combobox ne peut plus venir d'un oubli de mapping
 * ou d'un filtre par kind erroné (chaque groupe est alimenté directement
 * depuis sa source, sans liste aplatie intermédiaire).
 *
 * Volontairement sans dépendance React/i18n : les libellés arrivent résolus.
 */

/** Cible passif pointable (option d'un groupe du combobox de pointage). */
export type LiabilityOption = {
  kind: 'equity' | 'intercompany_loan'
  /** _id de la cible en string (convention `transactions.allocation`). */
  targetId: string
  label: string
  sublabel: string
}

/** Les deux groupes passif du combobox, construits séparément. */
export type LiabilityOptionGroups = {
  equityOptions: Array<LiabilityOption>
  loanOptions: Array<LiabilityOption>
}

/** Sous-ensemble du retour de `getLiabilities` consommé par le combobox. */
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

/** Libellés résolus (i18n côté appelant). */
export type LiabilityOptionLabels = {
  /** Libellé d'un type de position de capital (ex. « Capital social »). */
  equityType: (type: string) => string
  /** « Créance » */
  receivable: string
  /** « Dette » */
  payable: string
}

/**
 * Construit les options des groupes « Capitaux propres » et « Comptes
 * courants » du combobox de pointage. Un loan est identifié par son `_id`
 * (un `intercompanyLoan` n'a PAS d'`orgId` — seulement fromOrgId/toOrgId).
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
