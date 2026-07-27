import { useEffect, useMemo, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { tvpi as tvpiRatio } from '../../../convex/lib/metrics'
import { ParticipationsTable, residualCents } from './ParticipationsTable'
import { FacetFilter } from './FacetFilter'
import type { RefObject } from 'react'

import type { FacetOption } from './FacetFilter'
import type { CompanyRow, DealRow } from './ParticipationsTable'
import { dealStatusLabelKey } from '~/lib/dealStatusBadge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { downloadCsv, toCsv } from '~/lib/csv'
import { normalizeSearch } from '~/lib/searchText'

/**
 * Stacks two participation tables sharing ONE toolbar: the companies with
 * active deals on top and an always-open section for the settled bucket
 * (fully_exited / written_off) below. The split is made server-side
 * (`CompanyRow.settled`) — `partially_exited` stays with the active rows.
 *
 * The rows arrive pre-aggregated from the server projection
 * (deals.listParticipations / aggregate.listParticipations); search + facet
 * filters run here on the lightweight rows and apply to BOTH tables at once
 * (a row matches an instrument/status facet when ANY of its deals carries the
 * value — the row's sums always cover the whole company bucket). Export
 * covers the full per-deal set, fetched one-shot via `loadExportDeals`,
 * regardless of the filters.
 */
export function ParticipationsView({
  rows,
  showOrg = false,
  orgSlug,
  exportRef,
  loadExportDeals,
}: {
  rows: Array<CompanyRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  exportRef?: RefObject<(() => void) | null>
  /** One-shot fetch of the full per-deal set feeding the CSV export. */
  loadExportDeals?: () => Promise<Array<DealRow>>
}) {
  const { t } = useTranslation('participations')

  // Client-side search (low volumes): company name, custom deal names,
  // instrument (raw key + translated label), investors, sector —
  // case/accent insensitive.
  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

  // Faceted filters (multi-select), applied at the row (company) level
  // alongside the search, before the split into active / settled.
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

  // Facet options derived from the full row set (not the filtered one, so
  // options never vanish mid-selection), localized and sorted by label.
  const facets = useMemo(() => {
    const instruments = new Map<string, string>()
    const statuses = new Map<string, string>()
    const sectors = new Map<string, string>()
    for (const r of rows ?? []) {
      for (const kind of r.instrumentKinds) {
        instruments.set(
          kind,
          t(`instrument.${kind}`, { defaultValue: kind }),
        )
      }
      for (const status of r.statuses) {
        statuses.set(status, t(`status.${status}`, { defaultValue: status }))
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
      statuses: toOptions(statuses),
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
        statusFilter.size > 0 &&
        !r.statuses.some((status) => statusFilter.has(status))
      )
        return false
      if (
        sectorFilter.size > 0 &&
        !(r.sector != null && sectorFilter.has(r.sector))
      )
        return false
      return true
    })
  }, [rows, term, t, instrumentFilter, statusFilter, sectorFilter, hasFilters])

  const { active, settled } = useMemo(() => {
    if (!filtered) return { active: undefined, settled: undefined }
    const activeRows: Array<CompanyRow> = []
    const settledRows: Array<CompanyRow> = []
    for (const r of filtered) {
      if (r.settled) settledRows.push(r)
      else activeRows.push(r)
    }
    return { active: activeRows, settled: settledRows }
  }, [filtered])

  // CSV export, flat (one deal per row). Always covers the full, unsplit deal
  // set (active + settled), independent of the current search / filters. The
  // per-deal data is NOT subscribed by this view anymore (the tables run on
  // the aggregated rows), so it's fetched one-shot on demand.
  async function handleExport() {
    if (!loadExportDeals) return
    let deals: Array<DealRow>
    try {
      deals = await loadExportDeals()
    } catch {
      toast.error(t('export.error'))
      return
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
    const euros = (cents?: number | null) =>
      cents == null ? null : (cents / 100).toFixed(2)
    const csvRows = deals.map((d) => {
      const tvpi = tvpiRatio({
        capital: d.paidActual ?? 0,
        proceeds: d.received ?? 0,
        residual: residualCents(d),
      })
      return [
        d.target?.name ?? '',
        d.name ?? '',
        t(`instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
        d.investor?.name ?? '',
        t(`status.${dealStatusLabelKey(d.status, d.moic)}`, {
          defaultValue: d.status,
        }),
        euros(d.committedAmount),
        euros(d.paidActual ?? 0),
        euros(d.received ?? 0),
        euros(d.lastValuationCents),
        tvpi == null ? null : tvpi.toFixed(2),
        // Realized MOIC + exact XIRR straight from the authoritative server
        // fields (no client recompute). TRI is a raw decimal ratio (unitless,
        // like TVPI/MOIC); null when undefined (e.g. total loss, no proceeds).
        d.moic == null ? null : d.moic.toFixed(2),
        d.irr == null ? null : d.irr.toFixed(4),
        d.signedDate ? new Date(d.signedDate).toISOString().slice(0, 10) : null,
      ]
    })
    const day = new Date().toISOString().slice(0, 10)
    downloadCsv(`participations-${day}.csv`, toCsv(headers, csvRows))
  }

  // Expose the export handler to a parent (header menu) when asked. No deps:
  // refresh every render so the ref always points at the latest closure.
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

  // Toolbar shown as soon as there are rows — including when the current
  // search matches nothing (otherwise it can't be cleared). A facet is only
  // worth showing when it can actually partition the data (≥2 distinct values).
  const showToolbar = rows && rows.length > 0

  return (
    <div className="space-y-6">
      {showToolbar && (
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
          {!exportRef && loadExportDeals && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              className="ml-auto"
            >
              <Download className="size-4" />
              {t('export.button')}
            </Button>
          )}
        </div>
      )}

      <ParticipationsTable
        rows={active}
        showOrg={showOrg}
        orgSlug={orgSlug}
        isFiltered={isFiltered}
        resetKey={filterKey}
      />

      {settled && settled.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-sm font-medium">
            {t('settled.sectionTitle', { count: settled.length })}
          </h3>
          <ParticipationsTable
            rows={settled}
            showOrg={showOrg}
            orgSlug={orgSlug}
            settled
            isFiltered={isFiltered}
            resetKey={filterKey}
          />
        </section>
      )}
    </div>
  )
}
