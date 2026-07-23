import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import { PlanVsActualChart } from './PlanVsActualChart'
import type { Id } from '../../../convex/_generated/dataModel'
import { buildPlanVsActual } from '~/lib/projectionSeries'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { cn } from '~/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * "Business plan vs actual" section of a deal. Always mounted (the query
 * is trivial) but only renders something for royalties — or as soon as a
 * BP exists, whatever the instrument. BP entry goes through the assistant
 * (setDealProjections), not a form.
 */
export function PlanVsActualSection({
  dealId,
  instrumentKind,
  txs,
}: {
  dealId: Id<'deals'>
  instrumentKind: string
  txs:
    | Array<{ transactionDate: number; amount: number; direction: 'in' | 'out' }>
    | undefined
}) {
  const { t } = useTranslation('participations')
  // Chart keeps the rounded fmtEur (cent-level ticks would be unreadable); the
  // comparison table below shows fmtEurCents so the gap ties out to the cent.
  const { fmtEur, fmtEurCents, fmtDate } = useFormatters()
  const projections = useConvexQuery(api.projections.listByDeal, { dealId })

  const hasLines =
    (projections?.initial.length ?? 0) + (projections?.revised.length ?? 0) > 0
  if (instrumentKind !== 'royalty' && !hasLines) return null

  const rows = projections
    ? buildPlanVsActual({
        initial: projections.initial,
        revised: projections.revised,
        actuals: txs ?? [],
      })
    : []
  const hasRevised = (projections?.revised.length ?? 0) > 0

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('plan.title')}
      </h2>

      {!projections ? (
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          <p>{t('plan.empty')}</p>
          <p className="mt-1 text-xs">{t('plan.emptyHint')}</p>
        </div>
      ) : (
        <>
          <PlanVsActualChart
            rows={rows}
            hasRevised={hasRevised}
            labels={{
              initial: t('plan.chart.initial'),
              revised: t('plan.chart.revised'),
              actual: t('plan.chart.actual'),
            }}
            fmtEur={fmtEur}
            fmtPeriod={(ms) => fmtDate(ms)}
          />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('plan.col.period')}</TableHead>
                  <TableHead className="text-right">
                    {t('plan.col.initial')}
                  </TableHead>
                  {hasRevised && (
                    <TableHead className="text-right">
                      {t('plan.col.revised')}
                    </TableHead>
                  )}
                  <TableHead className="text-right">
                    {t('plan.col.actual')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('plan.col.gap')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.period}>
                    <TableCell>{fmtDate(row.period)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEurCents(row.initialCents)}
                    </TableCell>
                    {hasRevised && (
                      <TableCell className="text-right tabular-nums">
                        {fmtEurCents(row.revisedCents)}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {fmtEurCents(row.actualCents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        row.gapCumCents < 0
                          ? 'text-destructive'
                          : row.gapCumCents > 0
                            ? 'text-positive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {fmtEurCents(row.gapCumCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  )
}
