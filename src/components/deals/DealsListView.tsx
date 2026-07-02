import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Download, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { tvpi as tvpiRatio } from '../../../convex/lib/metrics'
import type { RefObject } from 'react'

import type { DealRow } from '~/components/participations/ParticipationsTable'
import type { FacetOption } from '~/components/participations/FacetFilter'
import {
  SortableHead,
  residualCents,
  useFormatters,
} from '~/components/participations/ParticipationsTable'
import { FacetFilter } from '~/components/participations/FacetFilter'
import { CompanyLogo } from '~/components/CompanyLogo'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
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
import { cn } from '~/lib/utils'

/**
 * `roundType` (the equity-round enum) rides along on the query result — the
 * server `enrich()` spreads `...deal` in both `deals.list` and
 * `aggregate.listDeals` — but it isn't declared on the shared `DealRow`.
 * Surface it here for the read-only Stage column (reuses the existing field:
 * no schema change, no backfill; "—" for non-equity instruments).
 */
type DealListRow = DealRow & { roundType?: string | null }

/**
 * Frozen first column (company) for the horizontal scroll. Same pattern as
 * ParticipationsTable: an OPAQUE background so the cells sliding underneath
 * don't show through, plus a color-mix hover so the translucent row tint stays
 * visible under the sticky cell (it can't inherit `hover:bg-muted/50`, which
 * would composite over the scrolled columns instead of the page background).
 * See KNOWN_ISSUES.md § "Colonne figée". Requires `group` on every row.
 */
const stickyHeadClass = 'sticky left-0 z-10 bg-background'
const stickyCellClass =
  'sticky left-0 z-10 bg-background transition-colors ' +
  'group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]'

/** TVPI of a single deal: (received + residual) / paid, null when nothing paid. */
function dealTvpi(d: DealRow): number | null {
  return tvpiRatio({
    capital: d.paidActual ?? 0,
    proceeds: d.received ?? 0,
    residual: residualCents(d),
  })
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

type SortKey = 'company' | 'paid' | 'received' | 'tvpi' | 'signed'

/**
 * Flat, deal-centric list: ONE row per deal (unlike the grouped
 * ParticipationsTable, which folds a company's deals into a single row).
 *
 * Orchestrates the shared toolbar (search + facets), the split into active vs.
 * settled (fully_exited / written_off) — same model as the Companies view — and
 * the CSV export. The company column is frozen on horizontal scroll; the Status
 * badge is dropped from the active table and reappears only in the settled one.
 *
 * `orgSlug` targets the detail links (per-org view); the aggregated view omits
 * it and derives the slug from each deal's own org, and sets `showOrg` to add an
 * org column. Search + facet filters run in memory (low volumes).
 */
export function DealsListView({
  deals,
  orgSlug,
  showOrg = false,
  exportRef,
}: {
  deals: Array<DealListRow> | undefined
  orgSlug?: string
  showOrg?: boolean
  exportRef?: RefObject<(() => void) | null>
}) {
  const { t } = useTranslation(['deals', 'participations'])

  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

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

  // Facet options derived from the full deal set (options never vanish
  // mid-selection), localized and sorted by label.
  const facets = useMemo(() => {
    const instruments = new Map<string, string>()
    const statuses = new Map<string, string>()
    const sectors = new Map<string, string>()
    for (const d of deals ?? []) {
      instruments.set(
        d.instrumentKind,
        t(`participations:instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
      )
      statuses.set(
        d.status,
        t(`participations:status.${d.status}`, { defaultValue: d.status }),
      )
      if (d.target?.sector) {
        sectors.set(
          d.target.sector,
          t(`participations:sectors.${d.target.sector}`, {
            defaultValue: d.target.sector,
          }),
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
            t(`participations:sectors.${d.target.sector}`, {
              defaultValue: d.target.sector,
            }),
          d.investor?.name,
          d.spv?.name,
          d.instrumentKind,
          t(`participations:instrument.${d.instrumentKind}`, {
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

  // Split on status: fully_exited / written_off drop to the settled section
  // below; everything else (including partially_exited) stays active. Same rule
  // as the Companies view (ParticipationsView).
  const { active, settled } = useMemo(() => {
    if (!filtered) return { active: undefined, settled: undefined }
    const activeDeals: Array<DealListRow> = []
    const settledDeals: Array<DealListRow> = []
    for (const d of filtered) {
      if (d.status === 'fully_exited' || d.status === 'written_off') {
        settledDeals.push(d)
      } else {
        activeDeals.push(d)
      }
    }
    return { active: activeDeals, settled: settledDeals }
  }, [filtered])

  // CSV export — flat, one deal per row, covering the full unsplit set
  // (independent of the current search / filters).
  function handleExport() {
    if (!deals) return
    const headers = [
      t('participations:col.company'),
      t('participations:export.col.deal'),
      t('participations:deal.instrument'),
      t('participations:deal.investor'),
      t('participations:deal.status'),
      t('participations:col.committed'),
      t('participations:col.paid'),
      t('participations:col.received'),
      t('participations:col.tvpi'),
      t('participations:deal.signed'),
    ]
    const euros = (cents?: number | null) =>
      cents == null ? null : (cents / 100).toFixed(2)
    const rows = deals.map((d) => {
      const tvpi = dealTvpi(d)
      return [
        d.target?.name ?? '',
        d.name ?? '',
        t(`participations:instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
        d.investor?.name ?? '',
        t(`participations:status.${d.status}`, { defaultValue: d.status }),
        euros(d.committedAmount),
        euros(d.paidActual ?? 0),
        euros(d.received ?? 0),
        tvpi == null ? null : tvpi.toFixed(2),
        d.signedDate ? new Date(d.signedDate).toISOString().slice(0, 10) : null,
      ]
    })
    const day = new Date().toISOString().slice(0, 10)
    downloadCsv(`deals-${day}.csv`, toCsv(headers, rows))
  }

  // Expose the export handler to a parent (header menu). No deps: refresh every
  // render so the ref always points at the latest closure.
  useEffect(() => {
    if (exportRef) exportRef.current = handleExport
  })

  const isFiltered = Boolean(term) || hasFilters
  // Pagination reset key shared by both tables: reset to page 1 on any
  // search / filter change.
  const filterKey = [
    term,
    [...instrumentFilter].sort().join(','),
    [...statusFilter].sort().join(','),
    [...sectorFilter].sort().join(','),
  ].join('|')

  const showToolbar = deals && deals.length > 0

  return (
    <div className="space-y-6">
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('deals:search.placeholder')}
            className="max-w-xs"
          />
          {facets.instruments.length >= 2 && (
            <FacetFilter
              label={t('participations:filters.instrument')}
              options={facets.instruments}
              selected={instrumentFilter}
              onToggle={toggle(setInstrumentFilter)}
            />
          )}
          {facets.statuses.length >= 2 && (
            <FacetFilter
              label={t('participations:filters.status')}
              options={facets.statuses}
              selected={statusFilter}
              onToggle={toggle(setStatusFilter)}
            />
          )}
          {facets.sectors.length >= 2 && (
            <FacetFilter
              label={t('participations:filters.sector')}
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
              {t('participations:filters.reset')}
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
              {t('participations:export.button')}
            </Button>
          )}
        </div>
      )}

      <DealsTable
        deals={active}
        orgSlug={orgSlug}
        showOrg={showOrg}
        isFiltered={isFiltered}
        resetKey={filterKey}
      />

      {settled && settled.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-sm font-medium">
            {t('deals:settled.sectionTitle', { count: settled.length })}
          </h3>
          <DealsTable
            deals={settled}
            orgSlug={orgSlug}
            showOrg={showOrg}
            settled
            isFiltered={isFiltered}
            resetKey={filterKey}
          />
        </section>
      )}
    </div>
  )
}

/**
 * One deals table (active or settled). Owns its own column sort + pagination;
 * the parent feeds it an already-filtered, already-split deal set. The `settled`
 * variant re-adds the Status column and drops sorting (mirrors the settled
 * Companies table).
 */
function DealsTable({
  deals,
  orgSlug,
  showOrg = false,
  settled = false,
  isFiltered = false,
  resetKey = '',
}: {
  deals: Array<DealListRow> | undefined
  orgSlug?: string
  showOrg?: boolean
  settled?: boolean
  isFiltered?: boolean
  resetKey?: string
}) {
  const { t } = useTranslation(['participations', 'deals'])
  const { fmtEur, fmtDate, fmtMultiple } = useFormatters()

  // Column sort (client-side, low volumes). null = server order (signedDate
  // desc). Missing numeric values sort last. Disabled on the settled table.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(
    null,
  )
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'company' ? 'asc' : 'desc' },
    )
  const sorted = useMemo(() => {
    if (!deals || !sort) return deals
    const value = (d: DealListRow): string | number =>
      sort.key === 'company'
        ? (d.target?.name ?? '')
        : sort.key === 'paid'
          ? (d.paidActual ?? Number.NEGATIVE_INFINITY)
          : sort.key === 'received'
            ? (d.received ?? Number.NEGATIVE_INFINITY)
            : sort.key === 'tvpi'
              ? (dealTvpi(d) ?? Number.NEGATIVE_INFINITY)
              : (d.signedDate ?? Number.NEGATIVE_INFINITY)
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...deals].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (typeof va === 'string' && typeof vb === 'string') {
        return sign * va.localeCompare(vb)
      }
      return sign * (Number(va) - Number(vb))
    })
  }, [deals, sort])

  const { page, pageCount, setPage } = usePagination(
    sorted?.length ?? 0,
    `${resetKey}:${sort ? `${sort.key}:${sort.dir}` : ''}`,
  )
  const paged = sorted?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Company + sector + instrument + stage + investedOn + invested + received +
  // tvpi + chevron (9), plus the optional org column and the settled-only
  // status column.
  const colSpan = 9 + (showOrg ? 1 : 0) + (settled ? 1 : 0)

  if (deals && deals.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {isFiltered ? t('deals:search.noResults') : t('deals:empty')}
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
                active={sort?.key === 'company'}
                dir={sort?.dir ?? 'asc'}
                onClick={() => toggleSort('company')}
                sortable={!settled}
                className={stickyHeadClass}
              />
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <TableHead>{t('col.sector')}</TableHead>
              <TableHead>{t('deal.instrument')}</TableHead>
              <TableHead>{t('col.stage')}</TableHead>
              <SortableHead
                label={t('col.investedOn')}
                active={sort?.key === 'signed'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('signed')}
                sortable={!settled}
                className="text-right"
              />
              <SortableHead
                label={t('col.invested')}
                active={sort?.key === 'paid'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('paid')}
                sortable={!settled}
                className="text-right"
              />
              <SortableHead
                label={t('col.received')}
                active={sort?.key === 'received'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('received')}
                sortable={!settled}
                className="text-right"
              />
              <SortableHead
                label={t('col.tvpi')}
                active={sort?.key === 'tvpi'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('tvpi')}
                sortable={!settled}
                className="text-right"
              />
              {settled && <TableHead>{t('deal.status')}</TableHead>}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!paged ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              paged.map((d) => (
                <DealRowCells
                  key={d._id}
                  deal={d}
                  slug={orgSlug ?? d.org?.slug}
                  showOrg={showOrg}
                  settled={settled}
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

function DealRowCells({
  deal,
  slug,
  showOrg,
  settled,
  fmtEur,
  fmtDate,
  fmtMultiple,
}: {
  deal: DealListRow
  slug: string | undefined
  showOrg: boolean
  settled: boolean
  fmtEur: (c?: number | null) => string
  fmtDate: (ms?: number | null) => string
  fmtMultiple: (ratio: number | null) => string
}) {
  const { t } = useTranslation('participations')
  const navigate = useNavigate()
  const tvpi = dealTvpi(deal)
  // Whole-row click opens the deal sheet. Guarded by `slug` (per-org passes
  // orgSlug; aggregated derives it from the deal's org) — without it the row
  // isn't clickable.
  const open = slug
    ? () =>
        navigate({
          to: '/app/$orgSlug/deals/$dealId',
          params: { orgSlug: slug, dealId: deal._id },
        })
    : undefined
  return (
    <TableRow
      // `group` on EVERY row so the frozen cell's hover tint (see
      // stickyCellClass) fires whether or not the row is clickable.
      className={cn('group', open && 'cursor-pointer')}
      onClick={open}
      tabIndex={open ? 0 : undefined}
      role={open ? 'link' : undefined}
      onKeyDown={
        open
          ? (e) => {
              if (e.key === 'Enter') open()
            }
          : undefined
      }
    >
      {/* Company — frozen on horizontal scroll; content unchanged. */}
      <TableCell className={cn('font-medium', stickyCellClass)}>
        <span className="flex items-center gap-2">
          <CompanyLogo
            domain={deal.target?.domain ?? undefined}
            companyName={deal.target?.name ?? '—'}
            size="sm"
          />
          <span className="flex flex-col">
            <span>{deal.target?.name ?? '—'}</span>
            {deal.name && (
              <span className="text-muted-foreground text-xs">{deal.name}</span>
            )}
          </span>
        </span>
      </TableCell>
      {showOrg && (
        <TableCell>
          {deal.org ? <Badge variant="outline">{deal.org.name}</Badge> : null}
        </TableCell>
      )}
      <TableCell>
        {deal.target?.sector
          ? t(`sectors.${deal.target.sector}`, {
              defaultValue: deal.target.sector,
            })
          : '—'}
      </TableCell>
      <TableCell>
        {t(`instrument.${deal.instrumentKind}`, {
          defaultValue: deal.instrumentKind,
        })}
      </TableCell>
      <TableCell>
        {deal.roundType
          ? t(`enum.roundType.${deal.roundType}`, {
              defaultValue: deal.roundType,
            })
          : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtDate(deal.signedDate)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtEur(deal.paidActual ?? 0)}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums${
          (deal.received ?? 0) === 0 ? ' text-muted-foreground' : ''
        }`}
      >
        {fmtEur(deal.received ?? 0)}
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
      {settled && (
        <TableCell>
          <Badge variant={statusVariant(deal.status)}>
            {t(`status.${deal.status}`, { defaultValue: deal.status })}
          </Badge>
        </TableCell>
      )}
      <TableCell className="w-8 text-right">
        {open && (
          <ArrowRight
            aria-hidden
            className="text-muted-foreground inline size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </TableCell>
    </TableRow>
  )
}
