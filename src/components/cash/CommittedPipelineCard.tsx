import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

/**
 * Undated committed pipeline of the org's signed deals (committedAmount −
 * realized « Versé », forecasts.getCommittedPipeline). Real obligations with
 * no schedule — never invented into the curve's months; creating a one-off
 * entry is the way to date a capital call, hence its home next to the rules
 * and entries of the Gestion tab (it moved there when the category × month
 * grid retired). Renders nothing when everything committed is deployed.
 */
export function CommittedPipelineCard({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('cash')
  const { fmtEur } = useFormatters()
  const pipeline = useConvexQuery(api.forecasts.getCommittedPipeline, { orgId })

  if (!pipeline || pipeline.totalRemainingCents <= 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {t('forecast.pipeline.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold tabular-nums">
          {fmtEur(pipeline.totalRemainingCents)}
        </p>
        <ul className="text-muted-foreground space-y-1 text-sm">
          {pipeline.rows.slice(0, 5).map((row) => (
            <li key={row.dealId} className="flex justify-between gap-4">
              <span className="truncate">{row.name}</span>
              <span className="tabular-nums">{fmtEur(row.remainingCents)}</span>
            </li>
          ))}
          {pipeline.rows.length > 5 && (
            <li>
              {t('forecast.pipeline.more', {
                count: pipeline.rows.length - 5,
              })}
            </li>
          )}
        </ul>
        <p className="text-muted-foreground text-xs">
          {t('forecast.pipeline.hint')}
        </p>
      </CardContent>
    </Card>
  )
}
