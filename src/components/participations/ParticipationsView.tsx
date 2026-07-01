import { useEffect, useMemo, useState } from 'react'
import { Download, ListFilter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ParticipationsTable, residualCents } from './ParticipationsTable'
import type { RefObject } from 'react'

import type { DealRow } from './ParticipationsTable'
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
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { downloadCsv, toCsv } from '~/lib/csv'
import { normalizeSearch } from '~/lib/searchText'

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

/**
 * Stacks two participation tables sharing ONE toolbar: the active deals on top
 * and an always-open section for settled deals (fully_exited / written_off)
 * below. The split on `status` is the only partitioning rule —
 * `partially_exited` stays with the active deals.
 *
 * Search + facet filters live here and apply to BOTH tables at once; the
 * settled table drops TVPI and adds a MOIC + annualized TRI column. Export
 * covers the full, unsplit set (active + settled) regardless of the filters.
 */
export function ParticipationsView({
  deals,
  showOrg = false,
  orgSlug,
  exportRef,
}: {
  deals: Array<DealRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  exportRef?: RefObject<(() => void) | null>
}) {
  const { t } = useTranslation('participations')

  // Client-side search (low volumes): company name, custom deal name,
  // instrument (raw key + translated label), investor, sector —
  // case/accent insensitive.
  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

  // Faceted filters (multi-select), applied at the deal level alongside the
  // search, before the split into active / settled.
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

  const { active, settled } = useMemo(() => {
    if (!filtered) return { active: undefined, settled: undefined }
    const activeDeals: Array<DealRow> = []
    const settledDeals: Array<DealRow> = []
    for (const d of filtered) {
      if (d.status === 'fully_exited' || d.status === 'written_off') {
        settledDeals.push(d)
      } else {
        activeDeals.push(d)
      }
    }
    return { active: activeDeals, settled: settledDeals }
  }, [filtered])

  // CSV export, flat (one deal per row). Always covers the full, unsplit deal
  // set (active + settled), independent of the current search / filters.
  function handleExport() {
    if (!deals) return
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
    const rows = deals.map((d) => {
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

  // Toolbar shown as soon as there are deals — including when the current
  // search matches nothing (otherwise it can't be cleared). A facet is only
  // worth showing when it can actually partition the data (≥2 distinct values).
  const showToolbar = deals && deals.length > 0

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
      )}

      <ParticipationsTable
        deals={active}
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
            deals={settled}
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
