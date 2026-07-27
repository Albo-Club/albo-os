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
import {
  dealStatusLabelKey,
  participationBucketBand,
} from '~/lib/dealStatusBadge'
import { cn } from '~/lib/utils'
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
  // alongside the search, before the split into the status tables. No status
  // facet: the per-status tables below play that role.
  const [instrumentFilter, setInstrumentFilter] = useState<Set<string>>(
    new Set(),
  )
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
  const hasFilters = instrumentFilter.size > 0 || sectorFilter.size > 0
  const resetFilters = () => {
    setInstrumentFilter(new Set())
    setSectorFilter(new Set())
  }

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
  // unknown MOIC is never a loss.
  const buckets = useMemo(() => {
    if (!filtered) return null
    const pending: Array<CompanyRow> = []
    const active: Array<CompanyRow> = []
    const exitWin: Array<CompanyRow> = []
    const exitLoss: Array<CompanyRow> = []
    for (const r of filtered) {
      if (r.pending) pending.push(r)
      else if (!r.settled) active.push(r)
      else if (r.writtenOff || (r.moic != null && r.moic < 1)) exitLoss.push(r)
      else exitWin.push(r)
    }
    return { pending, active, exitWin, exitLoss }
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
                {/* Count in COMPANIES (table rows) — the totals row at the
                    bottom counts DEALS, so the unit must be explicit. */}
                <span className="text-muted-foreground">
                  ({t('sections.count', { count: bucketRows.length })})
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
    </div>
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
