import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  annualizedTri,
  moic as moicRatio,
  proceedsFromReceived,
  residualValueCents,
  tvpi as tvpiRatio,
} from '../../../convex/lib/metrics'
import type { ReactNode } from 'react'

import type { Doc } from '../../../convex/_generated/dataModel'
import type { MoicTransaction } from '~/lib/dealMetrics'
import { CompanyLogo } from '~/components/CompanyLogo'
import { ExitBadge } from '~/components/deals/ExitBadge'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'

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

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  )
}

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
  return { fmtEur, fmtEurCompact, fmtDate, fmtMultiple, fmtPercent }
}

/**
 * Display title of a deal: `custom name · instrument` if a name exists,
 * otherwise the (i18n) label of the instrument alone.
 * `withInstrument: false` shows only the name (e.g. the deal detail page,
 * where the instrument already sits in the info grid).
 */
export function useDealTitle() {
  const { t } = useTranslation('participations')
  return (
    deal: { name?: string | null; instrumentKind: string },
    opts?: { withInstrument?: boolean },
  ) => {
    const instrument = t(`instrument.${deal.instrumentKind}`, {
      defaultValue: deal.instrumentKind,
    })
    if (!deal.name) return instrument
    return opts?.withInstrument === false
      ? deal.name
      : `${deal.name} · ${instrument}`
  }
}

/**
 * Detailed list of deals (one block per deal). Used by the participation
 * detail page (entity sheet) to list an entity's deals.
 */
export function DealsList({
  deals,
  orgSlug,
}: {
  deals: Array<DealRow>
  orgSlug?: string
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate, fmtMultiple } = useFormatters()
  const cellClass =
    'grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-3 text-sm sm:grid-cols-5'
  return (
    <div className="divide-y">
      {deals.map((dl) => {
        const tvpi = tvpiRatio({
          capital: dl.paidActual ?? 0,
          proceeds: dl.received ?? 0,
          residual: residualCents(dl),
        })
        const body = (
          <>
            <Field label={t('deal.name')}>{dl.name ?? '—'}</Field>
            <Field label={t('deal.instrument')}>
              {t(`instrument.${dl.instrumentKind}`, {
                defaultValue: dl.instrumentKind,
              })}
            </Field>
            <Field label={t('deal.investor')}>
              {dl.investor?.name ?? '—'}
              {dl.spv ? (
                <span className="text-muted-foreground">
                  {' '}
                  · {t('deal.viaSpv')} {dl.spv.name}
                </span>
              ) : null}
            </Field>
            <Field label={t('deal.committed')}>
              {fmtEur(dl.committedAmount)}
            </Field>
            <Field label={t('deal.paid')}>{fmtEur(dl.paidActual ?? 0)}</Field>
            <Field label={t('deal.received')}>{fmtEur(dl.received ?? 0)}</Field>
            <Field label={t('deal.tvpi')}>{fmtMultiple(tvpi)}</Field>
            <Field label={t('deal.status')}>
              <Badge variant={statusVariant(dl.status)}>
                {t(`status.${dl.status}`, { defaultValue: dl.status })}
              </Badge>
            </Field>
            <Field label={t('deal.signed')}>{fmtDate(dl.signedDate)}</Field>
          </>
        )
        return orgSlug ? (
          <Link
            key={dl._id}
            to="/app/$orgSlug/deals/$dealId"
            params={{ orgSlug, dealId: dl._id }}
            className={`${cellClass} hover:bg-accent/60 transition-colors`}
          >
            {body}
          </Link>
        ) : (
          <div key={dl._id} className={cellClass}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Participations table grouped BY COMPANY (one row = one company; clicking a
 * row opens its detail sheet, where the deals are listed). `showOrg` adds an
 * org badge column (cross-org aggregated view). `orgSlug` (per-org view)
 * targets the detail link; in the aggregated view the slug is derived from
 * each deal's org.
 *
 * The search + facet filters live in the parent `ParticipationsView`, which
 * feeds each instance an already-filtered `deals` set (the active table and the
 * settled section share one toolbar).
 */
type SortKey = 'name' | 'deals' | 'paid' | 'received' | 'tvpi'

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
  deals,
  showOrg = false,
  orgSlug,
  settled = false,
  isFiltered = false,
  resetKey = '',
}: {
  // Already filtered by the parent toolbar (search + facets).
  deals: Array<DealRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  // Settled variant (fully_exited / written_off): swaps TVPI for a MOIC + an
  // annualized TRI column, adds an ExitBadge per row and drops sorting. Used by
  // the always-open section below the active table.
  settled?: boolean
  // True when the parent search/filters are active — drives the empty message
  // (no results vs. empty scope).
  isFiltered?: boolean
  // Snaps pagination back to page 1 when the upstream search/filters change.
  resetKey?: string
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtMultiple, fmtPercent } = useFormatters()

  const groups = useMemo(() => {
    if (!deals) return undefined
    const map = new Map<
      string,
      {
        name: string
        domain: string | undefined
        orgs: Set<string>
        slug: string | undefined
        deals: Array<DealRow>
        // Company entry date: earliest signed deal (null if none dated).
        signedDate: number | null
        // Company exit date: latest exited deal (null if none dated) — TRI basis.
        exitedDate: number | null
        paid: number
        received: number
        residual: number
        // Settled-only MOIC inputs (capital deployed, proceeds net of VAT).
        capital: number
        proceeds: number
        // Group exit outcome for the badge: a write-off anywhere wins.
        writtenOff: boolean
      }
    >()
    for (const d of deals) {
      const key = d.target?._id ?? d.targetCompanyId
      const g = map.get(key) ?? {
        name: d.target?.name ?? '—',
        domain: d.target?.domain ?? undefined,
        orgs: new Set<string>(),
        slug: orgSlug ?? d.org?.slug,
        deals: [],
        signedDate: null,
        exitedDate: null,
        paid: 0,
        received: 0,
        residual: 0,
        capital: 0,
        proceeds: 0,
        writtenOff: false,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      if (d.signedDate != null) {
        g.signedDate =
          g.signedDate == null
            ? d.signedDate
            : Math.min(g.signedDate, d.signedDate)
      }
      if (d.exitedDate != null) {
        g.exitedDate =
          g.exitedDate == null
            ? d.exitedDate
            : Math.max(g.exitedDate, d.exitedDate)
      }
      g.paid += d.paidActual ?? 0
      g.received += d.received ?? 0
      g.residual += residualCents(d)
      // MOIC capital/proceeds, accumulated per-deal so each deal's own VAT
      // convention applies (royalty proceeds are net of VAT — mirrors
      // dealMoic in ~/lib/dealMetrics). De-VATing only ever lowers the
      // multiple, so a mixed group is never overvalued (no false Exit win).
      g.capital += d.paidActual ?? 0
      g.proceeds += proceedsFromReceived(d.received ?? 0, d.instrumentKind)
      if (d.status === 'written_off') g.writtenOff = true
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => {
      const moic = moicRatio({ capital: g.capital, proceeds: g.proceeds })
      // Annualized TRI on the SAME aggregate as the MOIC: the two-point IRR of
      // {−capital at entry, +proceeds at exit}, i.e. MOIC^(1/years) − 1.
      const tri = annualizedTri({
        moic,
        entryDate: g.signedDate,
        exitDate: g.exitedDate,
      })
      return {
        id,
        ...g,
        // TVPI keeps the GROSS received (not de-VAT'd), unlike the MOIC.
        tvpi: tvpiRatio({
          capital: g.paid,
          proceeds: g.received,
          residual: g.residual,
        }),
        moic,
        tri,
      }
    })
  }, [deals, orgSlug])

  // Column sort (client-side, low volumes). null = server order
  // (signedDate desc). Missing TVPIs go to the end of the list.
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
  const sortedGroups = useMemo(() => {
    if (!groups || !sort) return groups
    const value = (g: NonNullable<typeof groups>[number]) =>
      sort.key === 'name'
        ? g.name
        : sort.key === 'tvpi'
          ? (g.tvpi ?? Number.NEGATIVE_INFINITY)
          : sort.key === 'deals'
            ? g.deals.length
            : g[sort.key]
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...groups].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (typeof va === 'string' && typeof vb === 'string') {
        return sign * va.localeCompare(vb)
      }
      return sign * (Number(va) - Number(vb))
    })
  }, [groups, sort])

  // Local pagination (by company, after sort); snaps back to page 1 whenever
  // the upstream search/filters (resetKey) or the sort changes.
  const { page, pageCount, setPage } = usePagination(
    sortedGroups?.length ?? 0,
    `${resetKey}:${sort ? `${sort.key}:${sort.dir}` : ''}`,
  )
  const pagedGroups = sortedGroups?.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  // Base 5 (company, deals, paid, received, chevron) + the optional
  // org column, plus TVPI (active) or MOIC + TRI (settled).
  const colSpan = 5 + (showOrg ? 1 : 0) + (settled ? 2 : 1)

  if (groups && groups.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {isFiltered ? t('search.noResults') : t('empty')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t('col.company')}
                active={sort?.key === 'name'}
                dir={sort?.dir ?? 'asc'}
                onClick={() => toggleSort('name')}
                sortable={!settled}
              />
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <SortableHead
                label={t('col.deals')}
                active={sort?.key === 'deals'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('deals')}
                className="text-right"
                sortable={!settled}
              />
              <SortableHead
                label={t('col.paid')}
                active={sort?.key === 'paid'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('paid')}
                className="text-right"
                sortable={!settled}
              />
              <SortableHead
                label={t('col.received')}
                active={sort?.key === 'received'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('received')}
                className="text-right"
                sortable={!settled}
              />
              {!settled && (
                <SortableHead
                  label={t('col.tvpi')}
                  active={sort?.key === 'tvpi'}
                  dir={sort?.dir ?? 'desc'}
                  onClick={() => toggleSort('tvpi')}
                  className="text-right"
                  sortable={!settled}
                />
              )}
              {settled && (
                <>
                  <TableHead className="text-right">{t('col.moic')}</TableHead>
                  <TableHead className="text-right">{t('col.tri')}</TableHead>
                </>
              )}
              {/* Trailing column for the per-row hover chevron. */}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pagedGroups ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              pagedGroups.map((g) => (
                <CompanyRows
                  key={g.id}
                  group={g}
                  showOrg={showOrg}
                  settled={settled}
                  fmtEur={fmtEur}
                  fmtMultiple={fmtMultiple}
                  fmtPercent={fmtPercent}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </div>
  )
}

function CompanyRows({
  group,
  showOrg,
  settled,
  fmtEur,
  fmtMultiple,
  fmtPercent,
}: {
  group: {
    id: string
    name: string
    domain: string | undefined
    orgs: Set<string>
    slug: string | undefined
    deals: Array<DealRow>
    paid: number
    received: number
    tvpi: number | null
    moic: number | null
    tri: number | null
    capital: number
    proceeds: number
    writtenOff: boolean
  }
  showOrg: boolean
  settled: boolean
  fmtEur: (c?: number | null) => string
  fmtMultiple: (ratio: number | null) => string
  fmtPercent: (ratio: number | null) => string
}) {
  const { t } = useTranslation('participations')
  const navigate = useNavigate()
  // Settled rows carry a win/lost badge + a MOIC column. The badge reuses
  // ExitBadge, which only reads `status` + `instrumentKind`: feed it a
  // synthetic deal whose proceeds are already net of VAT (a non-royalty
  // instrument so dealMoic doesn't de-VAT a second time) and the group's
  // aggregated capital/proceeds. A write-off anywhere in the group forces
  // "lost".
  const exitDeal = {
    status: group.writtenOff ? 'written_off' : 'fully_exited',
    instrumentKind: 'share',
  } as unknown as Doc<'deals'>
  const exitTxs: Array<MoicTransaction> = [
    { direction: 'out', amount: group.capital },
    { direction: 'in', amount: group.proceeds },
  ]
  // Whole-row click opens the entity sheet (its deals are listed there).
  // Guarded by `slug`: the per-org view passes orgSlug, the aggregated view
  // derives it from each deal's org; without a slug the row isn't clickable
  // (mirrors the "Open details" button's own render guard).
  const slug = group.slug
  const openDetail = slug
    ? () =>
        navigate({
          to: '/app/$orgSlug/participations/$companyId',
          params: { orgSlug: slug, companyId: group.id },
        })
    : undefined
  return (
    <TableRow
      className={openDetail ? 'group cursor-pointer' : undefined}
      onClick={openDetail}
      // Keyboard path (the row replaces the old "Open details" link): focusable
      // and Enter-activated only when there's a destination.
      tabIndex={openDetail ? 0 : undefined}
      role={openDetail ? 'link' : undefined}
      aria-label={
        openDetail ? t('rowOpenAria', { name: group.name }) : undefined
      }
      onKeyDown={
        openDetail
          ? (e) => {
              if (e.key === 'Enter') openDetail()
            }
          : undefined
      }
    >
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          <CompanyLogo
            domain={group.domain}
            companyName={group.name}
            size="sm"
          />
          {group.name}
          {settled && <ExitBadge deal={exitDeal} transactions={exitTxs} />}
        </span>
      </TableCell>
      {showOrg && (
        <TableCell>
          <span className="flex flex-wrap gap-1">
            {Array.from(group.orgs).map((o) => (
              <Badge key={o} variant="outline">
                {o}
              </Badge>
            ))}
          </span>
        </TableCell>
      )}
      <TableCell className="text-right tabular-nums">
        {t('dealsCount', { count: group.deals.length })}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtEur(group.paid)}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums${
          isNeutralAmount(group.received) ? ' text-muted-foreground' : ''
        }`}
      >
        {fmtEur(group.received)}
      </TableCell>
      {!settled && (
        <TableCell
          className={`text-right tabular-nums${
            isNeutralTvpi(group.tvpi) ? ' text-muted-foreground' : ''
          }`}
        >
          {fmtMultiple(group.tvpi)}
        </TableCell>
      )}
      {settled && (
        <>
          <TableCell className="text-right tabular-nums">
            {fmtMultiple(group.moic)}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {fmtPercent(group.tri)}
          </TableCell>
        </>
      )}
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
