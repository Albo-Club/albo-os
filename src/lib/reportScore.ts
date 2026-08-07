/**
 * Health-score → verdict → semantic tone, centralised so every score display
 * (the ScoreRing gauge, the fiche verdict text) stays consistent. Score is 0–10
 * (companyIntelligence.health_score.score).
 *
 * Thresholds (validated): ≥7 good, 5–6 watch, ≤4 risk. They mirror the scoring
 * rubric of INTELLIGENCE_SYSTEM_PROMPT (convex/lib/reportPrompts.ts) band for
 * band — "Excellent" 9-10 / "En bonne voie" 7-8 are good, "À surveiller" 5-6 is
 * watch, "Préoccupant" 3-4 / "Critique" 1-2 are risk. Move one, move the other,
 * or a company reads "En bonne voie" in amber. Verdicts map to the brand tokens
 * positive / warning / destructive (cf. src/styles/brand.css); the exact class
 * strings live at each render site (ScoreRing) so Tailwind can see them.
 */

export type ScoreVerdict = 'good' | 'watch' | 'risk'

/** Map a 0–10 health score to its verdict bucket. */
export function scoreVerdict(score: number): ScoreVerdict {
  if (score >= 7) return 'good'
  if (score >= 5) return 'watch'
  return 'risk'
}
