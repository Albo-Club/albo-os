/**
 * Health-score → verdict → semantic tone, centralised so the report synthesis
 * hero (and any future score display) stay consistent. Score is 0–10
 * (companyIntelligence.health_score.score).
 *
 * Thresholds (validated): ≥7 good, 5–6 watch, ≤4 risk. Tones map to the brand
 * tokens positive / warning / destructive (cf. src/styles/brand.css) and are
 * rendered as tinted squares, same idiom as moneyTone badges. Class strings
 * are written out in full so Tailwind can see them (no dynamic construction).
 */

export type ScoreVerdict = 'good' | 'watch' | 'risk'

/** Map a 0–10 health score to its verdict bucket. */
export function scoreVerdict(score: number): ScoreVerdict {
  if (score >= 7) return 'good'
  if (score >= 5) return 'watch'
  return 'risk'
}

const VERDICT_SQUARE: Record<ScoreVerdict, string> = {
  good: 'bg-positive/15 text-positive border-positive/25',
  watch: 'bg-warning/15 text-warning border-warning/25',
  risk: 'bg-destructive/15 text-destructive border-destructive/25',
}

/** Tinted square classes (bg tint + saturated text + hairline border). */
export function verdictSquareClass(verdict: ScoreVerdict): string {
  return VERDICT_SQUARE[verdict]
}
