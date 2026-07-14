import { useState } from 'react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { directionTone } from '~/lib/moneyTone'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

const WINDOWS = [3, 6, 12] as const

type BreakdownRow = {
  direction: 'in' | 'out'
  category: string
  // A month with no flow has no key (the record is sparse).
  byMonth: Record<string, number | undefined>
  totalCents: number
}

/**
 * « Analyse » tab of the Cash page: monthly in/out amounts by broad category
 * (transactions.getCategoryBreakdown) over a selectable window. Two blocks —
 * inflows then outflows — plus a net line. The `unmatched` bucket shows what
 * is not qualified yet; internal transfers / ignored rows are excluded and
 * tallied in the footnote.
 */
export function CategoryBreakdown({ orgId }: { orgId: Id<'organizations'> }) {
  const { t, i18n } = useTranslation(['cash', 'common'])
  const lang = i18n.language
  const [monthsBack, setMonthsBack] = useState<(typeof WINDOWS)[number]>(6)

  const breakdown = useConvexQuery(api.transactions.getCategoryBreakdown, {
    orgId,
    monthsBack,
  })

  const fmtEur = (cents: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(cents / 100)
  const fmtMonth = (monthKey: string) =>
    new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(lang, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
  const categoryLabel = (slug: string) =>
    t(`common:categories.${slug}`, { defaultValue: slug })

  if (!breakdown) {
    return <Skeleton className="h-64 w-full" />
  }

  const { months } = breakdown
  const rows: Array<BreakdownRow> = breakdown.rows
  const inRows = rows.filter((r) => r.direction === 'in')
  const outRows = rows.filter((r) => r.direction === 'out')
  const monthTotal = (list: Array<BreakdownRow>, month: string) =>
    list.reduce((sum, r) => sum + (r.byMonth[month] ?? 0), 0)

  const section = (
    title: string,
    list: Array<BreakdownRow>,
    tone: string,
  ) => (
    <>
      <TableRow className="bg-muted/40">
        <TableCell className="font-semibold">{title}</TableCell>
        {months.map((m: string) => (
          <TableCell
            key={m}
            className={`text-right font-semibold tabular-nums ${tone}`}
          >
            {monthTotal(list, m) === 0 ? '—' : fmtEur(monthTotal(list, m))}
          </TableCell>
        ))}
        <TableCell className={`text-right font-semibold tabular-nums ${tone}`}>
          {fmtEur(list.reduce((sum, r) => sum + r.totalCents, 0))}
        </TableCell>
      </TableRow>
      {list.map((row) => (
        <TableRow
          key={`${row.direction}:${row.category}`}
          className={
            row.category === 'unmatched' || row.category === 'uncategorized'
              ? 'text-muted-foreground italic'
              : ''
          }
        >
          <TableCell className="pl-6">{categoryLabel(row.category)}</TableCell>
          {months.map((m: string) => (
            <TableCell key={m} className="text-right tabular-nums">
              {row.byMonth[m] == null ? '—' : fmtEur(row.byMonth[m])}
            </TableCell>
          ))}
          <TableCell className="text-right font-medium tabular-nums">
            {fmtEur(row.totalCents)}
          </TableCell>
        </TableRow>
      ))}
    </>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('cash:analysis.title')}
        </h2>
        <Select
          value={String(monthsBack)}
          onValueChange={(value) =>
            setMonthsBack(Number(value) as (typeof WINDOWS)[number])
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {t('cash:analysis.window', { count: m })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {t('cash:analysis.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">
                  {t('cash:analysis.colCategory')}
                </TableHead>
                {months.map((m: string) => (
                  <TableHead key={m} className="text-right whitespace-nowrap">
                    {fmtMonth(m)}
                  </TableHead>
                ))}
                <TableHead className="text-right">
                  {t('cash:analysis.colTotal')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section(t('cash:analysis.inflows'), inRows, directionTone('in'))}
              {section(
                t('cash:analysis.outflows'),
                outRows,
                directionTone('out'),
              )}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold">
                  {t('cash:analysis.net')}
                </TableCell>
                {months.map((m: string) => {
                  const net = monthTotal(inRows, m) - monthTotal(outRows, m)
                  return (
                    <TableCell
                      key={m}
                      className="text-right font-semibold tabular-nums"
                    >
                      {net === 0 ? '—' : fmtEur(net)}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtEur(
                    inRows.reduce((s, r) => s + r.totalCents, 0) -
                      outRows.reduce((s, r) => s + r.totalCents, 0),
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {(breakdown.internalTransferCents > 0 || breakdown.ignoredCents > 0) && (
        <p className="text-muted-foreground text-xs">
          {t('cash:analysis.excluded', {
            internal: fmtEur(breakdown.internalTransferCents),
            ignored: fmtEur(breakdown.ignoredCents),
          })}
        </p>
      )}
    </div>
  )
}
