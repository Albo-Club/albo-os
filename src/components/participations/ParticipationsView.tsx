import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { tvpi as tvpiRatio } from '../../../convex/lib/metrics'
import { ParticipationsTable, residualCents } from './ParticipationsTable'
import { FacetFilter } from './FacetFilter'
import type { ReactNode, RefObject } from 'react'

import type { FacetOption } from './FacetFilter'
import type { CompanyRow, DealRow } from './ParticipationsTable'
import {
  dealStatusLabelKey,
  participationBucketBand,
} from '~/lib/dealStatusBadge'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import {
  toggleValue,
  usePersistentFilters,
} from '~/hooks/usePersistentFilters'
import { downloadCsv, toCsv } from '~/lib/csv'
import { normalizeSearch } from '~/lib/searchText'

/**
 * Stacks two participation tables sharing ONE toolbar: the companies with
 * active deals on top and an always-open section for the settled bucket
 * (fully_exited / written_off) below. The split is made server-side
 * (`CompanyRow.settled`).
 *
 * The rows arrive pre-aggregated from the server projection
 * (deals.listParticipations / aggregate.listParticipations); search + facet
 * filters run here on the lightweight rows and apply to BOTH tables at once
 * (a row matches an instrument/status facet when ANY of its deals carries the
 * value — the row's sums always cover the whole company bucket). Export
 * (CSV or Excel) fetches the per-deal set one-shot via `loadExportDeals`,
 * then keeps only the deals of the companies that survive the current
 * search + filters.
 */
export function ParticipationsView({
  rows,
  showOrg = false,
  orgSlug,
  exportRef,
  loadExportDeals,
  header,
}: {
  rows: Array<CompanyRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  exportRef?: RefObject<((format: 'csv' | 'xlsx') => void) | null>
  /** One-shot fetch of the full per-deal set feeding the export. */
  loadExportDeals?: () => Promise<Array<DealRow>>
  /**
   * Page title row, rendered inside the sticky bar right above the toolbar.
   * Passed in (rather than left in the route) so title and toolbar pin as ONE
   * block — two stacked sticky elements would need a hardcoded top offset.
   */
  header?: ReactNode
}) {
  const { t } = useTranslation('participations')

  // Search + facets survive navigation (per tab, per org — see
  // `usePersistentFilters`): leaving the list and coming back keeps them.
  const [filters, setFilters, resetFilters] = usePersistentFilters(
    `participations:${orgSlug ?? 'all'}`,
    {
      search: '',
      instruments: [] as Array<string>,
      sectors: [] as Array<string>,
    },
  )

  // Client-side search (low volumes): company name, custom deal names,
  // instrument (raw key + translated label), investors, sector —
  // case/accent insensitive.
  const search = filters.search
  const term = normalizeSearch(useDebouncedValue(search))

  // Faceted filters (multi-select), applied at the row (company) level
  // alongside the search, before the split into the status tables. No status
  // facet: the per-status tables below play that role.
  const instrumentFilter = useMemo(
    () => new Set(filters.instruments),
    [filters.instruments],
  )
  const sectorFilter = useMemo(
    () => new Set(filters.sectors),
    [filters.sectors],
  )
  const toggle = (field: 'instruments' | 'sectors') => (value: string) =>
    setFilters({ [field]: toggleValue(filters[field], value) })
  const hasFilters =
    filters.instruments.length > 0 || filters.sectors.length > 0

  // Facet options derived from the full row set (not the filtered one, so
  // options never vanish mid-selection), localized and sorted by label.
  const facets = useMemo(() => {
    const instruments = new Map<string, string>()
    const sectors = new Map<string, string>()
    for (const r of rows ?? []) {
      for (const kind of r.instrumentKinds) {
        instruments.set(
          kind,
          t(`instrument.${kind}`, { defaultValue: kind }),
        )
      }
      if (r.sector) {
        sectors.set(
          r.sector,
          t(`sectors.${r.sector}`, { defaultValue: r.sector }),
        )
      }
    }
    const toOptions = (m: Map<string, string>): Array<FacetOption> =>
      Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) =>
        a.label.localeCompare(b.label),
      )
    return {
      instruments: toOptions(instruments),
      sectors: toOptions(sectors),
    }
  }, [rows, t])

  const filtered = useMemo(() => {
    if (!rows) return rows
    if (!term && !hasFilters) return rows
    return rows.filter((r) => {
      const matchesSearch =
        !term ||
        [
          r.name,
          ...r.dealNames,
          r.sector,
          r.sector && t(`sectors.${r.sector}`, { defaultValue: r.sector }),
          ...r.investorNames,
          ...r.instrumentKinds,
          ...r.instrumentKinds.map((kind) =>
            t(`instrument.${kind}`, { defaultValue: kind }),
          ),
        ].some((s) => s && normalizeSearch(s).includes(term))
      if (!matchesSearch) return false
      if (
        instrumentFilter.size > 0 &&
        !r.instrumentKinds.some((kind) => instrumentFilter.has(kind))
      )
        return false
      if (
        sectorFilter.size > 0 &&
        !(r.sector != null && sectorFilter.has(r.sector))
      )
        return false
      return true
    })
  }, [rows, term, t, instrumentFilter, sectorFilter, hasFilters])

  // One bucket per status table. Exit outcome mirrors the badge rule at the
  // company-bucket level: a write-off or a realized MOIC < 1 is a loss; an
  // unknown MOIC is never a loss. A company whose deals span several statuses
  // has one row per table: those rows carry `companyDealTotal` so the Deals
  // column reads "1 sur 2" instead of "1 deal". The total is summed on the
  // FULL row set — a facet can hide one of the company's rows, but the
  // mention must not shift with the filters.
  const buckets = useMemo(() => {
    if (!filtered) return null
    const totalByCompany = new Map<string, number>()
    for (const r of rows ?? []) {
      totalByCompany.set(
        r.companyId,
        (totalByCompany.get(r.companyId) ?? 0) + r.dealCount,
      )
    }
    const decorate = (r: CompanyRow): CompanyRow => {
      const total = totalByCompany.get(r.companyId) ?? r.dealCount
      return total === r.dealCount ? r : { ...r, companyDealTotal: total }
    }
    const pending: Array<CompanyRow> = []
    const active: Array<CompanyRow> = []
    const exitWin: Array<CompanyRow> = []
    const exitLoss: Array<CompanyRow> = []
    const cancelled: Array<CompanyRow> = []
    for (const r of filtered) {
      if (r.pending) pending.push(decorate(r))
      // Cancelled before the `!settled` test: a called-off deal is not an open
      // position, and it never reaches the exit tables (no win, no loss).
      else if (r.cancelled) cancelled.push(decorate(r))
      else if (!r.settled) active.push(decorate(r))
      else if (r.writtenOff || (r.moic != null && r.moic < 1))
        exitLoss.push(decorate(r))
      else exitWin.push(decorate(r))
    }
    return { pending, active, exitWin, exitLoss, cancelled }
  }, [filtered, rows])

  // Flat export (one deal per row), CSV or Excel. Follows the current search
  // + filters: only the deals of the companies whose rows survive them are
  // exported (the filters match at the company level, so BOTH status buckets
  // of a visible company are covered — same predicate as the tables). The
  // per-deal data is NOT subscribed by this view anymore (the tables run on
  // the aggregated rows), so it's fetched one-shot on demand.
  async function handleExport(format: 'csv' | 'xlsx') {
    if (!loadExportDeals) return
    let deals: Array<DealRow>
    try {
      deals = await loadExportDeals()
    } catch {
      toast.error(t('export.error'))
      return
    }
    if (filtered && (term || hasFilters)) {
      const visible = new Set(filtered.map((r) => r.companyId))
      deals = deals.filter((d) => visible.has(d.targetCompanyId))
    }
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
      t('col.moic'),
      t('col.tri'),
      t('deal.signed'),
    ]
    // One intermediate record per deal so CSV and Excel serialize the SAME
    // values, each format only picking its own rendering.
    const exportRows = deals.map((d) => ({
      company: d.target?.name ?? '',
      deal: d.name ?? '',
      instrument: t(`instrument.${d.instrumentKind}`, {
        defaultValue: d.instrumentKind,
      }),
      investor: d.investor?.name ?? '',
      status: t(`status.${dealStatusLabelKey(d.status, d.moic)}`, {
        defaultValue: d.status,
      }),
      committedCents: d.committedAmount ?? null,
      paidCents: d.paidActual ?? 0,
      receivedCents: d.received ?? 0,
      valuationCents: d.lastValuationCents ?? null,
      tvpi: tvpiRatio({
        capital: d.paidActual ?? 0,
        proceeds: d.received ?? 0,
        residual: residualCents(d),
      }),
      // Realized MOIC + exact XIRR straight from the authoritative server
      // fields (no client recompute). TRI is a raw decimal ratio (unitless,
      // like TVPI/MOIC); null when undefined (e.g. total loss, no proceeds).
      moic: d.moic ?? null,
      irr: d.irr ?? null,
      signed: d.signedDate
        ? new Date(d.signedDate).toISOString().slice(0, 10)
        : null,
    }))
    const day = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      const euros = (cents: number | null) =>
        cents == null ? null : (cents / 100).toFixed(2)
      const csvRows = exportRows.map((r) => [
        r.company,
        r.deal,
        r.instrument,
        r.investor,
        r.status,
        euros(r.committedCents),
        euros(r.paidCents),
        euros(r.receivedCents),
        euros(r.valuationCents),
        r.tvpi == null ? null : r.tvpi.toFixed(2),
        r.moic == null ? null : r.moic.toFixed(2),
        r.irr == null ? null : r.irr.toFixed(4),
        r.signed,
      ])
      downloadCsv(`participations-${day}.csv`, toCsv(headers, csvRows))
      return
    }
    // Excel: same columns/rows, but the numeric cells stay numbers (euros
    // with a 2-decimal format). Dynamic import so the xlsx writer stays out
    // of the main bundle (v4 moved the browser entry to a subpath export).
    try {
      const { default: writeXlsxFile } = await import(
        'write-excel-file/browser'
      )
      const eur = (cents: number | null) =>
        cents == null ? null : { value: cents / 100, format: '0.00' }
      const num = (ratio: number | null, numFormat: string) =>
        ratio == null ? null : { value: ratio, format: numFormat }
      const data = [
        headers,
        ...exportRows.map((r) => [
          r.company,
          r.deal,
          r.instrument,
          r.investor,
          r.status,
          eur(r.committedCents),
          eur(r.paidCents),
          eur(r.receivedCents),
          eur(r.valuationCents),
          num(r.tvpi, '0.00'),
          num(r.moic, '0.00'),
          num(r.irr, '0.0000'),
          r.signed,
        ]),
      ]
      await writeXlsxFile(data).toFile(`participations-${day}.xlsx`)
    } catch {
      toast.error(t('export.error'))
    }
  }

  // Expose the export handler to a parent (header menu) when asked. No deps:
  // refresh every render so the ref always points at the latest closure.
  useEffect(() => {
    if (exportRef) exportRef.current = handleExport
  })

  const isFiltered = Boolean(term) || hasFilters

  // Toolbar shown as soon as there are rows — including when the current
  // search matches nothing (otherwise it can't be cleared). A facet is only
  // worth showing when it can actually partition the data (≥2 distinct values).
  const showToolbar = rows && rows.length > 0

  return (
    <div className="space-y-6">
      {/* Title + toolbar pinned to the top of the layout's scroll container.
          Full-bleed bg + border mask the rows passing underneath; z-40 keeps
          it above the tables' own sticky header cells (z-30). */}
      {(header || showToolbar) && (
        <div className="bg-background sticky top-0 z-40 -mx-6 space-y-3 border-b px-6 py-3">
          {header}
          {showToolbar && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                value={search}
                onChange={(e) => setFilters({ search: e.target.value })}
                placeholder={t('search.placeholder')}
                className="max-w-xs"
              />
              {facets.instruments.length >= 2 && (
                <FacetFilter
                  label={t('filters.instrument')}
                  options={facets.instruments}
                  selected={instrumentFilter}
                  onToggle={toggle('instruments')}
                />
              )}
              {facets.sectors.length >= 2 && (
                <FacetFilter
                  label={t('filters.sector')}
                  options={facets.sectors}
                  selected={sectorFilter}
                  onToggle={toggle('sectors')}
                />
              )}
              {/* Undebounced `search` so the button appears on the first
                  keystroke; it clears the search too. */}
              {(Boolean(search) || hasFilters) && (
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
              {!exportRef && loadExportDeals && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="ml-auto">
                      <Download className="size-4" />
                      {t('export.button')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void handleExport('csv')}>
                      {t('export.csv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void handleExport('xlsx')}
                    >
                      {t('export.xlsx')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      )}

      {!buckets ? (
        // Initial load: a single skeleton table (its body shows the loading row).
        <ParticipationsTable
          rows={undefined}
          showOrg={showOrg}
          orgSlug={orgSlug}
        />
      ) : SECTIONS.every(({ key }) => buckets[key].length === 0) ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {isFiltered ? t('search.noResults') : t('empty')}
        </div>
      ) : (
        SECTIONS.map(({ key, bucket, variant }) => {
          const bucketRows = buckets[key]
          // An empty status table is not rendered at all (e.g. no TS in
          // progress → no "pending" table).
          if (bucketRows.length === 0) return null
          const { band, dot } = participationBucketBand(bucket)
          return (
            <section key={key} className="space-y-3">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                  band,
                )}
              >
                <span aria-hidden className={cn('size-2 rounded-full', dot)} />
                {t(`sections.${key}`)}
                {/* Count in DEALS (not table rows): the whole list reasons
                    in deals, so the band matches the totals row below. */}
                <span className="text-muted-foreground">
                  (
                  {t('dealsCount', {
                    count: bucketRows.reduce((n, r) => n + r.dealCount, 0),
                  })}
                  )
                </span>
              </div>
              <ParticipationsTable
                rows={bucketRows}
                showOrg={showOrg}
                orgSlug={orgSlug}
                variant={variant}
                isFiltered={isFiltered}
              />
            </section>
          )
        })
      )}

      <CancelledSection
        rows={buckets?.cancelled}
        showOrg={showOrg}
        orgSlug={orgSlug}
        isFiltered={isFiltered}
      />
    </div>
  )
}

/**
 * Cancelled deals — wired then refunded, so neither an open position nor a
 * realized outcome. Kept out of the status tables and of every total, and
 * surfaced here only: a collapsed section at the bottom, rendered only when
 * there IS one (same discreet-door pattern as the "archived entities" and
 * "entities without a deal" sections of the participations page).
 */
function CancelledSection({
  rows,
  showOrg,
  orgSlug,
  isFiltered,
}: {
  rows: Array<CompanyRow> | undefined
  showOrg: boolean
  orgSlug?: string
  isFiltered: boolean
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)

  if (!rows || rows.length === 0) return null

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
      >
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
        {t('cancelled.sectionTitle', {
          count: rows.reduce((n, r) => n + r.dealCount, 0),
        })}
      </button>
      {open && (
        <ParticipationsTable
          rows={rows}
          showOrg={showOrg}
          orgSlug={orgSlug}
          variant="settled"
          isFiltered={isFiltered}
        />
      )}
    </section>
  )
}

/**
 * The four status tables, in display order: pending Term Sheets first (they
 * need attention), then open positions, then the realized outcomes. Band
 * colours come from `participationBucketBand` — the shared status palette.
 */
const SECTIONS = [
  { key: 'pending', bucket: 'pending', variant: 'pending' },
  { key: 'active', bucket: 'active', variant: 'active' },
  { key: 'exitWin', bucket: 'exit_win', variant: 'settled' },
  { key: 'exitLoss', bucket: 'exit_loss', variant: 'settled' },
] as const
