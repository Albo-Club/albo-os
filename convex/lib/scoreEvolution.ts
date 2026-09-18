/**
 * Where a company's AI health score comes from, read back from the activity
 * journal (`companyEvents`, kind `score_updated`) — the score's only history
 * (ALB-252). One shape for every surface that shows "before → after": the
 * fiche's synthesis block, the report confirmation mail, the Monday digest.
 */
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

export type ScoreEvolution = {
  /** The score before the latest synthesis; `null` on a first score. */
  previousScore: number | null
  /** The report the previous score was computed on, when the journal has it. */
  previousReportLabel?: string
}

/**
 * The latest `score_updated` event of a company, as a before/after. Null when
 * the company was never scored since the journal started recording scores —
 * the callers then show nothing rather than guessing.
 */
export async function latestScoreEvolution(
  ctx: { db: GenericDatabaseReader<DataModel> },
  companyId: Id<'companies'>,
): Promise<ScoreEvolution | null> {
  let latest: ScoreEvolution | null = null
  for await (const row of ctx.db
    .query('companyEvents')
    .withIndex('by_company_at', (q) => q.eq('companyId', companyId))
    .order('desc')) {
    if (row.event.kind !== 'score_updated') continue
    if (!latest) {
      latest = { previousScore: row.event.from ?? null }
      if (latest.previousScore === null) break
      continue
    }
    // The event before the latest one carries the report its score came from.
    if (row.event.reportLabel)
      latest.previousReportLabel = row.event.reportLabel
    break
  }
  return latest
}

/** Direction of the latest change, for the arrow and its colour. */
export function scoreDirection(
  score: number,
  evolution: ScoreEvolution,
): 'first' | 'up' | 'down' | 'same' {
  if (evolution.previousScore === null) return 'first'
  if (score > evolution.previousScore) return 'up'
  if (score < evolution.previousScore) return 'down'
  return 'same'
}
