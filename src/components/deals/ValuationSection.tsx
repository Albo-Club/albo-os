import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { InstrumentKind } from '../../../convex/lib/instruments'
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
 * Only shares get valuation rows derived from the capital operations of the
 * company sheet: an operation moves the shares we HOLD, which the other kinds
 * are not (yet). Everything else is valued by hand here, so the empty state
 * must not promise a confirmed round that will never come.
 *
 * WHICH kinds carry this section is decided elsewhere, once:
 * `tracksValuation` in convex/lib/instrumentMapping.ts.
 */
const CAPITAL_DERIVED_KINDS = new Set<InstrumentKind>(['share'])

/**
 * « Valorisation » of a deal: the valuation history that feeds its TVPI —
 * rows derived from confirmed capital operations (company sheet, shares
 * only), imports, and the manual adjustments entered here (an impairment is
 * just a later row, and wins until the next confirmed round).
 */
export function ValuationSection({
  dealId,
  instrumentKind,
}: {
  dealId: Id<'deals'>
  instrumentKind: InstrumentKind
}) {
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
          {t(
            CAPITAL_DERIVED_KINDS.has(instrumentKind)
              ? 'participations:valuation.empty'
              : 'participations:valuation.emptyManual',
          )}
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
