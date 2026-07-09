import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { ReactNode } from 'react'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { BpPoint } from '~/lib/royalties'
import type { PanelTransaction } from '~/components/deals/InstrumentBlock'
import { xirr } from '~/lib/xirr'
import {
  buildRoyaltyRows,
  parseAmountToCents,
  parseBpPaste,
} from '~/lib/royalties'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { signTone } from '~/lib/moneyTone'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { AmountInput, useAmountField } from '~/components/ui/amount-input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

// Column hierarchy (visual priority Réel > BP dégradé > BP initial). Brand
// tokens only — never hardcoded colors. BP initial is the most faded
// (secondary reference), BP dégradé is marked (the main comparison baseline),
// Réel is the most prominent (the data that matters).
const COL_BP_INITIAL = 'text-muted-foreground'
const COL_BP_DEGRADED = 'bg-muted/40'
const COL_REAL = 'font-medium'

/**
 * A single revenue cell editable inline (click → input → Enter/blur saves,
 * Escape cancels). Reuses the corrected FR/US parser. Used for the two
 * user-entered CA columns (BP initial and Réel); the column style class is
 * passed through so the cell keeps its visual hierarchy.
 */
function EditableCa({
  value,
  onSave,
  onDelete,
  className,
}: {
  value: number | undefined
  onSave: (cents: number) => void
  onDelete: () => void
  className?: string
}) {
  const { fmtEur } = useFormatters()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // The amount-field hook must run on every render, not only while editing —
  // calling it inside the `if (editing)` branch below changes the hook count
  // when the cell toggles into edit mode and crashes the deal fiche (the route
  // errorComponent then swallows it as "deal not found"). Same rule-of-hooks
  // pattern as DealFieldInput. Props are only spread onto the input when open.
  const amountProps = useAmountField(draft, setDraft)

  function begin() {
    setDraft(value != null ? String(value / 100) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    // Three cases — never conflate "emptied" with "parse failed":
    // - emptied (trim === '') → delete the point, cell goes back to "—".
    // - parsed (0 included) → save (a real 0 stays "0 €", not "—").
    // - non-empty but unparseable ("abc") → no-op, keep the existing point.
    if (draft.trim() === '') {
      if (value != null) onDelete()
      return
    }
    const cents = parseAmountToCents(draft)
    if (cents != null && cents !== value) onSave(cents)
  }

  if (editing) {
    return (
      <TableCell className={cn('text-right tabular-nums', className)}>
        <Input
          autoFocus
          {...amountProps}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="h-7 text-right tabular-nums"
        />
      </TableCell>
    )
  }

  return (
    <TableCell
      className={cn(
        'hover:bg-muted/50 cursor-pointer text-right tabular-nums',
        className,
      )}
      onClick={begin}
    >
      {value == null ? '—' : fmtEur(value)}
    </TableCell>
  )
}

/**
 * Custom central block for a `royalty` deal (e.g. La Vie de Quartier): a
 * royalties investment indexed on a shop's revenue. 1 deal = 1 underlying.
 *
 * Three declarative parameters (capital, depreciation, royalty rate) are
 * stored as scalars and edited through the shared deal dialog (`onEdit`, like
 * LeadSpvPanel). Two lists — the initial BP (pasted once) and the actuals (one
 * point per quarter) — are stored on the deal and edited via a dedicated UI
 * here that patches `deals.update`. Everything else (degraded BP, royalties,
 * gaps, cumulative totals) is derived at display, nothing is stored.
 */
export function RoyaltiesPanel({
  deal,
  transactions,
  notesSlot,
  onEdit,
}: {
  deal: Doc<'deals'>
  received?: number
  transactions?: Array<PanelTransaction>
  notesSlot?: ReactNode
  onEdit?: () => void
}) {
  const { t, i18n } = useTranslation('participations')
  const lang = i18n.language
  const { fmtEur, fmtDate, fmtMultiple } = useFormatters()
  const updateDeal = useConvexMutation(api.deals.update)

  const [importOpen, setImportOpen] = useState(false)
  const [quarterOpen, setQuarterOpen] = useState(false)

  const fmtPct = (bps: number | undefined) =>
    bps == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(bps / 10000)

  const fmtPctSigned = (ratio: number) =>
    new Intl.NumberFormat(lang, {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'always',
    }).format(ratio)

  // Annualized TRI: a signed decimal ratio (e.g. -0.42, 0.15) → percent.
  const fmtTriPct = (ratio: number) =>
    new Intl.NumberFormat(lang, {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'always',
    }).format(ratio)

  // Floor / cap are stored as multiples; their euro amount is derived from the
  // invested capital at display, never stored. `—` when either is missing.
  const capital = deal.capitalInvested
  const floorAmount =
    deal.floorMultiple != null && capital != null
      ? Math.round(deal.floorMultiple * capital)
      : undefined
  const capAmount =
    deal.capMultiple != null && capital != null
      ? Math.round(deal.capMultiple * capital)
      : undefined

  const fmtMultipleAmount = (mult?: number, amount?: number) =>
    mult == null
      ? '—'
      : amount == null
        ? fmtMultiple(mult)
        : `${fmtMultiple(mult)} — ${fmtEur(amount)}`

  const params = [
    { key: 'capitalInvested', value: fmtEur(deal.capitalInvested) },
    { key: 'depreciationRate', value: fmtPct(deal.depreciationRate) },
    { key: 'royaltyRate', value: fmtPct(deal.royaltyRate) },
    { key: 'investmentDate', value: fmtDate(deal.investmentDate) },
    { key: 'royaltyStartDate', value: fmtDate(deal.royaltyStartDate) },
    {
      key: 'floorMultiple',
      value: fmtMultipleAmount(deal.floorMultiple, floorAmount),
    },
    {
      key: 'capMultiple',
      value: fmtMultipleAmount(deal.capMultiple, capAmount),
    },
    { key: 'endDate', value: fmtDate(deal.endDate) },
  ]

  const { rows, totals } = useMemo(
    () =>
      buildRoyaltyRows(
        deal.bpPoints,
        deal.actualPoints,
        deal.depreciationRate,
        deal.royaltyRate,
      ),
    [deal.bpPoints, deal.actualPoints, deal.depreciationRate, deal.royaltyRate],
  )

  // Realized indicators (bar, CoC, TRI) live in a different world from the
  // projection table above: they are built from the actual incoming transactions
  // attached to the deal, de-VAT'd to HT (amounts are stored TTC; rate is a flat
  // 20%, so HT = TTC / 1.20). Never compute these from the table. The invested
  // capital (`capitalInvested`) is already HT and is NEVER de-VAT'd.
  const incoming = useMemo(
    () => (transactions ?? []).filter((tx) => tx.direction === 'in'),
    [transactions],
  )
  // Cumulative realized royalties (HT, cents): the cash actually received.
  const realizedCumul = useMemo(
    () => Math.round(incoming.reduce((s, tx) => s + tx.amount, 0) / 1.2),
    [incoming],
  )
  const reached = floorAmount != null && realizedCumul >= floorAmount
  const capReached = capAmount != null && realizedCumul >= capAmount

  // Position (0–100%) of an amount on the 0 → cap bar scale.
  const barPct = (amount: number) =>
    capAmount != null && capAmount > 0
      ? Math.min(100, (amount / capAmount) * 100)
      : 0

  // Position of the realized-cumul cursor on the bar, reused by the floating
  // label (for edge-aware anchoring) and the achieved fill.
  const cursorPct = barPct(realizedCumul)

  // Cash-on-cash: realized HT royalties / invested capital, as a multiple.
  const coc =
    capital != null && capital > 0 ? realizedCumul / capital : null

  // TRI (XIRR): one outflow (invested capital, HT, at investmentDate) plus each
  // incoming transaction de-VAT'd at its own date. Negative early on (capital
  // not yet recovered) — mathematically correct, shown as-is.
  const tri = useMemo(() => {
    if (capital == null || deal.investmentDate == null || incoming.length === 0)
      return null
    return xirr([
      { amount: -capital, date: deal.investmentDate },
      ...incoming.map((tx) => ({
        amount: tx.amount / 1.2,
        date: tx.transactionDate,
      })),
    ])
  }, [capital, deal.investmentDate, incoming])

  async function saveBp(bpPoints: Array<BpPoint>) {
    try {
      await updateDeal({ id: deal._id, patch: { bpPoints } })
      toast.success(t('edit.saved'))
      setImportOpen(false)
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  async function addActual(quarter: string, actualRevenue: number) {
    // Append or replace the point for this quarter (dedup on the quarter key).
    const next = (deal.actualPoints ?? []).filter((p) => p.quarter !== quarter)
    next.push({ quarter, actualRevenue })
    try {
      await updateDeal({ id: deal._id, patch: { actualPoints: next } })
      toast.success(t('edit.saved'))
      setQuarterOpen(false)
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  // Inline edit of a single BP point (same dedup-and-replace mechanism as
  // addActual). Editing a quarter that only had an actual creates its BP point.
  async function saveBpPoint(quarter: string, plannedRevenue: number) {
    const next = (deal.bpPoints ?? []).filter((p) => p.quarter !== quarter)
    next.push({ quarter, plannedRevenue })
    try {
      await updateDeal({ id: deal._id, patch: { bpPoints: next } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  // Remove a point by clearing its cell (filter without re-insertion). The row
  // survives if the other column still has a point; otherwise the quarter drops
  // out of the union. Distinct from saving a 0 — only an absent point shows "—".
  async function removeActual(quarter: string) {
    const next = (deal.actualPoints ?? []).filter((p) => p.quarter !== quarter)
    try {
      await updateDeal({ id: deal._id, patch: { actualPoints: next } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  async function removeBpPoint(quarter: string) {
    const next = (deal.bpPoints ?? []).filter((p) => p.quarter !== quarter)
    try {
      await updateDeal({ id: deal._id, patch: { bpPoints: next } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  const hasData = rows.length > 0

  // Read-only euro cell used across the transposed body rows (all quarter and
  // cumulative cells except the two editable CA lines and the gap rows).
  const euroCell = (
    value: number | undefined,
    key: string,
    className?: string,
  ) => (
    <TableCell key={key} className={cn('text-right tabular-nums', className)}>
      {value == null ? '—' : fmtEur(value)}
    </TableCell>
  )

  return (
    <div className="space-y-4">
      {/* Declarative parameters (stored), edited via the shared dialog. */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-medium">
            {t('fiche.royalty.paramsTitle')}
          </span>
          {onEdit && (
            <Button variant="ghost" size="sm" className="h-7" onClick={onEdit}>
              <Pencil className="size-3.5" />
              {t('fiche.royalty.edit')}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 p-4">
          {params.map((p) => (
            <div key={p.key} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">
                {t(`field.${p.key}`, { defaultValue: p.key })}
              </span>
              <span className="text-sm tabular-nums">{p.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Deal notes (injected by the page) sit between the parameters and the
          realized indicators on the royalty fiche. */}
      {notesSlot}

      {/* Realized performance — built from the incoming transactions de-VAT'd to
          HT, NOT from the projection table. Only shown once floor/cap multiples
          and capital are entered. */}
      {floorAmount != null && capAmount != null && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {t('fiche.royalty.realizedTitle')}
            </span>
          </div>

          {/* Bar: 0 → floor → cap scale, two background zones, explicit floor
              and cap traits with a label each, floating cursor label for the
              realized cumulative. */}
          <div className="relative pt-6 pb-10">
            <div
              className={cn(
                'absolute top-0 text-xs font-medium tabular-nums whitespace-nowrap',
                // Edge-aware anchoring so the floating label never clips out of
                // the track: left-anchored near 0 (e.g. 0 € realized),
                // right-anchored near the cap, centered in between.
                cursorPct <= 5
                  ? 'translate-x-0'
                  : cursorPct >= 95
                    ? '-translate-x-full'
                    : '-translate-x-1/2',
              )}
              style={{ left: `${cursorPct}%` }}
            >
              {fmtEur(realizedCumul)}{' '}
              <span className="text-muted-foreground text-xs font-normal">
                {t('fiche.royalty.htTag')}
              </span>
            </div>
            <div className="bg-muted relative h-3 w-full overflow-hidden rounded-full">
              {/* 0 → floor: securing zone. */}
              <div
                className="bg-primary/15 absolute inset-y-0 left-0"
                style={{ width: `${barPct(floorAmount)}%` }}
                aria-hidden
              />
              {/* floor → cap: yield zone. */}
              <div
                className="bg-positive/15 absolute inset-y-0 right-0"
                style={{ left: `${barPct(floorAmount)}%` }}
                aria-hidden
              />
              {/* Achieved fill, three zones: before floor (primary), floor →
                  cap (positive), cap reached (chart-5 — the royalties accent). */}
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full transition-all',
                  capReached
                    ? 'bg-chart-5'
                    : reached
                      ? 'bg-positive'
                      : 'bg-primary',
                )}
                style={{ width: `${cursorPct}%` }}
              />
              {/* Floor trait. */}
              <div
                className="bg-foreground/60 absolute inset-y-0 w-px"
                style={{ left: `${barPct(floorAmount)}%` }}
                aria-hidden
              />
            </div>
            {/* Cap trait — explicit hard-ceiling marker, drawn over the track
                edge (outside the clipped, rounded track so the corner doesn't
                hide it). Marked stronger than the floor trait. `top-6` aligns
                with the track under the container's `pt-6`. */}
            <div
              className="bg-foreground absolute top-6 right-0 h-3 w-0.5"
              aria-hidden
            />
            {/* Marker labels aligned under their trait (floor centered, cap at
                the right edge). Each carries a discreet "Plancher"/"Plafond"
                caption stacked above its amount (bottom-anchored so the amount
                keeps its place and the caption grows upward). */}
            <div className="text-muted-foreground absolute inset-x-0 bottom-0 text-xs tabular-nums">
              <span
                className={cn(
                  'absolute bottom-0 flex -translate-x-1/2 flex-col items-center whitespace-nowrap',
                  reached && 'text-positive',
                )}
                style={{ left: `${barPct(floorAmount)}%` }}
              >
                <span className="text-muted-foreground text-[10px]">
                  {t('field.floorMultiple')}
                </span>
                <span>
                  {fmtEur(floorAmount)} ·{' '}
                  {fmtMultiple(deal.floorMultiple ?? null)}
                </span>
              </span>
              <span className="absolute right-0 bottom-0 flex flex-col items-end whitespace-nowrap">
                <span className="text-muted-foreground text-[10px]">
                  {t('field.capMultiple')}
                </span>
                <span>
                  {fmtEur(capAmount)} · {fmtMultiple(deal.capMultiple ?? null)}
                </span>
              </span>
            </div>
          </div>

          {/* Actionable state message. */}
          <p className="text-sm">
            {realizedCumul < floorAmount
              ? t('fiche.royalty.stateBeforeFloor', {
                  amount: fmtEur(floorAmount - realizedCumul),
                })
              : realizedCumul < capAmount
                ? t('fiche.royalty.stateBeforeCap', {
                    amount: fmtEur(capAmount - realizedCumul),
                  })
                : t('fiche.royalty.stateCapReached')}
          </p>

          {/* CoC + TRI indicators. */}
          <div className="grid grid-cols-2 gap-4 border-t pt-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">
                {t('fiche.royalty.cocLabel')}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {fmtMultiple(coc)}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t('fiche.royalty.cocBounds', {
                  floor: fmtMultiple(deal.floorMultiple ?? null),
                  cap: fmtMultiple(deal.capMultiple ?? null),
                })}
              </span>
            </div>
            {/* TRI: hidden while the capital isn't recovered (CoC < 1) — the
                XIRR is mathematically correct there but hyper-volatile and
                misleading, so we show « n/a » instead. The computation stays,
                it surfaces once CoC ≥ 1. Falls back to « — » on a null XIRR
                (no convergence / no opposing flow). */}
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">
                {t('fiche.royalty.triLabel')}
              </span>
              {coc != null && coc < 1 ? (
                <span className="text-muted-foreground text-sm tabular-nums">
                  {t('fiche.royalty.triNotRecovered')}
                </span>
              ) : tri != null ? (
                <span
                  className={cn(
                    'text-sm font-medium tabular-nums',
                    signTone(tri),
                  )}
                >
                  {fmtTriPct(tri)}
                </span>
              ) : (
                <span className="text-muted-foreground text-sm tabular-nums">
                  —
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quarterly comparison table. */}
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-medium">
            {t('fiche.royalty.tableTitle')}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setImportOpen(true)}
            >
              <ClipboardPaste className="size-3.5" />
              {t('fiche.royalty.importBp')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setQuarterOpen(true)}
            >
              <Plus className="size-3.5" />
              {t('fiche.royalty.addQuarter')}
            </Button>
          </div>
        </div>

        {hasData ? (
          <Table>
            {/* Transposed layout: quarters run in COLUMNS, the BP / Réel / Écart
                metrics in ROWS. Two left header columns (group + sub-metric),
                one column per quarter, then the cumulative column. */}
            <TableHeader>
              <TableRow>
                <TableHead colSpan={2} className="align-bottom">
                  {t('fiche.royalty.colQuarter')}
                </TableHead>
                {rows.map((r) => (
                  <TableHead key={r.quarter} className="text-right">
                    {r.quarter}
                  </TableHead>
                ))}
                <TableHead className="text-right font-medium">
                  {t('fiche.royalty.cumul')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* BP initial — CA (editable) + Royalties (derived). */}
              <TableRow className={COL_BP_INITIAL}>
                <TableCell
                  rowSpan={2}
                  className="align-top font-medium whitespace-normal"
                >
                  {t('fiche.royalty.colBpInitial')}
                </TableCell>
                <TableCell>{t('fiche.royalty.subCa')}</TableCell>
                {rows.map((r) => (
                  <EditableCa
                    key={r.quarter}
                    value={r.plannedRevenue}
                    onSave={(c) => void saveBpPoint(r.quarter, c)}
                    onDelete={() => void removeBpPoint(r.quarter)}
                  />
                ))}
                {euroCell(totals.plannedRevenue, 'total', 'font-medium')}
              </TableRow>
              <TableRow className={COL_BP_INITIAL}>
                <TableCell>{t('fiche.royalty.subRoyalties')}</TableCell>
                {rows.map((r) =>
                  euroCell(r.plannedRoyalty, r.quarter),
                )}
                {euroCell(totals.plannedRoyalty, 'total', 'font-medium')}
              </TableRow>

              {/* BP dégradé — CA + Royalties (both derived). */}
              <TableRow className={COL_BP_DEGRADED}>
                <TableCell
                  rowSpan={2}
                  className="align-top font-medium whitespace-normal"
                >
                  {t('fiche.royalty.colBpDegraded')}
                </TableCell>
                <TableCell>{t('fiche.royalty.subCa')}</TableCell>
                {rows.map((r) => euroCell(r.degradedRevenue, r.quarter))}
                {euroCell(totals.degradedRevenue, 'total', 'font-medium')}
              </TableRow>
              <TableRow className={COL_BP_DEGRADED}>
                <TableCell>{t('fiche.royalty.subRoyalties')}</TableCell>
                {rows.map((r) => euroCell(r.degradedRoyalty, r.quarter))}
                {euroCell(totals.degradedRoyalty, 'total', 'font-medium')}
              </TableRow>

              {/* Réel — CA (editable) + Royalties (derived). */}
              <TableRow className={COL_REAL}>
                <TableCell
                  rowSpan={2}
                  className="align-top font-medium whitespace-normal"
                >
                  {t('fiche.royalty.colReal')}
                </TableCell>
                <TableCell>{t('fiche.royalty.subCa')}</TableCell>
                {rows.map((r) => (
                  <EditableCa
                    key={r.quarter}
                    value={r.actualRevenue}
                    onSave={(c) => void addActual(r.quarter, c)}
                    onDelete={() => void removeActual(r.quarter)}
                  />
                ))}
                {euroCell(totals.actualRevenue, 'total', 'font-medium')}
              </TableRow>
              <TableRow className={COL_REAL}>
                <TableCell>{t('fiche.royalty.subRoyalties')}</TableCell>
                {rows.map((r) => euroCell(r.actualRoyalty, r.quarter))}
                {euroCell(totals.actualRoyalty, 'total', 'font-medium')}
              </TableRow>

              {/* Écart — € then %. Only the € line carries a cumulative total. */}
              <TableRow>
                <TableCell
                  rowSpan={2}
                  className="align-top font-medium whitespace-normal"
                >
                  {t('fiche.royalty.colGap')}
                </TableCell>
                <TableCell>€</TableCell>
                {rows.map((r) => (
                  <TableCell
                    key={r.quarter}
                    className={cn(
                      'text-right tabular-nums',
                      r.gapAbs != null && signTone(r.gapAbs),
                    )}
                  >
                    {r.gapAbs == null
                      ? '—'
                      : `${r.gapAbs > 0 ? '+' : ''}${fmtEur(r.gapAbs)}`}
                  </TableCell>
                ))}
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    signTone(totals.gapAbs),
                  )}
                >
                  {totals.gapAbs > 0 ? '+' : ''}
                  {fmtEur(totals.gapAbs)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>%</TableCell>
                {rows.map((r) => (
                  <TableCell
                    key={r.quarter}
                    className={cn(
                      'text-right tabular-nums',
                      r.gapAbs != null && signTone(r.gapAbs),
                    )}
                  >
                    {r.gapPct == null ? '—' : fmtPctSigned(r.gapPct)}
                  </TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {t('fiche.royalty.empty')}
          </p>
        )}
      </div>

      {importOpen && (
        <ImportBpDialog
          onClose={() => setImportOpen(false)}
          onConfirm={(bpRows) => void saveBp(bpRows)}
        />
      )}
      {quarterOpen && (
        <AddQuarterDialog
          onClose={() => setQuarterOpen(false)}
          onConfirm={(quarter, revenue) => void addActual(quarter, revenue)}
        />
      )}
    </div>
  )
}

/** Paste the BP (2 columns: quarter, planned revenue) with a preview. */
function ImportBpDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (rows: Array<BpPoint>) => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtEur } = useFormatters()
  const [text, setText] = useState('')

  const preview = useMemo(() => parseBpPaste(text), [text])
  const { rows, skipped } = preview
  const first = rows[0]
  const last = rows[rows.length - 1]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('participations:fiche.royalty.importTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:fiche.royalty.importDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('participations:fiche.royalty.importPlaceholder')}
            className="font-mono text-xs"
          />
          {text.trim() !== '' && (
            <div className="bg-muted/40 rounded-lg border p-3 text-sm">
              {rows.length === 0 ? (
                <p className="text-muted-foreground">
                  {t('participations:fiche.royalty.importEmpty')}
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">
                    {t('participations:fiche.royalty.importPreview', {
                      count: rows.length,
                    })}
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    {t('participations:fiche.royalty.importRange', {
                      fromQuarter: first.quarter,
                      fromValue: fmtEur(first.plannedRevenue),
                      toQuarter: last.quarter,
                      toValue: fmtEur(last.plannedRevenue),
                    })}
                  </p>
                  {skipped > 0 && (
                    <p className="text-chart-4">
                      {t('participations:fiche.royalty.importSkipped', {
                        count: skipped,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            disabled={rows.length === 0}
            onClick={() => onConfirm(rows)}
          >
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Add one quarter of actual revenue (year + quarter picker + amount). */
function AddQuarterDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (quarter: string, actualRevenue: number) => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const currentYear = new Date().getFullYear()
  const [quarterNum, setQuarterNum] = useState('1')
  const [year, setYear] = useState(String(currentYear))
  const [revenue, setRevenue] = useState('')

  const parsedRevenue = parseAmountToCents(revenue)
  const yearNum = Number.parseInt(year, 10)
  const valid =
    parsedRevenue != null &&
    Number.isFinite(yearNum) &&
    yearNum >= 2000 &&
    yearNum <= 2100

  function handleConfirm() {
    // `valid` already narrows parsedRevenue to a number (aliased condition).
    if (!valid) return
    onConfirm(`Q${quarterNum} ${yearNum}`, parsedRevenue)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('participations:fiche.royalty.quarterTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:fiche.royalty.quarterDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('participations:fiche.royalty.quarterLabel')}</Label>
              <Select value={quarterNum} onValueChange={setQuarterNum}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['1', '2', '3', '4'].map((q) => (
                    <SelectItem key={q} value={q}>
                      {`Q${q}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="royalty-year">
                {t('participations:fiche.royalty.yearLabel')}
              </Label>
              <Input
                id="royalty-year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="royalty-revenue">
              {t('participations:fiche.royalty.revenueLabel')}
            </Label>
            <AmountInput
              id="royalty-revenue"
              value={revenue}
              onChange={setRevenue}
              placeholder="0,00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={!valid} onClick={handleConfirm}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
