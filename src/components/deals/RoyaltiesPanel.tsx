import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { BpPoint } from '~/lib/royalties'
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
  TableFooter,
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
  className,
}: {
  value: number | undefined
  onSave: (cents: number) => void
  className?: string
}) {
  const { fmtEur } = useFormatters()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function begin() {
    setDraft(value != null ? String(value / 100) : '')
    setEditing(true)
  }

  function commit() {
    const cents = parseAmountToCents(draft)
    setEditing(false)
    if (cents != null && cents !== value) onSave(cents)
  }

  if (editing) {
    return (
      <TableCell className={cn('text-right tabular-nums', className)}>
        <Input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
  onEdit,
}: {
  deal: Doc<'deals'>
  received?: number
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

  const fmtRatioPct = (ratio: number) =>
    new Intl.NumberFormat(lang, {
      style: 'percent',
      maximumFractionDigits: 0,
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

  // Progress: cumulative actual royalties (already computed) positioned on the
  // 0 → floor → cap scale. Pure display — no completion rule, just comparison.
  const cumul = totals.actualRoyalty
  const reached = floorAmount != null && cumul >= floorAmount

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

  const hasData = rows.length > 0

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
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="align-bottom">
                  {t('fiche.royalty.colQuarter')}
                </TableHead>
                <TableHead
                  colSpan={2}
                  className={cn('text-center', COL_BP_INITIAL)}
                >
                  {t('fiche.royalty.colBpInitial')}
                </TableHead>
                <TableHead
                  colSpan={2}
                  className={cn('text-center font-medium', COL_BP_DEGRADED)}
                >
                  {t('fiche.royalty.colBpDegraded')}
                </TableHead>
                <TableHead colSpan={2} className={cn('text-center', COL_REAL)}>
                  {t('fiche.royalty.colReal')}
                </TableHead>
                <TableHead colSpan={2} className="text-center">
                  {t('fiche.royalty.colGap')}
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead className={cn('text-right', COL_BP_INITIAL)}>
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className={cn('text-right', COL_BP_INITIAL)}>
                  {t('fiche.royalty.subRoyalties')}
                </TableHead>
                <TableHead className={cn('text-right', COL_BP_DEGRADED)}>
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className={cn('text-right', COL_BP_DEGRADED)}>
                  {t('fiche.royalty.subRoyalties')}
                </TableHead>
                <TableHead className={cn('text-right', COL_REAL)}>
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className={cn('text-right', COL_REAL)}>
                  {t('fiche.royalty.subRoyalties')}
                </TableHead>
                <TableHead className="text-right">€</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.quarter}>
                  <TableCell className="font-medium">{r.quarter}</TableCell>
                  <EditableCa
                    value={r.plannedRevenue}
                    onSave={(c) => void saveBpPoint(r.quarter, c)}
                    className={COL_BP_INITIAL}
                  />
                  <TableCell
                    className={cn('text-right tabular-nums', COL_BP_INITIAL)}
                  >
                    {r.plannedRoyalty == null ? '—' : fmtEur(r.plannedRoyalty)}
                  </TableCell>
                  <TableCell
                    className={cn('text-right tabular-nums', COL_BP_DEGRADED)}
                  >
                    {r.degradedRevenue == null
                      ? '—'
                      : fmtEur(r.degradedRevenue)}
                  </TableCell>
                  <TableCell
                    className={cn('text-right tabular-nums', COL_BP_DEGRADED)}
                  >
                    {r.degradedRoyalty == null
                      ? '—'
                      : fmtEur(r.degradedRoyalty)}
                  </TableCell>
                  <EditableCa
                    value={r.actualRevenue}
                    onSave={(c) => void addActual(r.quarter, c)}
                    className={COL_REAL}
                  />
                  <TableCell
                    className={cn('text-right tabular-nums', COL_REAL)}
                  >
                    {r.actualRoyalty == null ? '—' : fmtEur(r.actualRoyalty)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      r.gapAbs != null && signTone(r.gapAbs),
                    )}
                  >
                    {r.gapAbs == null
                      ? '—'
                      : `${r.gapAbs > 0 ? '+' : ''}${fmtEur(r.gapAbs)}`}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      r.gapAbs != null && signTone(r.gapAbs),
                    )}
                  >
                    {r.gapPct == null ? '—' : fmtPctSigned(r.gapPct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">
                  {t('fiche.royalty.cumul')}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', COL_BP_INITIAL)}
                >
                  {fmtEur(totals.plannedRevenue)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', COL_BP_INITIAL)}
                >
                  {fmtEur(totals.plannedRoyalty)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', COL_BP_DEGRADED)}
                >
                  {fmtEur(totals.degradedRevenue)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', COL_BP_DEGRADED)}
                >
                  {fmtEur(totals.degradedRoyalty)}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', COL_REAL)}>
                  {fmtEur(totals.actualRevenue)}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', COL_REAL)}>
                  {fmtEur(totals.actualRoyalty)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    signTone(totals.gapAbs),
                  )}
                >
                  {totals.gapAbs > 0 ? '+' : ''}
                  {fmtEur(totals.gapAbs)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        ) : (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {t('fiche.royalty.empty')}
          </p>
        )}
      </div>

      {/* Progress: cumulative actual royalties on the 0 → floor → cap scale.
          Pure positioning — only shown once floor/cap multiples and capital
          are entered. */}
      {floorAmount != null && capAmount != null && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {t('fiche.royalty.progressTitle')}
            </span>
            <span
              className={cn(
                'text-sm tabular-nums',
                reached && 'text-positive font-medium',
              )}
            >
              {fmtEur(cumul)}
              {reached && (
                <span className="ml-2 text-xs">
                  {t('fiche.royalty.progressReached')}
                </span>
              )}
            </span>
          </div>
          <div className="bg-muted relative h-3 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                reached ? 'bg-positive' : 'bg-primary',
              )}
              style={{
                width: `${capAmount > 0 ? Math.min(100, (cumul / capAmount) * 100) : 0}%`,
              }}
            />
            {capAmount > 0 && (
              <div
                className="bg-foreground/60 absolute inset-y-0 w-px"
                style={{
                  left: `${Math.min(100, (floorAmount / capAmount) * 100)}%`,
                }}
                aria-hidden
              />
            )}
          </div>
          <div className="flex justify-between text-xs tabular-nums">
            <span className={cn(reached && 'text-positive')}>
              {t('fiche.royalty.progressFloor')} · {fmtEur(floorAmount)} (
              {t('fiche.royalty.progressVsFloor', {
                pct: fmtRatioPct(floorAmount > 0 ? cumul / floorAmount : 0),
              })}
              )
            </span>
            <span className="text-muted-foreground">
              {t('fiche.royalty.progressCap')} · {fmtEur(capAmount)} (
              {t('fiche.royalty.progressVsCap', {
                pct: fmtRatioPct(capAmount > 0 ? cumul / capAmount : 0),
              })}
              )
            </span>
          </div>
        </div>
      )}

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
            <Input
              id="royalty-revenue"
              type="text"
              inputMode="decimal"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
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
