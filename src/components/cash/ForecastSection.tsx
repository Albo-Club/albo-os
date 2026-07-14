import { useState } from 'react'
import { Ban, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import { SuggestedRulesCard } from './SuggestedRules'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { DealCombobox } from '~/components/pointage/DealCombobox'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { forecastCategories } from '~/lib/categories'
import { directionTone } from '~/lib/moneyTone'
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
import { AmountInput } from '~/components/ui/amount-input'
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

// Post-save expansion covers the largest displayable horizon.
const EXPAND_MONTHS = 24
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
type Frequency = (typeof FREQUENCIES)[number]

type Rule = Doc<'forecastRules'>

/** Prefill for a fresh rule (suggested-rules card) — create mode only. */
export type RulePrefill = {
  label: string
  amountCents: number
  direction: 'in' | 'out'
  category: string | null
  frequency: Frequency
  anchorDay: number
  startDate: number
}

function msToDateInput(ms: number | undefined): string {
  return ms == null ? '' : new Date(ms).toISOString().slice(0, 10)
}

/** "1 500" / "1500,50" / "5 580 €" (euros) → integer cents, null if invalid. */
function parseEuros(raw: string): number | null {
  const cleaned = raw.replace(/[\s€]/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

const NO_CATEGORY = 'none'

/**
 * Forecast category selector (rules + one-off entries): slugs scoped to
 * the direction (src/lib/categories.ts), labels from `common:categories`,
 * plus a "—" none option. A legacy free-text category (pre-slug rows)
 * shows as-is until re-selected.
 */
function ForecastCategorySelect({
  direction,
  value,
  onChange,
}: {
  direction: 'in' | 'out'
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('common')
  const options = forecastCategories(direction)
  const isLegacy = value !== NO_CATEGORY && !options.includes(value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>—</SelectItem>
        {isLegacy && <SelectItem value={value}>{value}</SelectItem>}
        {options.map((slug) => (
          <SelectItem key={slug} value={slug}>
            {t(`categories.${slug}`, { defaultValue: slug })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RuleDialog({
  orgId,
  rule,
  prefill,
  onClose,
  onSaved,
}: {
  orgId: Id<'organizations'>
  rule: Rule | null // null = create
  /** Initial values in create mode (suggested rule) — ignored when editing. */
  prefill?: RulePrefill | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation(['cash', 'common'])
  const createRule = useConvexMutation(api.forecasts.createRule)
  const updateRule = useConvexMutation(api.forecasts.updateRule)

  const initial = rule ?? prefill ?? null
  // Org deals for the optional deal link (lightweight names-only query).
  const deals = useConvexQuery(api.deals.listOptions, { orgId })
  const [dealId, setDealId] = useState<Id<'deals'> | null>(
    rule?.dealId ?? null,
  )
  const [label, setLabel] = useState(initial?.label ?? '')
  const [amount, setAmount] = useState(
    initial ? String(initial.amountCents / 100) : '',
  )
  const [direction, setDirection] = useState<'in' | 'out'>(
    initial?.direction ?? 'out',
  )
  const [category, setCategory] = useState(initial?.category ?? NO_CATEGORY)
  const [frequency, setFrequency] = useState<Frequency>(
    initial?.frequency ?? 'monthly',
  )
  const [anchorDay, setAnchorDay] = useState(String(initial?.anchorDay ?? 1))
  const [startDate, setStartDate] = useState(
    msToDateInput(initial?.startDate ?? Date.now()),
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
    // TS narrows amountCents (non-null) through the `invalid` alias.
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
            // null clears a previously set category ("—" selected).
            category: category === NO_CATEGORY ? null : category,
            // null unlinks the deal (same wire convention as category).
            dealId,
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
          category: category === NO_CATEGORY ? undefined : category,
          dealId: dealId ?? undefined,
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
              <AmountInput
                id="rule-amount"
                value={amount}
                onChange={setAmount}
                placeholder="1 500"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('cash:forecast.rules.directionLabel')}</Label>
              <Select
                value={direction}
                onValueChange={(value) => {
                  const next = value as 'in' | 'out'
                  setDirection(next)
                  // The category lists differ per direction — drop a slug
                  // that no longer applies.
                  if (
                    category !== NO_CATEGORY &&
                    !forecastCategories(next).includes(category)
                  ) {
                    setCategory(NO_CATEGORY)
                  }
                }}
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
          <div className="space-y-2">
            <Label>{t('cash:forecast.rules.categoryLabel')}</Label>
            <ForecastCategorySelect
              direction={direction}
              value={category}
              onChange={setCategory}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('cash:forecast.dealLabel')}</Label>
            <DealCombobox
              deals={deals}
              value={deals?.find((d) => d._id === dealId) ?? null}
              onSelect={(deal) => setDealId(deal?._id ?? null)}
            />
            <p className="text-muted-foreground text-xs">
              {t('cash:forecast.dealHint')}
            </p>
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
 * CRUD for recurring forecast rules (cash in/out — the « prévisionnel »).
 * Every save re-runs `expandRules` (idempotent per derivedKey) so the curve
 * reflects the rules. Shown lower in the Cash « Aperçu » tab.
 */
export function ForecastRulesSection({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const [dialogRule, setDialogRule] = useState<Rule | null | 'create'>(null)
  // Prefill of the create dialog when opened from a suggested rule.
  const [dialogPrefill, setDialogPrefill] = useState<RulePrefill | null>(null)
  const [deleteRuleId, setDeleteRuleId] = useState<Id<'forecastRules'> | null>(
    null,
  )

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
        <h3 className="text-sm font-semibold">
          {t('cash:forecast.rules.title')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogRule('create')}
        >
          <Plus className="size-4" />
          {t('cash:forecast.rules.add')}
        </Button>
      </div>
      <SuggestedRulesCard
        orgId={orgId}
        onCreate={(prefill) => {
          setDialogPrefill(prefill)
          setDialogRule('create')
        }}
      />
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
                    className={`text-right tabular-nums ${directionTone(rule.direction)}`}
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
          prefill={dialogPrefill}
          onClose={() => {
            setDialogRule(null)
            setDialogPrefill(null)
          }}
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

type Entry = Doc<'forecastEntries'>

const CONFIDENCES = ['confirmed', 'expected', 'probable'] as const
type Confidence = (typeof CONFIDENCES)[number]

// Badge tone per confidence / lifecycle status (shadcn badge variants).
const CONFIDENCE_VARIANT = {
  confirmed: 'default',
  expected: 'secondary',
  probable: 'outline',
} as const
const STATUS_VARIANT = {
  pending: 'default',
  realized: 'secondary',
  cancelled: 'outline',
} as const

function EntryDialog({
  orgId,
  entry,
  onClose,
}: {
  orgId: Id<'organizations'>
  entry: Entry | null // null = create
  onClose: () => void
}) {
  const { t } = useTranslation(['cash', 'common'])
  const createManualEntry = useConvexMutation(api.forecasts.createManualEntry)
  const updateEntry = useConvexMutation(api.forecasts.updateEntry)

  // Org deals for the optional deal link (shared subscription with the
  // rule dialog — same query + args).
  const deals = useConvexQuery(api.deals.listOptions, { orgId })
  const [dealId, setDealId] = useState<Id<'deals'> | null>(
    entry?.dealId ?? null,
  )
  const [label, setLabel] = useState(entry?.label ?? '')
  const [amount, setAmount] = useState(
    entry ? String(entry.amountCents / 100) : '',
  )
  const [direction, setDirection] = useState<'in' | 'out'>(
    entry?.direction ?? 'out',
  )
  const [date, setDate] = useState(msToDateInput(entry?.date ?? Date.now()))
  const [confidence, setConfidence] = useState<Confidence>(
    entry?.confidence ?? 'confirmed',
  )
  const [category, setCategory] = useState(entry?.category ?? NO_CATEGORY)
  const [pending, setPending] = useState(false)

  const amountCents = parseEuros(amount)
  const dateMs = date ? Date.parse(date) : NaN
  const invalid = !label.trim() || amountCents == null || Number.isNaN(dateMs)

  async function handleSave() {
    // TS narrows amountCents (non-null) through the `invalid` alias.
    if (invalid) return
    setPending(true)
    try {
      if (entry) {
        await updateEntry({
          entryId: entry._id,
          patch: {
            label: label.trim(),
            amountCents,
            direction,
            confidence,
            date: dateMs,
            // null clears a previously set category ("—" selected).
            category: category === NO_CATEGORY ? null : category,
            // null unlinks the deal (same wire convention as category).
            dealId,
          },
        })
      } else {
        await createManualEntry({
          orgId,
          label: label.trim(),
          amountCents,
          direction,
          confidence,
          date: dateMs,
          category: category === NO_CATEGORY ? undefined : category,
          dealId: dealId ?? undefined,
        })
      }
      toast.success(t('cash:forecast.entries.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['invalid_amount', 'invalid_date']
      toast.error(
        t(
          known.includes(code)
            ? `cash:forecast.entries.errors.${code}`
            : 'cash:forecast.entries.errors.default',
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
            {entry
              ? t('cash:forecast.entries.dialogTitleEdit')
              : t('cash:forecast.entries.dialogTitleCreate')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entry-label">
              {t('cash:forecast.entries.labelLabel')}
            </Label>
            <Input
              id="entry-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('cash:forecast.entries.labelPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="entry-amount">
                {t('cash:forecast.entries.amountLabel')}
              </Label>
              <Input
                id="entry-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1 500"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('cash:forecast.entries.directionLabel')}</Label>
              <Select
                value={direction}
                onValueChange={(value) => {
                  const next = value as 'in' | 'out'
                  setDirection(next)
                  // The category lists differ per direction — drop a slug
                  // that no longer applies.
                  if (
                    category !== NO_CATEGORY &&
                    !forecastCategories(next).includes(category)
                  ) {
                    setCategory(NO_CATEGORY)
                  }
                }}
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
              <Label htmlFor="entry-date">
                {t('cash:forecast.entries.dateLabel')}
              </Label>
              <Input
                id="entry-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('cash:forecast.entries.confidenceLabel')}</Label>
              <Select
                value={confidence}
                onValueChange={(value) => setConfidence(value as Confidence)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONFIDENCES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`cash:forecast.entries.confidence.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('cash:forecast.entries.categoryLabel')}</Label>
            <ForecastCategorySelect
              direction={direction}
              value={category}
              onChange={setCategory}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('cash:forecast.dealLabel')}</Label>
            <DealCombobox
              deals={deals}
              value={deals?.find((d) => d._id === dealId) ?? null}
              onSelect={(deal) => setDealId(deal?._id ?? null)}
            />
            <p className="text-muted-foreground text-xs">
              {t('cash:forecast.dealHint')}
            </p>
          </div>
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
 * CRUD for one-off forecast entries (`ruleId == null` — exceptional cash
 * flows: capital calls, distributions, one-shot taxes, disposals). Writes
 * land straight in `forecastEntries`; Convex reactivity refreshes both this
 * table and the projection curve, so no `expandRules` call is needed. Shown
 * just below the recurring rules in the Cash « Aperçu » tab.
 */
export function ForecastEntriesSection({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const [dialogEntry, setDialogEntry] = useState<Entry | null | 'create'>(null)
  const [cancelId, setCancelId] = useState<Id<'forecastEntries'> | null>(null)

  const entries = useConvexQuery(api.forecasts.listEntries, { orgId })
  const cancelEntry = useConvexMutation(api.forecasts.cancelEntry)

  async function handleCancel() {
    if (!cancelId) return
    try {
      await cancelEntry({ entryId: cancelId })
      toast.success(t('cash:forecast.entries.cancelled'))
    } catch {
      toast.error(t('cash:forecast.entries.errors.default'))
    } finally {
      setCancelId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">
          {t('cash:forecast.entries.title')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogEntry('create')}
        >
          <Plus className="size-4" />
          {t('cash:forecast.entries.add')}
        </Button>
      </div>
      {!entries ? (
        <div className="text-muted-foreground text-sm">{t('cash:loading')}</div>
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('cash:forecast.entries.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cash:forecast.entries.col.date')}</TableHead>
                <TableHead>{t('cash:forecast.entries.col.label')}</TableHead>
                <TableHead className="text-right">
                  {t('cash:forecast.entries.col.amount')}
                </TableHead>
                <TableHead>
                  {t('cash:forecast.entries.col.confidence')}
                </TableHead>
                <TableHead>{t('cash:forecast.entries.col.status')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                // pending in full ink; realized/cancelled attenuated.
                const rowClass =
                  entry.status === 'cancelled'
                    ? 'text-muted-foreground line-through'
                    : entry.status === 'realized'
                      ? 'text-muted-foreground'
                      : ''
                return (
                  <TableRow key={entry._id} className={rowClass}>
                    <TableCell>{fmtDate(entry.date)}</TableCell>
                    <TableCell className="font-medium">{entry.label}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        entry.status === 'pending'
                          ? directionTone(entry.direction)
                          : ''
                      }`}
                    >
                      {entry.direction === 'out' ? '−' : '+'}
                      {fmtEur(entry.amountCents)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CONFIDENCE_VARIANT[entry.confidence]}>
                        {t(
                          `cash:forecast.entries.confidence.${entry.confidence}`,
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[entry.status]}>
                        {t(`cash:forecast.entries.status.${entry.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.status === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => setDialogEntry(entry)}
                            aria-label={t('common:actions.edit')}
                            title={t('common:actions.edit')}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive size-7"
                            onClick={() => setCancelId(entry._id)}
                            aria-label={t('cash:forecast.entries.cancelAction')}
                            title={t('cash:forecast.entries.cancelAction')}
                          >
                            <Ban className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogEntry !== null && (
        <EntryDialog
          orgId={orgId}
          entry={dialogEntry === 'create' ? null : dialogEntry}
          onClose={() => setDialogEntry(null)}
        />
      )}

      <Dialog
        open={cancelId !== null}
        onOpenChange={(open) => !open && setCancelId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('cash:forecast.entries.cancelConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('cash:forecast.entries.cancelConfirmBody')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleCancel()}>
              {t('cash:forecast.entries.cancelAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
