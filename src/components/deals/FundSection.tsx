import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * Section « Fonds » d'un deal fund_lp : engagé / appelé / distribué + DPI,
 * et TVPI dès qu'une valorisation existe (NAV de la position). Appelé =
 * Σ transactions out, distribué = Σ in — mêmes agrégats que l'en-tête.
 */
export function FundSection({
  dealId,
  committedAmount,
  calledCents,
  distributedCents,
}: {
  dealId: Id<'deals'>
  committedAmount: number | null | undefined
  calledCents: number | undefined
  distributedCents: number | undefined
}) {
  const { t, i18n } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const valuations = useConvexQuery(api.valuations.list, { dealId })

  const lastFairValue = valuations?.at(0)?.fairValue ?? null
  const fmtMultiple = (ratio: number | null) =>
    ratio == null
      ? '—'
      : `${new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }).format(ratio)}×`

  const called = calledCents ?? 0
  const distributed = distributedCents ?? 0
  const dpi = called > 0 ? distributed / called : null
  const tvpi =
    called > 0 && lastFairValue != null
      ? (distributed + lastFairValue) / called
      : null

  const cards: Array<{ label: string; value: string }> = [
    { label: t('fund.committed'), value: fmtEur(committedAmount) },
    { label: t('fund.called'), value: fmtEur(called) },
    { label: t('fund.distributed'), value: fmtEur(distributed) },
    { label: t('fund.dpi'), value: fmtMultiple(dpi) },
    { label: t('fund.tvpi'), value: fmtMultiple(tvpi) },
  ]

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('fund.title')}
      </h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border p-4">
            <div className="text-muted-foreground text-xs">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <h3 className="text-sm font-semibold">{t('fund.valuations')}</h3>
      {!valuations ? (
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      ) : valuations.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('fund.valEmpty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fund.col.date')}</TableHead>
                <TableHead className="text-right">
                  {t('fund.col.fairValue')}
                </TableHead>
                <TableHead>{t('fund.col.method')}</TableHead>
                <TableHead>{t('fund.col.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuations.map((valuation) => (
                <TableRow key={valuation._id}>
                  <TableCell>{fmtDate(valuation.asOf)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(valuation.fairValue)}
                  </TableCell>
                  <TableCell>{valuation.valuationMethod ?? '—'}</TableCell>
                  <TableCell>{valuation.source ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
