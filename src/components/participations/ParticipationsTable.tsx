import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Download,
  ListFilter,
  X,
} from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ReactNode, RefObject } from 'react'

import { CompanyLogo } from '~/components/CompanyLogo'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Separator } from '~/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
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
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { downloadCsv, toCsv } from '~/lib/csv'
import { normalizeSearch } from '~/lib/searchText'

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
  org?: { name: string; slug: string } | null // present in aggregated view
}

/**
 * Residual value of a deal for the TVPI: 0 if exited/written off,
 * otherwise the last known valuation, falling back to cost (dashboard
 * convention — convex/dashboard.ts NAV).
 */
function residualCents(deal: DealRow): number {
  if (deal.status === 'fully_exited' || deal.status === 'written_off') return 0
  return deal.lastValuationCents ?? deal.paidActual ?? 0
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

/** Localized €/date/multiple formatters, shared by the components below. */
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
  return { fmtEur, fmtEurCompact, fmtDate, fmtMultiple }
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
        const paid = dl.paidActual ?? 0
        const tvpi =
          paid > 0 ? ((dl.received ?? 0) + residualCents(dl)) / paid : null
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
 */
type SortKey = 'name' | 'invested' | 'deals' | 'paid' | 'received' | 'tvpi'

/** A multi-select facet option: stored raw value + its localized label. */
type FacetOption = { value: string; label: string }

/**
 * Dashed-border dropdown holding the checkbox options of one facet
 * (instrument / status / sector). The menu stays open across clicks so
 * several values can be toggled in a row; the trigger shows a count badge
 * once anything is selected.
 */
function FacetFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: Array<FacetOption>
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <ListFilter className="size-4" />
          {label}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal tabular-nums"
              >
                {selected.size}
              </Badge>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-auto">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.has(opt.value)}
            // Keep the menu open so multiple values can be toggled at once.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(opt.value)}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Clickable header of a sortable column (asc ⇄ desc). */
function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  className?: string
}) {
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
  exportRef,
}: {
  deals: Array<DealRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  // When provided, the toolbar export button is hidden and the export handler
  // is exposed here so a parent (e.g. the header menu) can trigger it — the
  // current search/sort filter still applies.
  exportRef?: RefObject<(() => void) | null>
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate, fmtMultiple } = useFormatters()

  // Client-side search (low volumes): company name, custom deal name,
  // instrument (raw key + translated label), investor, sector —
  // case/accent insensitive.
  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

  // Faceted filters (multi-select), applied at the deal level alongside the
  // search, before grouping by company. A company shows up if it keeps at
  // least one deal; its aggregates reflect only the surviving deals.
  const [instrumentFilter, setInstrumentFilter] = useState<Set<string>>(
    new Set(),
  )
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [sectorFilter, setSectorFilter] = useState<Set<string>>(new Set())
  const toggle =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (value: string) =>
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(value)) next.delete(value)
        else next.add(value)
        return next
      })
  const hasFilters =
    instrumentFilter.size > 0 || statusFilter.size > 0 || sectorFilter.size > 0
  const resetFilters = () => {
    setInstrumentFilter(new Set())
    setStatusFilter(new Set())
    setSectorFilter(new Set())
  }

  // Facet options derived from the full deal set (not the filtered one, so
  // options never vanish mid-selection), localized and sorted by label.
  const facets = useMemo(() => {
    const instruments = new Map<string, string>()
    const statuses = new Map<string, string>()
    const sectors = new Map<string, string>()
    for (const d of deals ?? []) {
      instruments.set(
        d.instrumentKind,
        t(`instrument.${d.instrumentKind}`, { defaultValue: d.instrumentKind }),
      )
      statuses.set(
        d.status,
        t(`status.${d.status}`, { defaultValue: d.status }),
      )
      if (d.target?.sector) {
        sectors.set(
          d.target.sector,
          t(`sectors.${d.target.sector}`, { defaultValue: d.target.sector }),
        )
      }
    }
    const toOptions = (m: Map<string, string>): Array<FacetOption> =>
      Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) =>
        a.label.localeCompare(b.label),
      )
    return {
      instruments: toOptions(instruments),
      statuses: toOptions(statuses),
      sectors: toOptions(sectors),
    }
  }, [deals, t])

  const filtered = useMemo(() => {
    if (!deals) return deals
    if (!term && !hasFilters) return deals
    return deals.filter((d) => {
      const matchesSearch =
        !term ||
        [
          d.target?.name,
          d.name,
          d.target?.sector,
          d.target?.sector &&
            t(`sectors.${d.target.sector}`, {
              defaultValue: d.target.sector,
            }),
          d.investor?.name,
          d.instrumentKind,
          t(`instrument.${d.instrumentKind}`, {
            defaultValue: d.instrumentKind,
          }),
        ].some((s) => s && normalizeSearch(s).includes(term))
      if (!matchesSearch) return false
      if (instrumentFilter.size > 0 && !instrumentFilter.has(d.instrumentKind))
        return false
      if (statusFilter.size > 0 && !statusFilter.has(d.status)) return false
      if (
        sectorFilter.size > 0 &&
        !(d.target?.sector != null && sectorFilter.has(d.target.sector))
      )
        return false
      return true
    })
  }, [deals, term, t, instrumentFilter, statusFilter, sectorFilter, hasFilters])

  const groups = useMemo(() => {
    if (!filtered) return undefined
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
        paid: number
        received: number
        residual: number
      }
    >()
    for (const d of filtered) {
      const key = d.target?._id ?? d.targetCompanyId
      const g = map.get(key) ?? {
        name: d.target?.name ?? '—',
        domain: d.target?.domain ?? undefined,
        orgs: new Set<string>(),
        slug: orgSlug ?? d.org?.slug,
        deals: [],
        signedDate: null,
        paid: 0,
        received: 0,
        residual: 0,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      if (d.signedDate != null) {
        g.signedDate =
          g.signedDate == null
            ? d.signedDate
            : Math.min(g.signedDate, d.signedDate)
      }
      g.paid += d.paidActual ?? 0
      g.received += d.received ?? 0
      g.residual += residualCents(d)
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({
      id,
      ...g,
      tvpi: g.paid > 0 ? (g.received + g.residual) / g.paid : null,
    }))
  }, [filtered, orgSlug])

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
          : sort.key === 'invested'
            ? (g.signedDate ?? Number.NEGATIVE_INFINITY)
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

  // Local pagination (by company, after filter + sort); snaps back to page 1
  // whenever the search or sort changes.
  // Reset to page 1 whenever search, sort or any filter changes.
  const filterKey = [
    [...instrumentFilter].sort().join(','),
    [...statusFilter].sort().join(','),
    [...sectorFilter].sort().join(','),
  ].join('|')
  const { page, pageCount, setPage } = usePagination(
    sortedGroups?.length ?? 0,
    `${term}:${sort ? `${sort.key}:${sort.dir}` : ''}:${filterKey}`,
  )
  const pagedGroups = sortedGroups?.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  // CSV export of the filtered deals (flat, one deal per row).
  function handleExport() {
    if (!filtered) return
    const headers = [
      t('col.company'),
      t('export.col.deal'),
      t('deal.instrument'),
      t('deal.investor'),
      t('deal.status'),
      t('col.committed'),
      t('col.paid'),
      t('col.received'),
      t('export.col.lastValuation'),
      t('col.tvpi'),
      t('deal.signed'),
    ]
    const euros = (cents?: number | null) =>
      cents == null ? null : (cents / 100).toFixed(2)
    const rows = filtered.map((d) => {
      const paid = d.paidActual ?? 0
      const tvpi =
        paid > 0 ? ((d.received ?? 0) + residualCents(d)) / paid : null
      return [
        d.target?.name ?? '',
        d.name ?? '',
        t(`instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
        d.investor?.name ?? '',
        t(`status.${d.status}`, { defaultValue: d.status }),
        euros(d.committedAmount),
        euros(d.paidActual ?? 0),
        euros(d.received ?? 0),
        euros(d.lastValuationCents),
        tvpi == null ? null : tvpi.toFixed(2),
        d.signedDate ? new Date(d.signedDate).toISOString().slice(0, 10) : null,
      ]
    })
    const day = new Date().toISOString().slice(0, 10)
    downloadCsv(`participations-${day}.csv`, toCsv(headers, rows))
  }

  // Expose the export handler to a parent (header menu) when asked. No deps:
  // refresh every render so the ref always points at the latest closure
  // (which reads the current `filtered` set).
  useEffect(() => {
    if (exportRef) exportRef.current = handleExport
  })

  // +1 for the trailing hover-chevron column (header cell is empty).
  const colSpan = showOrg ? 8 : 7

  // Search bar shown as soon as there are deals — including when the
  // current search matches nothing (otherwise it can't be cleared).
  // A facet is only worth showing when it can actually partition the data
  // (≥2 distinct values) — a single-value facet would match every row.
  const searchBar = deals && deals.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('search.placeholder')}
        className="max-w-xs"
      />
      {facets.instruments.length >= 2 && (
        <FacetFilter
          label={t('filters.instrument')}
          options={facets.instruments}
          selected={instrumentFilter}
          onToggle={toggle(setInstrumentFilter)}
        />
      )}
      {facets.statuses.length >= 2 && (
        <FacetFilter
          label={t('filters.status')}
          options={facets.statuses}
          selected={statusFilter}
          onToggle={toggle(setStatusFilter)}
        />
      )}
      {facets.sectors.length >= 2 && (
        <FacetFilter
          label={t('filters.sector')}
          options={facets.sectors}
          selected={sectorFilter}
          onToggle={toggle(setSectorFilter)}
        />
      )}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={resetFilters}
          className="text-muted-foreground"
        >
          {t('filters.reset')}
          <X className="size-4" />
        </Button>
      )}
      {!exportRef && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          className="ml-auto"
        >
          <Download className="size-4" />
          {t('export.button')}
        </Button>
      )}
    </div>
  )

  if (groups && groups.length === 0) {
    return (
      <div className="space-y-3">
        {searchBar}
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {term || hasFilters ? t('search.noResults') : t('empty')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {searchBar}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t('col.company')}
                active={sort?.key === 'name'}
                dir={sort?.dir ?? 'asc'}
                onClick={() => toggleSort('name')}
              />
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <SortableHead
                label={t('col.invested')}
                active={sort?.key === 'invested'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('invested')}
              />
              <SortableHead
                label={t('col.deals')}
                active={sort?.key === 'deals'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('deals')}
                className="text-right"
              />
              <SortableHead
                label={t('col.paid')}
                active={sort?.key === 'paid'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('paid')}
                className="text-right"
              />
              <SortableHead
                label={t('col.received')}
                active={sort?.key === 'received'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('received')}
                className="text-right"
              />
              <SortableHead
                label={t('col.tvpi')}
                active={sort?.key === 'tvpi'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('tvpi')}
                className="text-right"
              />
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
                  fmtEur={fmtEur}
                  fmtDate={fmtDate}
                  fmtMultiple={fmtMultiple}
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
  fmtEur,
  fmtDate,
  fmtMultiple,
}: {
  group: {
    id: string
    name: string
    domain: string | undefined
    orgs: Set<string>
    slug: string | undefined
    deals: Array<DealRow>
    signedDate: number | null
    paid: number
    received: number
    tvpi: number | null
  }
  showOrg: boolean
  fmtEur: (c?: number | null) => string
  fmtDate: (ms?: number | null) => string
  fmtMultiple: (ratio: number | null) => string
}) {
  const { t } = useTranslation('participations')
  const navigate = useNavigate()
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
      <TableCell className="tabular-nums">
        {fmtDate(group.signedDate)}
      </TableCell>
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
      <TableCell
        className={`text-right tabular-nums${
          isNeutralTvpi(group.tvpi) ? ' text-muted-foreground' : ''
        }`}
      >
        {fmtMultiple(group.tvpi)}
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
