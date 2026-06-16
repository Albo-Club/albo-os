import { useTranslation } from 'react-i18next'

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { useFormatters } from '~/components/participations/ParticipationsTable'

type AllocationRow = { kind: string; paidCents: number }

/**
 * Deployed capital broken down by instrument. Bars use the accent token
 * (`--chart-1`) at a descending opacity per rank for the gradient effect —
 * theme-driven, never a hardcoded color.
 */
export function AllocationCard({
  totalCents,
  rows,
}: {
  totalCents: number
  rows: Array<AllocationRow>
}) {
  const { t } = useTranslation(['dashboard', 'participations'])
  const { fmtEur, fmtEurCompact } = useFormatters()
  const max = rows.at(0)?.paidCents ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t('dashboard:allocation.title')}
        </CardTitle>
        {totalCents > 0 ? (
          <CardAction className="text-muted-foreground text-sm tabular-nums">
            {fmtEurCompact(totalCents)}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t('dashboard:allocation.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.kind} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {t(`participations:instrument.${row.kind}`, {
                      defaultValue: row.kind,
                    })}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtEur(row.paidCents)}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${max > 0 ? Math.max(2, (row.paidCents / max) * 100) : 0}%`,
                      backgroundColor: 'var(--chart-1)',
                      opacity: Math.max(0.4, 1 - index * 0.13),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
