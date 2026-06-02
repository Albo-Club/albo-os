/**
 * Logique pure du passif (soldes de comptes courants inter-entités).
 *
 * Volontairement sans dépendance au ctx Convex : testée via node:test
 * (tests/liabilities.test.ts), même pattern que lib/recurrence.ts.
 *
 * Règle de dérivation des soldes (cf. KNOWN_ISSUES.md « Passif ») : chaque
 * org dérive le solde d'un C/C de SES PROPRES transactions pointées dessus.
 * - Créancier (fromOrgId) : out = prêt, in = remboursement reçu
 *   → solde positif = créance.
 * - Débiteur (toOrgId) : in = emprunt, out = remboursement versé
 *   → solde négatif = dette.
 * Les deux côtés peuvent diverger si le pointage est incomplet — c'est un
 * signal de réconciliation, pas un bug.
 */

export type LoanSide = 'creditor' | 'debtor'

export type LoanOrgRefs = {
  fromOrgId: string
  toOrgId: string
}

export type AllocatedTx = {
  direction: 'in' | 'out'
  amount: number // cents, toujours positif (convention transactions)
}

/**
 * Position de l'org regardante sur un C/C : créancier si elle est fromOrgId,
 * débiteur si toOrgId, null si elle n'est pas partie au prêt.
 */
export function loanSideForOrg(
  loan: LoanOrgRefs,
  orgId: string,
): LoanSide | null {
  if (loan.fromOrgId === orgId) return 'creditor'
  if (loan.toOrgId === orgId) return 'debtor'
  return null
}

/**
 * Solde signé (cents) d'un C/C du point de vue d'une org, dérivé de ses
 * propres transactions pointées sur le prêt : Σ(out) − Σ(in).
 *
 * La même formule sert les deux côtés :
 * - Créancier : décaisse pour prêter (out) → solde + = créance.
 * - Débiteur : encaisse pour emprunter (in) → solde − = dette.
 */
export function computeLoanBalanceCents(txs: Array<AllocatedTx>): number {
  let balance = 0
  for (const tx of txs) {
    balance += tx.direction === 'out' ? tx.amount : -tx.amount
  }
  return balance
}
