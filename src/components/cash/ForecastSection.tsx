import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import { ForecastChart } from './ForecastChart'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
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

const HORIZONS = [6, 12, 24] as const
// L'expansion après sauvegarde couvre le plus grand horizon affichable.
const EXPAND_MONTHS = 24
// Profondeur de l'historique réel affiché en amont de la projection.
const HISTORY_MONTHS = 6
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
type Frequency = (typeof FREQUENCIES)[number]

type Rule = Doc<'forecastRules'>

function msToDateInput(ms: number | undefined): string {
  return ms == null ? '' : new Date(ms).toISOString().slice(0, 10)
}

/** "1 500" / "1500,50" (euros) → cents entiers, null si invalide. */
function parseEuros(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

function RuleDialog({
  orgId,
  rule,
  onClose,
  onSaved,
}: {
  orgId: Id<'organizations'>
  rule: Rule | null // null = création
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation(['cash', 'common'])
  const createRule = useConvexMutation(api.forecasts.createRule)
  const updateRule = useConvexMutation(api.forecasts.updateRule)

  const [label, setLabel] = useState(rule?.label ?? '')
  const [amount, setAmount] = useState(
    rule ? String(rule.amountCents / 100) : '',
  )
  const [direction, setDirection] = useState<'in' | 'out'>(
    rule?.direction ?? 'out',
  )
  const [frequency, setFrequency] = useState<Frequency>(
    rule?.frequency ?? 'monthly',
  )
  const [anchorDay, setAnchorDay] = useState(String(rule?.anchorDay ?? 1))
  const [startDate, setStartDate] = useState(
    msToDateInput(rule?.startDate ?? Date.now()),
  )
  const [endDate, setEndDate] = useState(msToDateInput(rule?.endDate))
  const [active, setActive] = useState(rule?.active ?? true)
  const [pending, setPending] = useState(false)

  const amountCents = parseEuros(amount)
  const anchor = Number(anchorDay)
  const maxAnchor = frequency === 'weekly' ? 7 : 31
  const startMs = startDate ? Date.parse(startDate) : NaN
  const endMs = endDate ? Date.parse(endDate) : undefined
  const invalid =
    !label.trim() ||
    amountCents == null ||
    !Number.isInteger(anchor) ||
    anchor < 1 ||
    anchor > maxAnchor ||
    Number.isNaN(startMs) ||
    (endMs != null && endMs < startMs)

  async function handleSave() {
    // TS narrowe amountCents (non-null) à travers l'alias `invalid`.
    if (invalid) return
    setPending(true)
    try {
      if (rule) {
        await updateRule({
          ruleId: rule._id,
          patch: {
            label: label.trim(),
            amountCents,
            direction,
            frequency,
            anchorDay: anchor,
            startDate: startMs,
            endDate: endMs,
            active,
          },
        })
      } else {
        await createRule({
          orgId,
          label: label.trim(),
          amountCents,
          direction,
          frequency,
          anchorDay: anchor,
          startDate: startMs,
          endDate: endMs,
        })
      }
      await onSaved()
      toast.success(t('cash:forecast.rules.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['invalid_amount', 'invalid_anchor_day', 'invalid_date_range']
      toast.error(
        t(
          known.includes(code)
            ? `cash:forecast.rules.errors.${code}`
            : 'cash:forecast.rules.errors.default',
        ),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? t('cash:forecast.rules.dialogTitleEdit')
              : t('cash:forecast.rules.dialogTitleCreate')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-label">
              {t('cash:forecast.rules.labelLabel')}
            </Label>
            <Input
              id="rule-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('cash:forecast.rules.labelPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-amount">
                {t('cash:forecast.rules.amountLabel')}
              </Label>
              <Input
                id="rule-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1 500"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('cash:forecast.rules.directionLabel')}</Label>
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as 'in' | 'out')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">
                    {t('cash:forecast.rules.in')}
                  </SelectItem>
                  <SelectItem value="out">
                    {t('cash:forecast.rules.out')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('cash:forecast.rules.frequencyLabel')}</Label>
              <Select
                value={frequency}
                onValueChange={(value) => setFrequency(value as Frequency)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {t(`cash:forecast.rules.frequency.${freq}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-anchor">
                {t('cash:forecast.rules.anchorDayLabel')}
              </Label>
              <Input
                id="rule-anchor"
                inputMode="numeric"
                value={anchorDay}
                onChange={(e) => setAnchorDay(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {frequency === 'weekly'
                  ? t('cash:forecast.rules.anchorDayHintWeekly')
                  : t('cash:forecast.rules.anchorDayHintMonthly')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-start">
                {t('cash:forecast.rules.startLabel')}
              </Label>
              <Input
                id="rule-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-end">
                {t('cash:forecast.rules.endLabel')}
              </Label>
              <Input
                id="rule-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {rule && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="rule-active"
                checked={active}
                onCheckedChange={(checked) => setActive(checked === true)}
              />
              <Label htmlFor="rule-active">
                {t('cash:forecast.rules.activeLabel')}
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={pending || invalid}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Prévisionnel de trésorerie : courbe du solde projeté (solde réel +
 * forecastEntries pending, via getForecastBalance) et CRUD des règles
 * récurrentes. Toute sauvegarde relance `expandRules` (idempotent par
 * derivedKey) pour que la courbe reflète immédiatement les règles.
 */
export function ForecastSection({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(12)
  const [dialogRule, setDialogRule] = useState<Rule | null | 'create'>(null)
  const [deleteRuleId, setDeleteRuleId] = useState<Id<'forecastRules'> | null>(
    null,
  )

  const balance = useConvexQuery(api.forecasts.getForecastBalance, {
    orgId,
    horizonMonths: horizon,
    historyMonths: HISTORY_MONTHS,
  })
  const rules = useConvexQuery(api.forecasts.listRules, { orgId })
  const expandRules = useConvexMutation(api.forecasts.expandRules)
  const deleteRule = useConvexMutation(api.forecasts.deleteRule)

  async function refreshEntries() {
    await expandRules({ orgId, horizonMonths: EXPAND_MONTHS })
  }

  async function handleDelete() {
    if (!deleteRuleId) return
    try {
      await deleteRule({ ruleId: deleteRuleId })
      toast.success(t('cash:forecast.rules.deleted'))
    } catch {
      toast.error(t('cash:forecast.rules.errors.default'))
    } finally {
      setDeleteRuleId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('cash:forecast.title')}
        </h2>
        <div className="flex items-center gap-2">
          <Select
            value={String(horizon)}
            onValueChange={(value) =>
              setHorizon(Number(value) as (typeof HORIZONS)[number])
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((months) => (
                <SelectItem key={months} value={String(months)}>
                  {t('cash:forecast.horizonMonths', { count: months })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogRule('create')}
          >
            <Plus className="size-4" />
            {t('cash:forecast.rules.add')}
          </Button>
        </div>
      </div>

      {!balance ? (
        <div className="text-muted-foreground text-sm">{t('cash:loading')}</div>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {t('cash:forecast.startingBalance', {
              amount: fmtEur(balance.startingBalanceCents),
            })}
          </p>
          <ForecastChart
            months={balance.months}
            history={balance.history}
            labels={{
              real: t('cash:forecast.chartReal'),
              projected: t('cash:forecast.chartLabel'),
            }}
            fmtEur={fmtEur}
          />
        </>
      )}

      <h3 className="text-sm font-semibold">{t('cash:forecast.rules.title')}</h3>
      {!rules ? (
        <div className="text-muted-foreground text-sm">{t('cash:loading')}</div>
      ) : rules.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('cash:forecast.rules.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cash:forecast.rules.col.label')}</TableHead>
                <TableHead className="text-right">
                  {t('cash:forecast.rules.col.amount')}
                </TableHead>
                <TableHead>{t('cash:forecast.rules.col.frequency')}</TableHead>
                <TableHead>{t('cash:forecast.rules.col.start')}</TableHead>
                <TableHead>{t('cash:forecast.rules.col.status')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule._id}>
                  <TableCell className="font-medium">{rule.label}</TableCell>
                  <TableCell
                    className={
                      rule.direction === 'out'
                        ? 'text-destructive text-right tabular-nums'
                        : 'text-right tabular-nums'
                    }
                  >
                    {rule.direction === 'out' ? '−' : '+'}
                    {fmtEur(rule.amountCents)}
                  </TableCell>
                  <TableCell>
                    {t(`cash:forecast.rules.frequency.${rule.frequency}`)}
                    {rule.interval > 1 ? ` ×${rule.interval}` : ''}
                    {' · '}
                    {t('cash:forecast.rules.day', { day: rule.anchorDay })}
                  </TableCell>
                  <TableCell>
                    {fmtDate(rule.startDate)}
                    {rule.endDate ? ` → ${fmtDate(rule.endDate)}` : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.active ? 'default' : 'secondary'}>
                      {rule.active
                        ? t('cash:forecast.rules.active')
                        : t('cash:forecast.rules.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => setDialogRule(rule)}
                        aria-label={t('common:actions.edit')}
                        title={t('common:actions.edit')}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        onClick={() => setDeleteRuleId(rule._id)}
                        aria-label={t('common:actions.delete')}
                        title={t('common:actions.delete')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogRule !== null && (
        <RuleDialog
          orgId={orgId}
          rule={dialogRule === 'create' ? null : dialogRule}
          onClose={() => setDialogRule(null)}
          onSaved={refreshEntries}
        />
      )}

      <Dialog
        open={deleteRuleId !== null}
        onOpenChange={(open) => !open && setDeleteRuleId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('cash:forecast.rules.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('cash:forecast.rules.deleteConfirmBody')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRuleId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
