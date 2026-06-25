import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronsUpDown,
  Eye,
  Info,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { api } from '../../../../convex/_generated/api'

import { INSTRUMENT_FIELDS } from '../../../../convex/lib/instrumentMapping'
import { ENUM_FIELD_VALUES } from '../../../../convex/lib/instruments'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import type { DealOption } from '~/components/pointage/DealCombobox'
import type { TxDetails } from '~/components/pointage/TransactionSheet'
import type { FieldFormat } from '~/components/deals/InstrumentBlock'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { directionBadgeClass, directionTone } from '~/lib/moneyTone'
import {
  useDealTitle,
  useFormatters,
} from '~/components/participations/ParticipationsTable'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'
import { FundSection } from '~/components/deals/FundSection'
import { FIELD_FORMAT, InstrumentBlock } from '~/components/deals/InstrumentBlock'
import { PlanVsActualSection } from '~/components/deals/PlanVsActualSection'
import {
  bpsToPctInput,
  centsToEurosInput,
  dateInputToMs,
  eurosToCents,
  intToNumber,
  msToDateInput,
  pctToBps,
} from '~/lib/parse'
import { cn } from '~/lib/utils'
import { CompanyLogo } from '~/components/CompanyLogo'
import { DealCombobox } from '~/components/pointage/DealCombobox'
import {
  TransactionSheet,
  useReportError,
} from '~/components/pointage/TransactionSheet'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { Label } from '~/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
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

export const Route = createFileRoute('/app/$orgSlug/deals/$dealId')({
  component: DealDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitleDeal'),
      },
    ],
  }),
})

type InstrumentKind = Doc<'deals'>['instrumentKind']

/** Values of the schema's `instrumentKind` enum (dropdown display order). */
const INSTRUMENTS = [
  'share',
  'bsa',
  'bsa_air',
  'safe',
  'oc',
  'os',
  'convertible_note',
  'cca',
  'royalty',
  'fund_lp',
  'spv_share',
  'secondary',
  'real_estate_direct',
  'scpi',
  'cto',
  'dat',
  'crypto',
  'loan',
  'capitalization_account',
] as const satisfies ReadonlyArray<InstrumentKind>

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

function NotFound() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/participations"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('dealNotFound')}</p>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/** Stored deal value → input string, in the UI unit of the field's format. */
function fieldToInput(deal: Doc<'deals'>, field: string): string {
  const raw = (deal as Record<string, unknown>)[field]
  if (raw == null) return ''
  switch (FIELD_FORMAT[field] ?? 'text') {
    case 'eur':
      return centsToEurosInput(raw as number)
    case 'pct':
      return bpsToPctInput(raw as number)
    case 'date':
      return msToDateInput(raw as number)
    default:
      return String(raw)
  }
}

/**
 * Input string → stored value. `undefined` = empty (left unchanged, never
 * sent), `null` = invalid (blocks the save), otherwise the parsed value in
 * the storage unit (cents / bps / ms / enum literal / text).
 */
function parseField(
  format: FieldFormat,
  value: string,
): number | string | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  switch (format) {
    case 'eur':
      return eurosToCents(trimmed)
    case 'pct':
      return pctToBps(trimmed)
    case 'date':
      return dateInputToMs(value)
    case 'number':
    case 'year':
      return intToNumber(trimmed)
    default:
      return trimmed
  }
}

/** One editable instrument field, rendered by its display format. */
function DealFieldInput({
  field,
  format,
  value,
  onChange,
}: {
  field: string
  format: FieldFormat
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('participations')
  const label = t(`field.${field}`, { defaultValue: field })
  const id = `deal-${field}`

  if (format === 'enum') {
    const options = ENUM_FIELD_VALUES[field] ?? []
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('edit.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`enum.${field}.${opt}`, { defaultValue: opt })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isNumeric =
    format === 'eur' ||
    format === 'pct' ||
    format === 'number' ||
    format === 'year'
  const inputType = format === 'date' ? 'date' : isNumeric ? 'number' : 'text'
  const step = format === 'eur' || format === 'pct' ? '0.01' : '1'

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={inputType}
        min={isNumeric ? '0' : undefined}
        step={isNumeric ? step : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * Deal edit dialog: custom name, instrument type, and the editable instrument
 * fields of the saved type (Lot 3). Inputs are typed by FIELD_FORMAT
 * (€ / % / date / enum / number) and parsed back to the storage unit on save.
 * Only changed fields are sent; `deals.update` marks them as manually edited
 * so the Airtable re-import leaves them untouched. `paidActual` (disbursed,
 * computed from transactions) never appears here — it stays read-only on the
 * sheet. Changing the instrument type is a no-op on the attached transactions.
 */
/** Minimal portfolio company shape for the target combobox. */
type CompanyOption = { _id: Id<'companies'>; name: string }

/**
 * Searchable combobox of the org's portfolio companies (Popover + Command),
 * to reassign a deal's target entity. Mirrors `DealCombobox`.
 */
function CompanyCombobox({
  companies,
  value,
  onSelect,
  disabled,
}: {
  companies: Array<CompanyOption> | undefined
  value: Id<'companies'>
  onSelect: (id: Id<'companies'>) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)
  const selected = companies?.find((c) => c._id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !companies}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected?.name ?? t('participations:edit.targetPlaceholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder={t('participations:edit.targetSearch')} />
          <CommandList>
            <CommandEmpty>{t('participations:edit.targetEmpty')}</CommandEmpty>
            <CommandGroup>
              {(companies ?? []).map((company) => (
                <CommandItem
                  key={company._id}
                  value={`${company.name} ${company._id}`}
                  onSelect={() => {
                    onSelect(company._id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'size-4',
                      company._id === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{company.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function EditDealDialog({
  deal,
  onClose,
}: {
  deal: Doc<'deals'>
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateDeal = useConvexMutation(api.deals.update)
  // Portfolio companies of the org (already filtered to non-archived).
  const companies = useConvexQuery(api.companies.list, {
    orgId: deal.orgId,
    kind: 'portfolio',
  })
  const [name, setName] = useState(deal.name ?? '')
  const [instrument, setInstrument] = useState<InstrumentKind>(
    deal.instrumentKind,
  )
  const [targetId, setTargetId] = useState<Id<'companies'>>(
    deal.targetCompanyId,
  )
  // Editable fields of the SAVED type (fixed in this lot — the type change
  // itself is Lot 3b). Values are strings in the display unit.
  const fields = INSTRUMENT_FIELDS[deal.instrumentKind] ?? []
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, fieldToInput(deal, f)])),
  )
  const [pending, setPending] = useState(false)

  // A non-empty input that fails to parse (e.g. letters in a € field) blocks
  // the save → no partial write.
  const valid = fields.every(
    (f) => parseField(FIELD_FORMAT[f] ?? 'text', values[f]) !== null,
  )

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      // Diff: send only changed fields. name '' clears it (server trims).
      const patch: Record<string, unknown> = {}
      if (name.trim() !== (deal.name ?? '')) patch.name = name
      if (instrument !== deal.instrumentKind) patch.instrumentKind = instrument
      if (targetId !== deal.targetCompanyId) patch.targetCompanyId = targetId
      for (const field of fields) {
        const parsed = parseField(FIELD_FORMAT[field] ?? 'text', values[field])
        if (parsed === undefined || parsed === null) continue
        if (parsed !== (deal as Record<string, unknown>)[field]) {
          patch[field] = parsed
        }
      }
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      await updateDeal({ id: deal._id, patch })
      toast.success(t('participations:edit.saved'))
      onClose()
    } catch {
      toast.error(t('participations:edit.errors.default'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('participations:edit.dealTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:edit.dealDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deal-name">
              {t('participations:edit.nameLabel')}
            </Label>
            <Input
              id="deal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('participations:edit.dealNamePlaceholder')}
            />
            <p className="text-muted-foreground text-xs">
              {t('participations:edit.dealNameHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t('participations:edit.instrumentLabel')}</Label>
            <Select
              value={instrument}
              onValueChange={(v) => setInstrument(v as InstrumentKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTRUMENTS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`participations:instrument.${kind}`, {
                      defaultValue: kind,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('participations:edit.targetLabel')}</Label>
            <CompanyCombobox
              companies={companies}
              value={targetId}
              onSelect={setTargetId}
              disabled={pending}
            />
            <p className="text-muted-foreground text-xs">
              {t('participations:edit.targetHint')}
            </p>
          </div>
          {instrument !== deal.instrumentKind && (
            <div
              role="status"
              className="border-chart-4/50 bg-chart-4/10 flex items-start gap-2 rounded-lg border px-3 py-2"
            >
              <Info className="text-chart-4 mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground text-xs">
                {t('participations:edit.typeChangeNotice', {
                  from: t(`participations:instrument.${deal.instrumentKind}`, {
                    defaultValue: deal.instrumentKind,
                  }),
                  to: t(`participations:instrument.${instrument}`, {
                    defaultValue: instrument,
                  }),
                })}
              </p>
            </div>
          )}
          {fields.length > 0 && (
            <div className="space-y-4 border-t pt-4">
              <p className="text-muted-foreground text-xs">
                {t('participations:edit.fieldsHint')}
              </p>
              {fields.map((field) => (
                <DealFieldInput
                  key={field}
                  field={field}
                  format={FIELD_FORMAT[field] ?? 'text'}
                  value={values[field]}
                  onChange={(v) =>
                    setValues((s) => ({ ...s, [field]: v }))
                  }
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid || pending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Fields of the current deal used by the transactions section. */
type CurrentDeal = {
  _id: Id<'deals'>
  orgId: Id<'organizations'>
  target: { name: string } | null
  investor: { name: string } | null
  instrumentKind: string
}

/** Combobox (current deal pre-selected) + "Reassign" button. */
function ReattachActions({
  deals,
  currentDeal,
  pending,
  onReattach,
}: {
  deals: Array<DealOption> | undefined
  currentDeal: DealOption
  pending: boolean
  onReattach: (deal: DealOption) => void
}) {
  const { t } = useTranslation('participations')
  const [deal, setDeal] = useState<DealOption | null>(currentDeal)
  return (
    <div className="flex items-center justify-end gap-2">
      <DealCombobox
        deals={deals}
        value={deal}
        onSelect={setDeal}
        disabled={pending}
      />
      <Button
        size="sm"
        disabled={!deal || deal._id === currentDeal._id || pending}
        onClick={() => deal && onReattach(deal)}
      >
        {t('tx.reattach')}
      </Button>
    </div>
  )
}

function Transactions({ deal }: { deal: CurrentDeal }) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const reportError = useReportError()
  const txs = useConvexQuery(api.transactions.listByDeal, { dealId: deal._id })

  const [sheetTx, setSheetTx] = useState<TxDetails | null>(null)
  const [pending, setPending] = useState(false)

  // Local display pagination (no upstream filter on this table).
  const { page, pageCount, setPage } = usePagination(txs?.length ?? 0, '')
  const pagedTxs = txs?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Org deals for the reassignment combobox — only loaded when the
  // sheet opens (lightweight names-only query, cf. deals.listOptions).
  const deals = useConvexQuery(
    api.deals.listOptions,
    sheetTx ? { orgId: deal.orgId } : 'skip',
  )
  const matchTransaction = useConvexMutation(api.transactions.matchTransaction)

  // Reassign = re-match the transaction onto the new deal via
  // `matchTransaction` (never write `dealId`/`matchStatus` directly).
  async function handleReattach(tx: TxDetails, newDeal: DealOption) {
    setPending(true)
    try {
      await matchTransaction({ transactionId: tx._id, dealId: newDeal._id })
      toast.success(t('tx.reattached', { deal: newDeal.target?.name ?? '—' }))
      // `listByDeal` is reactive: the transaction drops out of the list by itself.
      setSheetTx(null)
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{t('tx.title')}</h2>
      {!txs ? (
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      ) : txs.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('tx.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tx.col.date')}</TableHead>
                <TableHead>{t('tx.col.direction')}</TableHead>
                <TableHead className="text-right">
                  {t('tx.col.amount')}
                </TableHead>
                <TableHead>{t('tx.col.label')}</TableHead>
                <TableHead>{t('tx.col.counterparty')}</TableHead>
                <TableHead>{t('tx.col.account')}</TableHead>
                <TableHead>{t('tx.col.reconciled')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedTxs?.map((tx) => (
                <TableRow
                  key={tx._id}
                  className="cursor-pointer"
                  onClick={() => setSheetTx(tx)}
                >
                  <TableCell>{fmtDate(tx.transactionDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={directionBadgeClass(tx.direction === 'in')}
                    >
                      {t(`tx.${tx.direction}`)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${directionTone(tx.direction)}`}
                  >
                    {fmtEur(tx.amount)}
                  </TableCell>
                  <TableCell>{tx.rawLabel}</TableCell>
                  <TableCell>{tx.counterparty ?? '—'}</TableCell>
                  <TableCell>{tx.account?.label ?? '—'}</TableCell>
                  <TableCell>
                    {tx.reconciled ? t('tx.yes') : t('tx.no')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PaginationFooter
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />

      <TransactionSheet
        tx={sheetTx}
        onOpenChange={(open) => {
          if (!open) setSheetTx(null)
        }}
        footer={
          sheetTx && (
            <ReattachActions
              key={sheetTx._id}
              deals={deals}
              currentDeal={deal}
              pending={pending}
              onReattach={(newDeal) => void handleReattach(sheetTx, newDeal)}
            />
          )
        }
      />
    </section>
  )
}

/** Free-text notes for the deal, editable inline (read-only until the
    pencil is clicked). The notes field is also writable from the edit
    dialog's mutation — here we patch only `notes` so other fields stay put. */
function NotesSection({ deal }: { deal: Doc<'deals'> }) {
  const { t } = useTranslation(['participations', 'common'])
  const updateDeal = useConvexMutation(api.deals.update)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(deal.notes ?? '')
  const [pending, setPending] = useState(false)

  function startEdit() {
    // Reset the draft to the saved value each time (covers external updates).
    setValue(deal.notes ?? '')
    setEditing(true)
  }

  async function handleSave() {
    const next = value.trim()
    // No-op if unchanged. Empty string clears the note (display falls back to
    // the empty state); the saved field marks `notes` as manually edited.
    if (next === (deal.notes ?? '')) {
      setEditing(false)
      return
    }
    setPending(true)
    try {
      await updateDeal({ id: deal._id, patch: { notes: next } })
      toast.success(t('participations:edit.saved'))
      setEditing(false)
    } catch {
      toast.error(t('participations:edit.errors.default'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs">{t('deal.notes')}</span>
        {!editing && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={startEdit}
            aria-label={t('common:actions.edit')}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('participations:notes.placeholder')}
            rows={4}
            autoFocus
            disabled={pending}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={pending}
            >
              {t('common:actions.save')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              {t('common:actions.cancel')}
            </Button>
          </div>
        </div>
      ) : deal.notes ? (
        <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
      ) : (
        <p className="text-muted-foreground text-sm italic">
          {t('participations:notes.empty')}
        </p>
      )}
    </div>
  )
}

function DealDetail() {
  const { t } = useTranslation(['participations', 'common'])
  const { orgSlug, dealId } = Route.useParams()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Instrument-type preview: local-only, writes nothing (cf. Lot 3). null =
  // showing the saved type; any other value previews a layout.
  const [previewKind, setPreviewKind] = useState<InstrumentKind | null>(null)
  const removeDeal = useConvexMutation(api.deals.remove)
  const deal = useConvexQuery(api.deals.getById, {
    id: dealId as Id<'deals'>,
  })
  // Amounts computed from the attached transactions (same query as the
  // Transactions subcomponent — shared subscription, no double load).
  const txs = useConvexQuery(api.transactions.listByDeal, {
    dealId: dealId as Id<'deals'>,
  })
  const paidActual = txs?.reduce(
    (sum, tx) => (tx.direction === 'out' ? sum + tx.amount : sum),
    0,
  )
  const received = txs?.reduce(
    (sum, tx) => (tx.direction === 'in' ? sum + tx.amount : sum),
    0,
  )
  const { fmtEur } = useFormatters()
  const dealTitle = useDealTitle()

  // Reconciled transactions block deletion (invariant: matched ⟺ dealId,
  // so every row of listByDeal is a reconciled transaction).
  const linkedCount = txs?.length ?? 0

  async function handleDelete() {
    if (!deal) return
    setDeleting(true)
    try {
      await removeDeal({ id: deal._id })
      toast.success(t('participations:deleteDeal.deleted'))
      setDeleteOpen(false)
      // The deal no longer exists: leave the page (entity sheet or list).
      if (deal.target) {
        navigate({
          to: '/app/$orgSlug/participations/$companyId',
          params: { orgSlug, companyId: deal.target._id },
        })
      } else {
        navigate({ to: '/app/$orgSlug/participations', params: { orgSlug } })
      }
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        t(
          code === 'deal_has_transactions'
            ? 'participations:deleteDeal.errors.deal_has_transactions'
            : 'participations:deleteDeal.errors.default',
        ),
      )
    } finally {
      setDeleting(false)
    }
  }

  if (!deal) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      </main>
    )
  }

  // Previewed instrument type (local only) vs the one saved in DB.
  const effectiveKind = previewKind ?? deal.instrumentKind
  const unsaved = previewKind != null && previewKind !== deal.instrumentKind

  return (
    <main className="flex-1 space-y-6 p-6">
      {deal.target && (
        <Link
          to="/app/$orgSlug/participations/$companyId"
          params={{ orgSlug, companyId: deal.target._id }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {deal.target.name}
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* Name only: the instrument type sits in the selector below. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {dealTitle(deal, { withInstrument: false })}
        </h1>
        <Badge variant={statusVariant(deal.status)}>
          {t(`status.${deal.status}`, { defaultValue: deal.status })}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="ml-auto"
              aria-label={t('common:actions.menu')}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              {t('common:actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={linkedCount > 0}
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Instrument-type selector — previews the central block only. The
          change is local and never written to DB (the write lands in Lot 3). */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t('fiche.typeLabel')}
          </span>
          <Select
            value={effectiveKind}
            onValueChange={(v) => setPreviewKind(v as InstrumentKind)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSTRUMENTS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`instrument.${kind}`, { defaultValue: kind })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {unsaved && (
          <div
            role="status"
            className="border-chart-4/50 bg-chart-4/10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
          >
            <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="text-chart-4 size-4" />
              {t('fiche.preview.unsaved')}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('fiche.preview.note')}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setPreviewKind(null)}
            >
              {t('fiche.preview.reset')}
            </Button>
          </div>
        )}
      </div>

      {linkedCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {t('deleteDeal.blocked', { count: linkedCount })}
        </p>
      )}

      {/* Overview: commitment + actuals (computed from the transactions). */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label={t('deal.committed')} value={fmtEur(deal.committedAmount)} />
        <Stat label={t('deal.paid')} value={fmtEur(paidActual)} />
        <Stat label={t('deal.received')} value={fmtEur(received)} />
      </div>

      {/* Central block: layout driven by the previewed instrument type. */}
      <InstrumentBlock deal={deal} instrumentKind={effectiveKind} />

      <NotesSection deal={deal} />

      {deal.instrumentKind === 'fund_lp' && (
        <FundSection
          dealId={deal._id}
          committedAmount={deal.committedAmount}
          calledCents={paidActual}
          distributedCents={received}
        />
      )}

      <PlanVsActualSection
        dealId={deal._id}
        instrumentKind={deal.instrumentKind}
        txs={txs}
      />

      <Transactions deal={deal} />

      {/* Linked entity: card to the target company sheet. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('fiche.entity.title')}
        </h2>
        <Card>
          {deal.target ? (
            <Link
              to="/app/$orgSlug/participations/$companyId"
              params={{ orgSlug, companyId: deal.target._id }}
              className="group block"
              aria-label={deal.target.name}
            >
              <CardContent className="flex items-center gap-4">
                <CompanyLogo
                  domain={deal.target.domain}
                  companyName={deal.target.name}
                  size="lg"
                />
                <div className="flex-1 space-y-1">
                  <span className="font-medium underline-offset-4 group-hover:underline">
                    {deal.target.name}
                  </span>
                  <div className="text-muted-foreground text-xs">
                    {t('deal.investor')}: {deal.investor?.name ?? '—'}
                    {deal.spv ? (
                      <>
                        {' '}
                        · {t('deal.viaSpv')} {deal.spv.name}
                      </>
                    ) : null}
                  </div>
                </div>
                <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4" />
              </CardContent>
            </Link>
          ) : (
            <CardContent className="flex items-center gap-4">
              <CompanyLogo size="lg" />
              <div className="flex-1 space-y-1">
                <span className="text-muted-foreground text-sm">—</span>
                <div className="text-muted-foreground text-xs">
                  {t('deal.investor')}: {deal.investor?.name ?? '—'}
                  {deal.spv ? (
                    <>
                      {' '}
                      · {t('deal.viaSpv')} {deal.spv.name}
                    </>
                  ) : null}
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      </section>

      {/* Reporting / KPIs — reserved (deal-scoped reporting lands later). */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('fiche.reporting.title')}
        </h2>
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('fiche.reporting.body')}
        </div>
      </section>

      {/* Documents — reserved (deal-scoped documents land later). */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('fiche.documents.title')}
        </h2>
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('fiche.documents.body')}
        </div>
      </section>

      {editOpen && (
        <EditDealDialog deal={deal} onClose={() => setEditOpen(false)} />
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !open && setDeleteOpen(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteDeal.confirmTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('deleteDeal.confirmBody')}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
