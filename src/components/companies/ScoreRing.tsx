import type { ScoreVerdict } from '~/lib/reportScore'
import { scoreVerdict } from '~/lib/reportScore'
import { cn } from '~/lib/utils'

/**
 * Ring stroke + digit color per verdict, written out in full so Tailwind keeps
 * the utilities (no dynamic class construction). Same verdict buckets as the
 * fiche's verdict text (reportScore.scoreVerdict), so the ring color always
 * matches "En bonne voie / À surveiller / À risque".
 */
const VERDICT_RING: Record<ScoreVerdict, { stroke: string; text: string }> = {
  good: { stroke: 'stroke-positive', text: 'text-positive' },
  watch: { stroke: 'stroke-warning', text: 'text-warning' },
  risk: { stroke: 'stroke-destructive', text: 'text-destructive' },
}

const SIZES = {
  sm: { box: 'size-7', text: 'text-xs', stroke: 3.5 },
  lg: { box: 'size-13', text: 'text-xl', stroke: 3 },
} as const

/**
 * Radial gauge for the AI health score (0–10): a faint track plus a colored arc
 * filled to score/10, with the score centered and colored by verdict. Shared by
 * the companies table and the entity sheet so both stay in sync (shape + color).
 */
export function ScoreRing({
  score,
  size = 'sm',
  className,
}: {
  score: number
  size?: keyof typeof SIZES
  className?: string
}) {
  const { stroke, text } = VERDICT_RING[scoreVerdict(score)]
  const { box, text: textSize, stroke: strokeWidth } = SIZES[size]
  // Geometry in a 36×36 viewBox; the radius leaves room for the stroke width.
  const radius = 18 - strokeWidth / 2
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(1, score / 10)) * circumference

  return (
    <span
      className={cn('relative inline-flex shrink-0', box, className)}
      role="img"
      aria-label={`${score}/10`}
      title={`${score}/10`}
    >
      {/* -rotate-90 starts the arc at the top (12 o'clock). */}
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={stroke}
        />
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-semibold tabular-nums leading-none',
          textSize,
          text,
        )}
      >
        {score}
      </span>
    </span>
  )
}
