/**
 * Health-score → verdict → semantic tone, centralised so every score display
 * (the ScoreRing gauge, the fiche verdict text) stays consistent. Score is 0–10
 * (companyIntelligence.health_score.score).
 *
 * Thresholds (validated): ≥7 good, 5–6 watch, ≤4 risk. Verdicts map to the brand
 * tokens positive / warning / destructive (cf. src/styles/brand.css); the exact
 * class strings live at each render site (ScoreRing) so Tailwind can see them.
 */

export type ScoreVerdict = 'good' | 'watch' | 'risk'

/** Map a 0–10 health score to its verdict bucket. */
export function scoreVerdict(score: number): ScoreVerdict {
  if (score >= 7) return 'good'
  if (score >= 5) return 'watch'
  return 'risk'
}
