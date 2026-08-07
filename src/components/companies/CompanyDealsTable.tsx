import { ArrowRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { tvpi as tvpiRatio } from '../../../convex/lib/metrics'

import type { DealRow } from '~/components/participations/ParticipationsTable'
import {
  dealAmountTiles,
  residualCents,
  useDealTitle,
  useFormatters,
} from '~/components/participations/ParticipationsTable'
import { dealStatusBadge, dealStatusLabelKey } from '~/lib/dealStatusBadge'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * Deals of ONE company, styled like the participations list (same row height,
 * whole-row click). The status reads on a single badge, coloured by
 * `dealStatusBadge` on the participations palette (amber TS, blue open,
 * green/red exits). One row = one deal, clicking it opens the deal sheet. Feeds
 * on the enriched `deals.list` result the company page already loads — no
 * extra query. Lists are short (a handful of deals per company), so no
 * sticky header / sort / pagination — only a fixed order: pending Term
 * Sheets first (they need attention), then open positions, exits last.
 */
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  active: 1,
  fully_exited: 2,
  written_off: 2,
  // Cancelled deals close the list: they are the least actionable of all.
  cancelled: 3,
}

export function CompanyDealsTable({
  deals,
  orgSlug,
}: {
  deals: Array<DealRow>
  orgSlug: string
}) {
  const { t } = useTranslation('participations')
  const ordered = [...deals].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) ||
      (b.signedDate ?? 0) - (a.signedDate ?? 0),
  )
  return (
    <div className="rounded-lg border">
      <Table className="[&_td]:py-3">
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.deal')}</TableHead>
            <TableHead>{t('deal.status')}</TableHead>
            <TableHead className="text-right">{t('deal.signed')}</TableHead>
            <TableHead className="text-right">{t('col.invested')}</TableHead>
            <TableHead className="text-right">{t('col.received')}</TableHead>
            <TableHead className="text-right">{t('col.tvpi')}</TableHead>
            {/* Trailing column for the per-row hover chevron. */}
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((deal) => (
            <CompanyDealRow key={deal._id} deal={deal} orgSlug={orgSlug} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CompanyDealRow({
  deal,
  orgSlug,
}: {
  deal: DealRow
  orgSlug: string
}) {
  const { t } = useTranslation('participations')
  const navigate = useNavigate()
  const dealTitle = useDealTitle()
  const { fmtEur, fmtEurCents, fmtDate, fmtMultiple } = useFormatters()

  const title = dealTitle(deal)
  // Secondary line under the title: the instrument (only when hidden by a
  // custom name) and the investor (+ SPV) — the fields the former DealsList
  // block surfaced besides the columns.
  const secondaryParts = [
    deal.name
      ? t(`instrument.${deal.instrumentKind}`, {
          defaultValue: deal.instrumentKind,
        })
      : null,
    deal.investor
      ? deal.spv
        ? `${deal.investor.name} · ${t('deal.viaSpv')} ${deal.spv.name}`
        : deal.investor.name
      : null,
  ].filter((p): p is string => p != null)

  const tvpi = tvpiRatio({
    capital: deal.paidActual ?? 0,
    proceeds: deal.received ?? 0,
    residual: residualCents(deal),
  })
  const statusBadge = dealStatusBadge(deal.status, deal.moic)
  // Same tiles as the deal sheet: committed + paid for funds, forecast
  // commitment for a pending TS, paid (cent-precise) otherwise.
  const tiles = dealAmountTiles(deal)

  const open = () =>
    navigate({
      to: '/app/$orgSlug/deals/$dealId',
      params: { orgSlug, dealId: deal._id },
    })

  return (
    <TableRow
      className="group cursor-pointer"
      onClick={open}
      // Keyboard path: the row is the only way to the deal sheet from here.
      tabIndex={0}
      role="link"
      aria-label={t('rowOpenAria', { name: title })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open()
      }}
    >
      <TableCell className="font-medium">
        <span className="flex flex-col">
          <span>{title}</span>
          {secondaryParts.length > 0 && (
            <span className="text-muted-foreground text-xs font-normal">
              {secondaryParts.join(' · ')}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={statusBadge.variant} className={statusBadge.className}>
          {t(`status.${dealStatusLabelKey(deal.status, deal.moic)}`, {
            defaultValue: deal.status,
          })}
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtDate(deal.signedDate)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {tiles.map((tile) => (
          <div key={tile.labelKey}>
            {/* Label the amount when it isn't the plain paid-to-date figure
                (fund committed vs paid, pending forecast commitment). */}
            {(tiles.length > 1 || tile.labelKey !== 'deal.paid') && (
              <span className="text-muted-foreground me-1.5 text-xs">
                {t(tile.labelKey)}
              </span>
            )}
            {tile.precise ? fmtEurCents(tile.cents) : fmtEur(tile.cents)}
          </div>
        ))}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums${
          (deal.received ?? 0) === 0 ? ' text-muted-foreground' : ''
        }`}
      >
        {fmtEurCents(deal.received ?? 0)}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums${
          tvpi != null && Math.round(tvpi * 100) === 100
            ? ' text-muted-foreground'
            : ''
        }`}
      >
        {fmtMultiple(tvpi)}
      </TableCell>
      <TableCell className="w-8 text-right">
        <ArrowRight
          aria-hidden
          className="text-muted-foreground inline size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </TableCell>
    </TableRow>
  )
}
