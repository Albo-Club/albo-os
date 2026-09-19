import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import {
  AdjustValuationDialog,
  useValuationLabel,
} from '~/components/deals/AdjustValuationDialog'
import { Button } from '~/components/ui/button'
import { LoadingLine } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * « Valorisation » of a deal that tracks one (tracksValuation in
 * convex/lib/instrumentMapping.ts): the valuation history that feeds its
 * TVPI — rows derived from confirmed capital operations (company sheet),
 * imports, and the manual adjustments entered here (an impairment is just a
 * later row, and wins until the next confirmed round).
 */
export function ValuationSection({ dealId }: { dealId: Id<'deals'> }) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const valuations = useConvexQuery(api.valuations.list, { dealId })
  const label = useValuationLabel()
  const [open, setOpen] = useState(false)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('participations:valuation.title')}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t('participations:valuation.adjust')}
        </Button>
      </div>

      {!valuations ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : valuations.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('participations:valuation.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('participations:valuation.col.date')}</TableHead>
                <TableHead className="text-right">
                  {t('participations:valuation.col.fairValue')}
                </TableHead>
                <TableHead>
                  {t('participations:valuation.col.method')}
                </TableHead>
                <TableHead>
                  {t('participations:valuation.col.source')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuations.map((valuation) => (
                <TableRow key={valuation._id}>
                  <TableCell>{fmtDate(valuation.asOf)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(valuation.fairValue)}
                  </TableCell>
                  <TableCell>
                    {label('method', valuation.valuationMethod)}
                  </TableCell>
                  <TableCell>
                    <span title={valuation.notes ?? undefined}>
                      {label('source', valuation.source)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open && (
        <AdjustValuationDialog dealId={dealId} onClose={() => setOpen(false)} />
      )}
    </section>
  )
}
