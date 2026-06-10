/**
 * Ranking pur des suggestions de pointage (outil agent `suggestMatches`).
 * Module sans import Convex pour rester testable via node:test
 * (cf. tests/suggest.test.ts).
 *
 * Signaux (chargés par l'internalQuery, cf. convex/agentToolsPointage.ts) :
 * - `similarTargets` : cibles des transactions DÉJÀ matchées dont le libellé
 *   est similaire (search index `search_text`) — une entrée par transaction
 *   similaire, les doublons font la fréquence.
 * - `decisionsCountByTarget` : nb de décisions `matched` récentes par cible
 *   (table `matchingDecisions`).
 * - Δ montant vs `committedAmount` du deal (si connu).
 */

export type CandidateKind = 'deal' | 'equity' | 'intercompany_loan'

export type SimilarTarget = {
  kind: CandidateKind
  targetId: string
  targetLabel: string | null
  /** committedAmount du deal en cents — null pour equity/C-C ou si absent. */
  committedAmountCents: number | null
}

export type RankedCandidate = {
  kind: CandidateKind
  targetId: string
  targetLabel: string | null
  evidence: {
    similarMatchedCount: number
    decisionsCount: number
    amountDeltaCents: number | null
  }
  score: number
}

const MAX_CANDIDATES = 3
const DECISIONS_CAP = 5

export function rankCandidates({
  txAmountCents,
  similarTargets,
  decisionsCountByTarget,
}: {
  txAmountCents: number
  similarTargets: Array<SimilarTarget>
  decisionsCountByTarget: Record<string, number>
}): Array<RankedCandidate> {
  const byKey = new Map<
    string,
    { target: SimilarTarget; similarMatchedCount: number }
  >()
  for (const target of similarTargets) {
    const key = `${target.kind}:${target.targetId}`
    const entry = byKey.get(key)
    if (entry) {
      entry.similarMatchedCount += 1
    } else {
      byKey.set(key, { target, similarMatchedCount: 1 })
    }
  }

  const candidates: Array<RankedCandidate> = []
  for (const { target, similarMatchedCount } of byKey.values()) {
    const decisionsCount = decisionsCountByTarget[target.targetId] ?? 0
    const amountDeltaCents =
      target.committedAmountCents != null
        ? Math.abs(txAmountCents - target.committedAmountCents)
        : null
    // Le libellé similaire est le signal dominant ; les décisions passées
    // départagent ; un montant proche du committedAmount (±1 %, min 1 €)
    // donne un bonus.
    const amountBonus =
      amountDeltaCents != null &&
      target.committedAmountCents != null &&
      amountDeltaCents <= Math.max(100, target.committedAmountCents * 0.01)
        ? 2
        : 0
    candidates.push({
      kind: target.kind,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      evidence: { similarMatchedCount, decisionsCount, amountDeltaCents },
      score:
        similarMatchedCount * 3 +
        Math.min(decisionsCount, DECISIONS_CAP) +
        amountBonus,
    })
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.evidence.similarMatchedCount - a.evidence.similarMatchedCount ||
      (a.targetLabel ?? '').localeCompare(b.targetLabel ?? ''),
  )
  return candidates.slice(0, MAX_CANDIDATES)
}
