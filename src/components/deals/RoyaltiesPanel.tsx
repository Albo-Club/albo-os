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
  const { fmtEur } = useFormatters()
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

  const params = [
    { key: 'capitalInvested', value: fmtEur(deal.capitalInvested) },
    { key: 'depreciationRate', value: fmtPct(deal.depreciationRate) },
    { key: 'royaltyRate', value: fmtPct(deal.royaltyRate) },
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
                <TableHead colSpan={2} className="text-center">
                  {t('fiche.royalty.colBpInitial')}
                </TableHead>
                <TableHead colSpan={2} className="text-center">
                  {t('fiche.royalty.colBpDegraded')}
                </TableHead>
                <TableHead colSpan={2} className="text-center">
                  {t('fiche.royalty.colReal')}
                </TableHead>
                <TableHead colSpan={2} className="text-center">
                  {t('fiche.royalty.colGap')}
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-right">
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className="text-right">
                  {t('fiche.royalty.subRoyalties')}
                </TableHead>
                <TableHead className="text-right">
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className="text-right">
                  {t('fiche.royalty.subRoyalties')}
                </TableHead>
                <TableHead className="text-right">
                  {t('fiche.royalty.subCa')}
                </TableHead>
                <TableHead className="text-right">
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
                  <TableCell className="text-right tabular-nums">
                    {r.plannedRevenue == null ? '—' : fmtEur(r.plannedRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.plannedRoyalty == null ? '—' : fmtEur(r.plannedRoyalty)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.degradedRevenue == null
                      ? '—'
                      : fmtEur(r.degradedRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.degradedRoyalty == null
                      ? '—'
                      : fmtEur(r.degradedRoyalty)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.actualRevenue == null ? '—' : fmtEur(r.actualRevenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
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
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totals.plannedRevenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totals.plannedRoyalty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totals.degradedRevenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totals.degradedRoyalty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totals.actualRevenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
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
