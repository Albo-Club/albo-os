import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { residualValueCents } from '../../../convex/lib/metrics'

import { cn } from '~/lib/utils'
import { CompanyLogo } from '~/components/CompanyLogo'
import { ScoreRing } from '~/components/companies/ScoreRing'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Minimal shape of an enriched deal, shared by per-org and aggregated views. */
export type DealRow = {
  _id: string
  targetCompanyId: string
  /** Custom name — displayed instead of the derived title when present. */
  name?: string | null
  target: {
    _id: string
    name: string
    sector?: string | null
    domain?: string | null
  } | null
  investor: { name: string } | null
  spv: { name: string } | null
  instrumentKind: string
  status: string
  committedAmount?: number | null
  /** Paid: sum of the matched outgoing transactions (computed server-side). */
  paidActual?: number | null
  /** Received: sum of the matched incoming transactions (computed server-side). */
  received?: number | null
  /** Last known valuation (cents), null if none (computed server-side). */
  lastValuationCents?: number | null
  /** Realized MOIC (proceeds/capital), computed server-side. */
  moic?: number | null
  /** Exact per-deal annualized XIRR (decimal), server-side; null if undefined. */
  irr?: number | null
  signedDate?: number | null
  /** Exit date (ms), set on fully_exited / written_off deals. */
  exitedDate?: number | null
  org?: { name: string; slug: string } | null // present in aggregated view
}

/**
 * Residual value of a deal for the TVPI (thin wrapper over the shared
 * `residualValueCents`, kept for the `DealRow` call sites here and in
 * ParticipationsView): 0 if exited/written off, otherwise the last known
 * valuation, falling back to cost.
 */
export function residualCents(deal: DealRow): number {
  return residualValueCents({
    status: deal.status,
    lastValuationCents: deal.lastValuationCents,
    paidActual: deal.paidActual,
  })
}

/**
 * Neutral-value tests for the list's "Received" and "TVPI" columns: a 0 €
 * received or a 1,00× multiple carries no signal, so it's rendered muted to
 * push the eye toward the rows that actually moved. (List-only styling — see
 * the PR note about possibly sharing with the deal sheet / dashboard later.)
 */
const isNeutralAmount = (cents: number) => cents === 0
// Neutral when it rounds to the displayed 1,00× (e.g. cost-based residual, no
// distribution yet), not only when the raw ratio is exactly 1.
const isNeutralTvpi = (ratio: number | null) =>
  ratio != null && Math.round(ratio * 100) === 100

/**
 * Frozen first column (company) for the horizontal scroll: sticky + an OPAQUE
 * background, otherwise the cells sliding underneath show through. The row
 * hover tint (`hover:bg-muted/50` on the <tr>) is translucent, so it can't be
 * inherited either — the cell composites the same color over the page
 * background via color-mix, driven by the row's `group` hover.
 *
 * The header row is ALSO frozen on vertical scroll (the table body scrolls
 * inside a bounded container — see the `[&>div]:max-h-*` wrapper), and the
 * totals row is pinned at the bottom. Sticky is applied per-cell (not on
 * thead/tfoot: unreliable cross-browser), with borders on the cells so they
 * travel with them. z layers: corner cells (left + top/bottom) > header /
 * footer cells > frozen body column.
 */
// Header cells carry the same opaque `bg-muted` as the totals row below: it is
// what makes the column titles read as a band of their own rather than as one
// more participation row.
const headCornerClass = 'sticky top-0 left-0 z-30 border-b bg-muted'
const headCellClass = 'sticky top-0 z-20 border-b bg-muted'
const stickyCellClass =
  'sticky left-0 z-10 bg-background transition-colors ' +
  'group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]'
const footCornerClass = 'sticky bottom-0 left-0 z-30 border-t bg-muted'
const footCellClass = 'sticky bottom-0 z-20 border-t bg-muted'

/** Localized €/date/multiple/percent formatters, shared by the components below. */
export function useFormatters() {
  const { i18n } = useTranslation('participations')
  const lang = i18n.language
  const fmtEur = (cents?: number | null) =>
    cents == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(cents / 100)
  // Cent-precise form for real cash amounts and comparison tables surfaced on
  // the deal sheet (paid/received, royalties, plan-vs-actual): these must tie
  // to the bank to the cent, unlike the rounded fmtEur used across the
  // portfolio/valuation views. See CLAUDE.md § Gestion des arrondis (centimes).
  const fmtEurCents = (cents?: number | null) =>
    cents == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(cents / 100)
  // Compact form for dense KPI tiles (e.g. "54,0 M€", "19,2 k€"); the exact
  // amount is surfaced via a title tooltip on the value.
  const fmtEurCompact = (cents?: number | null) =>
    cents == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          notation: 'compact',
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(cents / 100)
  const fmtDate = (ms?: number | null) =>
    ms == null
      ? '—'
      : new Date(ms).toLocaleDateString(lang, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
  const fmtMultiple = (ratio: number | null) =>
    ratio == null
      ? '—'
      : `${new Intl.NumberFormat(lang, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(ratio)}×`
  // Signed decimal ratio (e.g. -1, 0.15) → percent, for the annualized TRI.
  const fmtPercent = (ratio: number | null) =>
    ratio == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(ratio)
  return { fmtEur, fmtEurCents, fmtEurCompact, fmtDate, fmtMultiple, fmtPercent }
}

/**
 * Display title of a deal: the custom name alone when one is set, otherwise
 * the (i18n) label of the instrument. A renamed deal shows only its name —
 * the instrument type still lives in the deal's info grid and its own column.
 */
export function useDealTitle() {
  const { t } = useTranslation('participations')
  return (deal: { name?: string | null; instrumentKind: string }) => {
    if (deal.name) return deal.name
    return t(`instrument.${deal.instrumentKind}`, {
      defaultValue: deal.instrumentKind,
    })
  }
}

/**
 * Amount tiles to show for a deal, BEFORE the always-present "Reçu". Keeps the
 * commitment vs disbursed distinction only where it's meaningful:
 * - Fund (fund_lp): both « Engagé » (commitment) and « Décaissé (réel) »
 *   (called & paid), which genuinely differ.
 * - Direct deal in term sheet (pending): « Engagé prévisionnel » only — the
 *   disbursed is still 0, so we show the planned amount.
 * - Direct invested deal: « Décaissé (réel) » only — for a wired deal it equals
 *   the commitment, so showing both is redundant.
 */
export function dealAmountTiles(deal: {
  instrumentKind: string
  status: string
  committedAmount?: number | null
  paidActual?: number | null
}): Array<{ labelKey: string; cents: number; precise?: boolean }> {
  const committed = deal.committedAmount ?? 0
  const paid = deal.paidActual ?? 0
  const isFund = deal.instrumentKind === 'fund_lp'
  // `precise`: paid is the sum of matched bank transactions → show to the cent
  // so the tile ties to the cash. Committed is an engagement → stays rounded.
  if (isFund) {
    return [
      { labelKey: 'deal.committed', cents: committed },
      { labelKey: 'deal.paid', cents: paid, precise: true },
    ]
  }
  if (deal.status === 'pending') {
    return [{ labelKey: 'deal.committedForecast', cents: committed }]
  }
  return [{ labelKey: 'deal.paid', cents: paid, precise: true }]
}

/**
 * One pre-aggregated company row (per active/settled bucket), as served by
 * `deals.listParticipations` (per-org) and `aggregate.listParticipations`
 * (cross-org, with `org` set). All the sums/ratios are computed server-side;
 * the facet arrays (instrument kinds, deal & investor names) only feed the
 * toolbar's search + filters in `ParticipationsView`.
 */
export type CompanyRow = {
  companyId: string
  name: string
  domain: string | null
  sector: string | null
  /** Cerveau 3 health score (1-10), null while no synthesis exists. */
  aiScore: number | null
  org: { name: string; slug: string } | null
  /** True for the pending Term-Sheet bucket (its own table on top). */
  pending: boolean
  /** True for the fully_exited / written_off bucket (exit tables). */
  settled: boolean
  dealCount: number
  /** Engagé (cents): summed commitments — the pending table's amount. */
  committed: number
  /** Versé (cents): sum of the matched outgoing transactions. */
  invested: number
  /** Reçu (cents): sum of the matched incoming transactions. */
  received: number
  /** Active rows only. */
  tvpi: number | null
  /** Settled rows only (realized, de-VAT'd proceeds). */
  moic: number | null
  /** Settled rows only: exact XIRR on the union of the deals' dated flows. */
  tri: number | null
  writtenOff: boolean
  instrumentKinds: Array<string>
  dealNames: Array<string>
  investorNames: Array<string>
}

/**
 * Participations table grouped BY COMPANY (one row = one pre-aggregated
 * company bucket from the server projection; clicking a row opens its detail
 * sheet, where the deals are listed). `showOrg` adds an org badge column
 * (cross-org aggregated view). `orgSlug` (per-org view) targets the detail
 * link; in the aggregated view the slug comes from each row's org.
 *
 * The search + facet filters live in the parent `ParticipationsView`, which
 * feeds each instance an already-filtered `rows` set (the active table and the
 * settled section share one toolbar).
 */
type SortKey = 'name' | 'aiScore' | 'deals' | 'invested' | 'received' | 'tvpi'

/** Clickable header of a sortable column (asc ⇄ desc). */
export function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
  sortable = true,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  className?: string
  // When false, render a plain (inert) header — the settled table has no sort.
  sortable?: boolean
}) {
  if (!sortable) return <TableHead className={className}>{label}</TableHead>
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {label}
        <Icon className={`size-3.5 ${active ? '' : 'opacity-40'}`} />
      </button>
    </TableHead>
  )
}

export function ParticipationsTable({
  rows,
  showOrg = false,
  orgSlug,
  variant = 'active',
  isFiltered = false,
}: {
  // Already filtered by the parent toolbar (search + facets).
  rows: Array<CompanyRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  // One table per status bucket: 'pending' swaps the money columns for a
  // single summed commitment (nothing wired yet), 'settled' swaps TVPI for
  // MOIC + annualized TRI; both drop sorting (short lists).
  variant?: 'pending' | 'active' | 'settled'
  // True when the parent search/filters are active — drives the empty message
  // (no results vs. empty scope).
  isFiltered?: boolean
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtMultiple, fmtPercent } = useFormatters()
  const pending = variant === 'pending'
  const settled = variant === 'settled'

  // Column sort (client-side, low volumes). null = server order (rows with a
  // pending Term Sheet first, then most recent deal first). Missing TVPIs /
  // AI scores sink to the end (desc).
  const [sort, setSort] = useState<{
    key: SortKey
    dir: 'asc' | 'desc'
  } | null>(null)
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )
  const sortedRows = useMemo(() => {
    if (!rows || !sort) return rows
    const value = (r: CompanyRow) =>
      sort.key === 'name'
        ? r.name
        : sort.key === 'tvpi'
          ? (r.tvpi ?? Number.NEGATIVE_INFINITY)
          : sort.key === 'aiScore'
            ? (r.aiScore ?? Number.NEGATIVE_INFINITY)
            : sort.key === 'deals'
              ? r.dealCount
              : r[sort.key]
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (typeof va === 'string' && typeof vb === 'string') {
        return sign * va.localeCompare(vb)
      }
      return sign * (Number(va) - Number(vb))
    })
  }, [rows, sort])

  // Airtable-style totals, pinned at the bottom: summed over the WHOLE
  // filtered set. Only the countable columns are summed — never the
  // TVPI/MOIC/TRI ratios.
  const totals = useMemo(() => {
    if (!rows) return null
    let dealCount = 0
    let committed = 0
    let invested = 0
    let received = 0
    for (const r of rows) {
      dealCount += r.dealCount
      committed += r.committed
      invested += r.invested
      received += r.received
    }
    return { dealCount, committed, invested, received }
  }, [rows])

  // Base 8 (company, AI score, deals, invested, received, sector, chevron +
  // TVPI) + the optional org column, plus one more in the settled variant
  // (MOIC + TRI replace TVPI); the pending variant collapses the three money
  // columns into a single summed commitment.
  const colSpan = (pending ? 6 : 8) + (showOrg ? 1 : 0) + (settled ? 1 : 0)

  if (rows && rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {isFiltered ? t('search.noResults') : t('empty')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* The bounded height turns the (shadcn) table container into the
          vertical scroll box the sticky header/totals cells latch onto. */}
      <div className="rounded-lg border [&>div]:max-h-[70vh]">
        <Table className="[&_td]:py-3">
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t('col.company')}
                active={sort?.key === 'name'}
                dir={sort?.dir ?? 'asc'}
                onClick={() => toggleSort('name')}
                sortable={variant === 'active'}
                className={headCornerClass}
              />
              {showOrg && (
                <TableHead className={headCellClass}>{t('col.org')}</TableHead>
              )}
              <SortableHead
                label={t('col.aiScore')}
                active={sort?.key === 'aiScore'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('aiScore')}
                sortable={variant === 'active'}
                className={headCellClass}
              />
              <SortableHead
                label={t('col.deals')}
                active={sort?.key === 'deals'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('deals')}
                className={cn(headCellClass, 'text-right')}
                sortable={variant === 'active'}
              />
              {pending ? (
                <TableHead className={cn(headCellClass, 'text-right')}>
                  {t('col.committed')}
                </TableHead>
              ) : (
                <>
                  <SortableHead
                    label={t('col.invested')}
                    active={sort?.key === 'invested'}
                    dir={sort?.dir ?? 'desc'}
                    onClick={() => toggleSort('invested')}
                    className={cn(headCellClass, 'text-right')}
                    sortable={variant === 'active'}
                  />
                  <SortableHead
                    label={t('col.received')}
                    active={sort?.key === 'received'}
                    dir={sort?.dir ?? 'desc'}
                    onClick={() => toggleSort('received')}
                    className={cn(headCellClass, 'text-right')}
                    sortable={variant === 'active'}
                  />
                </>
              )}
              {variant === 'active' && (
                <SortableHead
                  label={t('col.tvpi')}
                  active={sort?.key === 'tvpi'}
                  dir={sort?.dir ?? 'desc'}
                  onClick={() => toggleSort('tvpi')}
                  className={cn(headCellClass, 'text-right')}
                />
              )}
              {settled && (
                <>
                  <TableHead className={cn(headCellClass, 'text-right')}>
                    {t('col.moic')}
                  </TableHead>
                  <TableHead className={cn(headCellClass, 'text-right')}>
                    {t('col.tri')}
                  </TableHead>
                </>
              )}
              <TableHead className={headCellClass}>{t('col.sector')}</TableHead>
              {/* Trailing column for the per-row hover chevron. */}
              <TableHead className={cn(headCellClass, 'w-8')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!sortedRows ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => (
                <CompanyTableRow
                  key={r.companyId}
                  row={r}
                  showOrg={showOrg}
                  orgSlug={orgSlug}
                  variant={variant}
                  fmtEur={fmtEur}
                  fmtMultiple={fmtMultiple}
                  fmtPercent={fmtPercent}
                />
              ))
            )}
          </TableBody>
          {totals && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className={footCornerClass}>
                  {t('totalsRow')}
                </TableCell>
                {showOrg && <TableCell className={footCellClass} />}
                <TableCell className={footCellClass} />
                <TableCell
                  className={cn(footCellClass, 'text-right tabular-nums')}
                >
                  {t('dealsCount', { count: totals.dealCount })}
                </TableCell>
                {pending ? (
                  <TableCell
                    className={cn(footCellClass, 'text-right tabular-nums')}
                  >
                    {fmtEur(totals.committed)}
                  </TableCell>
                ) : (
                  <>
                    <TableCell
                      className={cn(footCellClass, 'text-right tabular-nums')}
                    >
                      {fmtEur(totals.invested)}
                    </TableCell>
                    <TableCell
                      className={cn(footCellClass, 'text-right tabular-nums')}
                    >
                      {fmtEur(totals.received)}
                    </TableCell>
                    {/* No sum for ratio columns (TVPI, or MOIC + TRI). */}
                    <TableCell className={footCellClass} />
                    {settled && <TableCell className={footCellClass} />}
                  </>
                )}
                <TableCell className={footCellClass} />
                <TableCell className={cn(footCellClass, 'w-8')} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  )
}

function CompanyTableRow({
  row,
  showOrg,
  orgSlug,
  variant,
  fmtEur,
  fmtMultiple,
  fmtPercent,
}: {
  row: CompanyRow
  showOrg: boolean
  orgSlug?: string
  variant: 'pending' | 'active' | 'settled'
  fmtEur: (c?: number | null) => string
  fmtMultiple: (ratio: number | null) => string
  fmtPercent: (ratio: number | null) => string
}) {
  const { t } = useTranslation('participations')
  const navigate = useNavigate()
  // Whole-row click opens the entity sheet (its deals are listed there).
  // Guarded by `slug`: the per-org view passes orgSlug, the aggregated view
  // reads it from the row's org; without a slug the row isn't clickable.
  const slug = orgSlug ?? row.org?.slug
  const openDetail = slug
    ? () =>
        navigate({
          to: '/app/$orgSlug/participations/$companyId',
          params: { orgSlug: slug, companyId: row.companyId },
        })
    : undefined
  return (
    <TableRow
      // `group` on EVERY row: the frozen cell's hover tint is driven by
      // group-hover (see stickyCellClass), clickable or not.
      className={cn('group', openDetail && 'cursor-pointer')}
      onClick={openDetail}
      // Keyboard path (the row replaces the old "Open details" link): focusable
      // and Enter-activated only when there's a destination.
      tabIndex={openDetail ? 0 : undefined}
      role={openDetail ? 'link' : undefined}
      aria-label={openDetail ? t('rowOpenAria', { name: row.name }) : undefined}
      onKeyDown={
        openDetail
          ? (e) => {
              if (e.key === 'Enter') openDetail()
            }
          : undefined
      }
    >
      <TableCell className={cn('font-medium', stickyCellClass)}>
        <span className="flex items-center gap-3">
          <CompanyLogo
            domain={row.domain}
            companyName={row.name}
            size="md"
            className="size-9"
          />
          {row.name}
        </span>
      </TableCell>
      {showOrg && (
        <TableCell>
          {row.org ? <Badge variant="outline">{row.org.name}</Badge> : '—'}
        </TableCell>
      )}
      <TableCell>
        {row.aiScore != null ? (
          <ScoreRing score={row.aiScore} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {t('dealsCount', { count: row.dealCount })}
      </TableCell>
      {variant === 'pending' ? (
        <TableCell className="text-right tabular-nums">
          {fmtEur(row.committed)}
        </TableCell>
      ) : (
        <>
          <TableCell className="text-right tabular-nums">
            {fmtEur(row.invested)}
          </TableCell>
          <TableCell
            className={`text-right tabular-nums${
              isNeutralAmount(row.received) ? ' text-muted-foreground' : ''
            }`}
          >
            {fmtEur(row.received)}
          </TableCell>
        </>
      )}
      {variant === 'active' && (
        <TableCell
          className={`text-right tabular-nums${
            isNeutralTvpi(row.tvpi) ? ' text-muted-foreground' : ''
          }`}
        >
          {fmtMultiple(row.tvpi)}
        </TableCell>
      )}
      {variant === 'settled' && (
        <>
          <TableCell className="text-right tabular-nums">
            {fmtMultiple(row.moic)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {fmtPercent(row.tri)}
          </TableCell>
        </>
      )}
      <TableCell>
        {row.sector ? (
          <Badge variant="outline">
            {t(`sectors.${row.sector}`, { defaultValue: row.sector })}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-8 text-right">
        {openDetail && (
          <ArrowRight
            aria-hidden
            className="text-muted-foreground inline size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </TableCell>
    </TableRow>
  )
}
