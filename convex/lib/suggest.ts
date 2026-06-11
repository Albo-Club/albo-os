/**
 * Pure ranking of pointage suggestions (agent tool `suggestMatches`).
 * Module without Convex imports so it stays testable via node:test
 * (cf. tests/suggest.test.ts).
 *
 * Signals (loaded by the internalQuery, cf. convex/agentToolsPointage.ts):
 * - `similarTargets`: targets of the ALREADY matched transactions whose
 *   label is similar (search index `search_text`) — one entry per similar
 *   transaction, duplicates build the frequency.
 * - `decisionsCountByTarget`: count of recent `matched` decisions per
 *   target (`matchingDecisions` table).
 * - amount Δ vs the deal's `committedAmount` (when known).
 */

export type CandidateKind = 'deal' | 'equity' | 'intercompany_loan'

export type SimilarTarget = {
  kind: CandidateKind
  targetId: string
  targetLabel: string | null
  /** Deal committedAmount in cents — null for equity/C-C or when absent. */
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
    // The similar label is the dominant signal; past decisions break
    // ties; an amount close to committedAmount (±1 %, min 1 €) gives a
    // bonus.
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
