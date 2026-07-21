import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  moic as moicRatio,
  proceedsFromReceived,
  residualValueCents,
  tvpi as tvpiRatio,
} from '../../../convex/lib/metrics'
import type { ReactNode } from 'react'

import type { Doc } from '../../../convex/_generated/dataModel'
import type { MoicTransaction } from '~/lib/dealMetrics'
import { cn } from '~/lib/utils'
import { xirr } from '~/lib/xirr'
import { CompanyLogo } from '~/components/CompanyLogo'
import { ScoreRing } from '~/components/companies/ScoreRing'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'

/**
 * One-liner cell: truncated to the column width, and — only when the text is
 * actually clipped — it becomes a click target that reveals the full pitch in
 * a popover. Short one-liners stay plain text so a row click still opens the
 * company sheet; the click that expands is stopped from bubbling so it never
 * navigates.
 */
function OneLinerCell({
  text,
  expandLabel,
}: {
  text?: string | null
  expandLabel: string
}) {
  const [truncated, setTruncated] = useState(false)
  // Stable callback ref: measures on mount, on resize, and again when the
  // element swaps between the plain-span and button branches below.
  const measureRef = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!text) return <span className="text-muted-foreground">—</span>

  if (!truncated) {
    return (
      <span
        ref={measureRef}
        className="block max-w-72 truncate text-muted-foreground lg:max-w-sm xl:max-w-md 2xl:max-w-lg"
      >
        {text}
      </span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={measureRef}
          type="button"
          aria-label={expandLabel}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="block max-w-72 cursor-pointer truncate text-left text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground lg:max-w-sm xl:max-w-md 2xl:max-w-lg"
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onClick={(e) => e.stopPropagation()}
        className="w-auto max-w-xs p-3 text-sm leading-snug text-foreground"
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}

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
    /** One-line pitch (companies.oneLiner), hand-filled. */
    oneLiner?: string | null
    /** Cerveau 3 health score (1-10), null while no synthesis exists. */
    aiScore?: number | null
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
  /**
   * Signed, de-VAT'd dated flows (server-side). Concatenated across a company's
   * deals to solve the company-level IRR on the union — IRR isn't additive.
   */
  flows?: Array<{ amount: number; date: number }>
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
 */
const stickyHeadClass = 'sticky left-0 z-10 bg-background'
const stickyCellClass =
  'sticky left-0 z-10 bg-background transition-colors ' +
  'group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]'

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
}): Array<{ labelKey: string; cents: number }> {
  const committed = deal.committedAmount ?? 0
  const paid = deal.paidActual ?? 0
  const isFund = deal.instrumentKind === 'fund_lp'
  if (isFund) {
    return [
      { labelKey: 'deal.committed', cents: committed },
      { labelKey: 'deal.paid', cents: paid },
    ]
  }
  if (deal.status === 'pending') {
    return [{ labelKey: 'deal.committedForecast', cents: committed }]
  }
  return [{ labelKey: 'deal.paid', cents: paid }]
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
            {dealAmountTiles(dl).map((tile) => (
              <Field key={tile.labelKey} label={t(tile.labelKey)}>
                {fmtEur(tile.cents)}
              </Field>
            ))}
            <Field label={t('deal.received')}>{fmtEur(dl.received ?? 0)}</Field>
            <Field label={t('deal.tvpi')}>{fmtMultiple(tvpi)}</Field>
            <Field label={t('deal.status')}>
              <Badge
                variant={statusVariant(dl.status)}
                className={
                  dl.status === 'pending'
                    ? 'bg-warning text-warning-foreground'
                    : undefined
                }
              >
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
type SortKey = 'name' | 'aiScore' | 'deals' | 'paid' | 'received' | 'tvpi'

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
        oneLiner: string | undefined
        sector: string | undefined
        // Defensive: only a numeric score is kept (aiAnalysis is untyped).
        aiScore: number | undefined
        orgs: Set<string>
        slug: string | undefined
        deals: Array<DealRow>
        paid: number
        received: number
        residual: number
        // Settled-only MOIC inputs (capital deployed, proceeds net of VAT).
        capital: number
        proceeds: number
        // Union of the deals' signed, de-VAT'd dated flows — solved by `xirr`
        // for the EXACT company TRI. IRR is not additive, so it must run on the
        // union, never be derived from per-deal rates.
        flows: Array<{ amount: number; date: number }>
        // Group exit outcome for the badge: a write-off anywhere wins.
        writtenOff: boolean
        // At least one deal of the group is a pending Term Sheet (not invested).
        hasPending: boolean
      }
    >()
    for (const d of deals) {
      const key = d.target?._id ?? d.targetCompanyId
      const g = map.get(key) ?? {
        name: d.target?.name ?? '—',
        domain: d.target?.domain ?? undefined,
        oneLiner: d.target?.oneLiner ?? undefined,
        sector: d.target?.sector ?? undefined,
        aiScore:
          typeof d.target?.aiScore === 'number' ? d.target.aiScore : undefined,
        orgs: new Set<string>(),
        slug: orgSlug ?? d.org?.slug,
        deals: [],
        paid: 0,
        received: 0,
        residual: 0,
        capital: 0,
        proceeds: 0,
        flows: [],
        writtenOff: false,
        hasPending: false,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      g.paid += d.paidActual ?? 0
      g.received += d.received ?? 0
      g.residual += residualCents(d)
      // MOIC capital/proceeds, accumulated per-deal so each deal's own VAT
      // convention applies (royalty proceeds are net of VAT — mirrors
      // dealMoic in ~/lib/dealMetrics). De-VATing only ever lowers the
      // multiple, so a mixed group is never overvalued (no false Exit win).
      g.capital += d.paidActual ?? 0
      g.proceeds += proceedsFromReceived(d.received ?? 0, d.instrumentKind)
      // Server-side flows already carry the sign + per-deal VAT convention;
      // the union feeds the shared solver for the company IRR.
      if (d.flows) g.flows.push(...d.flows)
      if (d.status === 'written_off') g.writtenOff = true
      if (d.status === 'pending') g.hasPending = true
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => {
      const moic = moicRatio({ capital: g.capital, proceeds: g.proceeds })
      // EXACT company TRI: annualized XIRR on the union of the company's dated
      // flows (the shared, server-consistent solver). Null — shown "—" — when
      // undefined, e.g. a total loss with no proceeds (no sign change).
      const tri = xirr(g.flows)
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
  // (signedDate desc). Missing TVPIs / AI scores sink to the end (desc).
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
          : sort.key === 'aiScore'
            ? (g.aiScore ?? Number.NEGATIVE_INFINITY)
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

  // Base 8 (company, one-liner, sector, AI score, deals, invested, received,
  // chevron) + the optional org column, plus TVPI (active) or MOIC + TRI
  // (settled).
  const colSpan = 8 + (showOrg ? 1 : 0) + (settled ? 2 : 1)

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
                className={stickyHeadClass}
              />
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <TableHead>{t('col.oneLiner')}</TableHead>
              <TableHead>{t('col.sector')}</TableHead>
              <SortableHead
                label={t('col.aiScore')}
                active={sort?.key === 'aiScore'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('aiScore')}
                sortable={!settled}
              />
              <SortableHead
                label={t('col.deals')}
                active={sort?.key === 'deals'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('deals')}
                className="text-right"
                sortable={!settled}
              />
              <SortableHead
                label={t('col.invested')}
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
    oneLiner: string | undefined
    sector: string | undefined
    aiScore: number | undefined
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
    hasPending: boolean
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
      // `group` on EVERY row: the frozen cell's hover tint is driven by
      // group-hover (see stickyCellClass), clickable or not.
      className={cn('group', openDetail && 'cursor-pointer')}
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
      <TableCell className={cn('font-medium', stickyCellClass)}>
        <span className="flex items-center gap-2">
          <CompanyLogo
            domain={group.domain}
            companyName={group.name}
            size="sm"
          />
          {group.name}
          {group.hasPending && !settled && (
            <Badge className="bg-warning text-warning-foreground">
              {t('status.pending')}
            </Badge>
          )}
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
      <TableCell>
        <OneLinerCell text={group.oneLiner} expandLabel={t('oneLinerExpand')} />
      </TableCell>
      <TableCell>
        {group.sector
          ? t(`sectors.${group.sector}`, { defaultValue: group.sector })
          : '—'}
      </TableCell>
      <TableCell>
        {group.aiScore != null ? (
          <ScoreRing score={group.aiScore} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
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
