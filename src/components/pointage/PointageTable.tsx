import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { TargetCombobox } from './TargetCombobox'
import {
  TransactionSheet,
  accountLabel,
  useFormatters,
  useReportError,
} from './TransactionSheet'

import type { Id } from '../../../convex/_generated/dataModel'
import type { DealOption } from './DealCombobox'
import type { PointageTarget } from './TargetCombobox'
import type { LiabilityOptionGroups } from '~/lib/liabilityOptions'
import type { TxDetails } from './TransactionSheet'
import { DEFAULT_VAT_RATE_BPS, VAT_RATES_BPS, vatCentsFromTtc } from '~/lib/vat'
import { directionTone } from '~/lib/moneyTone'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
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

/** Minimal shape of an unmatched transaction (return of `listUnmatched`). */
export type UnmatchedTx = TxDetails

/** Display duration of the « Annuler » banner after a match/discard. */
const UNDO_DELAY_MS = 5000

/** Rows rendered per page (local pagination of the pointage tables). */
const PAGE_SIZE = 50

/** « Écarté » fates: ignored, charge, tax, product or internal transfer. */
type DiscardKind =
  | 'ignored'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

/** Statuses eligible for bulk categorization (never Match nor Ignore). */
type BulkStatus = 'charge' | 'tax' | 'product' | 'internal_transfer'

/** i18n keys of the bulk confirmation dialog, per status. */
const bulkConfirmKeys: Record<BulkStatus, { title: string; body: string }> = {
  charge: { title: 'bulk.confirmCharge', body: 'bulk.confirmBodyCharge' },
  tax: { title: 'bulk.confirmTax', body: 'bulk.confirmBodyTax' },
  product: { title: 'bulk.confirmProduct', body: 'bulk.confirmBodyProduct' },
  internal_transfer: {
    title: 'bulk.confirmInternalTransfer',
    body: 'bulk.confirmBodyInternalTransfer',
  },
}

type RecentAction = {
  tx: UnmatchedTx
  // `matched` = attached to a deal, `allocated` = allocated to a liability
  // (undo goes through deallocateTransaction, not unmatchTransaction).
  kind: 'matched' | 'allocated' | DiscardKind
  targetName?: string
}

/** Target combobox (deal / liability) + Match + « Écarter » menu. */
function RowActions({
  deals,
  liabilityOptions,
  pending,
  onMatch,
  onDiscard,
}: {
  deals: Array<DealOption> | undefined
  liabilityOptions: LiabilityOptionGroups | undefined
  pending: boolean
  onMatch: (target: PointageTarget) => void
  onDiscard: (kind: DiscardKind) => void
}) {
  const { t } = useTranslation('pointage')
  const [target, setTarget] = useState<PointageTarget | null>(null)
  return (
    <div className="flex items-center justify-end gap-2">
      <TargetCombobox
        deals={deals}
        equityOptions={liabilityOptions?.equityOptions}
        loanOptions={liabilityOptions?.loanOptions}
        value={target}
        onSelect={setTarget}
        disabled={pending}
      />
      <Button
        size="sm"
        disabled={!target || pending}
        onClick={() => target && onMatch(target)}
      >
        {t('actions.match')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            {t('actions.discard')}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onDiscard('ignored')}>
            {t('actions.ignore')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDiscard('charge')}>
            {t('actions.charge')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDiscard('tax')}>
            {t('actions.tax')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDiscard('product')}>
            {t('actions.product')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDiscard('internal_transfer')}>
            {t('actions.internal_transfer')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Transient « Rattachée à {cible} · Annuler » / « Ignorée · Annuler »
 * / « Classée en charge/impôt/produit/virement interne · Annuler » banner.
 */
function UndoBanner({
  recent,
  pending,
  onUndo,
}: {
  recent: RecentAction
  pending: boolean
  onUndo: () => void
}) {
  const { t } = useTranslation('pointage')
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-muted-foreground text-sm">
        {recent.kind === 'matched' || recent.kind === 'allocated'
          ? t('banner.matched', { deal: recent.targetName ?? '—' })
          : t(`banner.${recent.kind}`)}
      </span>
      <Button size="sm" variant="outline" disabled={pending} onClick={onUndo}>
        {t('actions.undo')}
      </Button>
    </div>
  )
}

/**
 * Local display pagination: the list stays complete client-side (the
 * counter, the bulk selection and its pruning operate on everything; search
 * and tabs filter server-side, upstream), only the rendering is split into
 * pages of PAGE_SIZE rows — it's the number of mounted rows (combobox,
 * menus, per-row checkboxes) that slows the page down, not the data.
 * `resetKey` returns to the first page (search or tab change); the current
 * page is clamped when the list shrinks (matched/discarded rows).
 */
function usePagination(totalRows: number, resetKey: string) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  return { page: Math.min(page, pageCount - 1), pageCount, setPage }
}

/** « Page X sur Y » bar + previous/next, hidden when there is a single page. */
function PaginationFooter({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation('common')
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 py-3">
      <span className="text-muted-foreground text-sm tabular-nums">
        {t('pagination.pageOf', { current: page + 1, total: pageCount })}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        <span className="sr-only">{t('pagination.previous')}</span>
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        <span className="sr-only">{t('pagination.next')}</span>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

/**
 * Matching table: `unmatched` transactions sorted by date desc, per-row
 * actions (match to a deal OR to a liability target — equity / C/C —,
 * discard as ignored/charge/tax/product/internal transfer), detail sheet on
 * click, and a transient « Annuler » banner (~5 s) after each action — which
 * calls `unmatchTransaction` (deal/discarded) or `deallocateTransaction`
 * (liability). Bulk categorization via the checkboxes: selection bar →
 * Charge/Tax/Product/Internal transfer → confirmation →
 * `bulkCategorize` (a single server call) + grouped « Annuler » toast.
 * The page never writes `matchStatus`/`reconciled` directly: everything
 * goes through the backend mutations. Rendering is paginated locally
 * (cf. `usePagination`).
 */
export function PointageTable({
  transactions,
  deals,
  liabilityOptions,
  emptyMessage,
  pageResetKey,
}: {
  transactions: Array<UnmatchedTx> | undefined
  deals: Array<DealOption> | undefined
  /** Liability targets (equity / C/C) of the org, built by the page. */
  liabilityOptions: LiabilityOptionGroups | undefined
  /** Alternative empty-state message (e.g. search with no results). */
  emptyMessage?: string
  /** Resets the pagination to the first page when this key changes. */
  pageResetKey: string
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()

  const matchTransaction = useConvexMutation(api.transactions.matchTransaction)
  const allocateTransaction = useConvexMutation(
    api.liabilities.allocateTransaction,
  )
  const deallocateTransaction = useConvexMutation(
    api.liabilities.deallocateTransaction,
  )
  const ignoreTransaction = useConvexMutation(
    api.transactions.ignoreTransaction,
  )
  const categorizeAsCharge = useConvexMutation(
    api.transactions.categorizeAsCharge,
  )
  const categorizeAsTax = useConvexMutation(api.transactions.categorizeAsTax)
  const categorizeAsProduct = useConvexMutation(
    api.transactions.categorizeAsProduct,
  )
  const categorizeAsInternalTransfer = useConvexMutation(
    api.transactions.categorizeAsInternalTransfer,
  )
  const unmatchTransaction = useConvexMutation(
    api.transactions.unmatchTransaction,
  )
  const bulkCategorize = useConvexMutation(api.transactions.bulkCategorize)

  const discardMutations = {
    ignored: ignoreTransaction,
    charge: categorizeAsCharge,
    tax: categorizeAsTax,
    product: categorizeAsProduct,
    internal_transfer: categorizeAsInternalTransfer,
  }

  const [recent, setRecent] = useState<Array<RecentAction>>([])
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)
  const [sheetTx, setSheetTx] = useState<UnmatchedTx | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<Id<'transactions'>>>(
    () => new Set(),
  )
  const [bulkPending, setBulkPending] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState<BulkStatus | null>(null)
  const timeoutsRef = useRef(
    new Map<Id<'transactions'>, ReturnType<typeof setTimeout>>(),
  )

  // Prune the selection of transactions that left the queue (Convex
  // reactivity after categorization, matching by another user…).
  useEffect(() => {
    if (!transactions) return
    setSelectedIds((prev) => {
      const valid = new Set(transactions.map((tx) => tx._id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [transactions])

  // Clean up the « Annuler » undo-banner timers on unmount.
  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout)
    }
  }, [])

  function removeRecent(txId: Id<'transactions'>) {
    const timeout = timeoutsRef.current.get(txId)
    if (timeout) clearTimeout(timeout)
    timeoutsRef.current.delete(txId)
    setRecent((prev) => prev.filter((r) => r.tx._id !== txId))
  }

  function addRecent(action: RecentAction) {
    removeRecent(action.tx._id)
    setRecent((prev) => [...prev, action])
    timeoutsRef.current.set(
      action.tx._id,
      setTimeout(() => removeRecent(action.tx._id), UNDO_DELAY_MS),
    )
  }

  async function handleMatch(tx: UnmatchedTx, target: PointageTarget) {
    setPendingId(tx._id)
    try {
      if (target.kind === 'deal') {
        await matchTransaction({
          transactionId: tx._id,
          dealId: target.deal._id,
        })
        addRecent({
          tx,
          kind: 'matched',
          targetName: target.deal.target?.name ?? '—',
        })
      } else {
        await allocateTransaction({
          transactionId: tx._id,
          kind: target.liability.kind,
          targetId: target.liability.targetId,
        })
        addRecent({ tx, kind: 'allocated', targetName: target.liability.label })
      }
      setSheetTx((cur) => (cur?._id === tx._id ? null : cur))
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  async function handleDiscard(tx: UnmatchedTx, kind: DiscardKind) {
    setPendingId(tx._id)
    try {
      // A charge starts with a default 20% VAT rate, adjustable later in
      // the Charges tab (setVatRate).
      if (kind === 'charge') {
        await categorizeAsCharge({
          transactionId: tx._id,
          vatRateBps: DEFAULT_VAT_RATE_BPS,
        })
      } else {
        await discardMutations[kind]({ transactionId: tx._id })
      }
      addRecent({ tx, kind })
      setSheetTx((cur) => (cur?._id === tx._id ? null : cur))
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  async function handleUndo(action: RecentAction) {
    const tx = action.tx
    setPendingId(tx._id)
    try {
      // A liability allocation is undone via deallocateTransaction (a deal
      // unmatch on a liability-allocated tx is rejected by the backend).
      if (action.kind === 'allocated') {
        await deallocateTransaction({ transactionId: tx._id })
      } else {
        await unmatchTransaction({ transactionId: tx._id })
      }
      // The reactive query re-includes the row; remove the banner after the
      // mutation returns to avoid any flicker.
      removeRecent(tx._id)
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  function toggleSelected(txId: Id<'transactions'>) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(txId)) next.delete(txId)
      else next.add(txId)
      return next
    })
  }

  // Grouped undo: front-side loop of `unmatchTransaction` (low volume —
  // only the ids of the batch that was just categorized).
  async function handleBulkUndo(ids: Array<Id<'transactions'>>) {
    try {
      await Promise.all(
        ids.map((transactionId) => unmatchTransaction({ transactionId })),
      )
    } catch (err) {
      reportError(err)
    }
  }

  // Bulk categorization: a SINGLE server call for the whole batch. The rows
  // leave the queue via Convex reactivity on `listUnmatched` once classed.
  async function handleBulkCategorize(status: BulkStatus) {
    const ids = [...selectedIds]
    setBulkPending(true)
    try {
      const result = await bulkCategorize({
        transactionIds: ids,
        status,
        vatRateBps: status === 'charge' ? DEFAULT_VAT_RATE_BPS : undefined,
      })
      setSelectedIds(new Set())
      if (result.succeeded.length > 0) {
        toast(t(`bulk.banner.${status}`, { count: result.succeeded.length }), {
          action: {
            label: t('actions.undo'),
            onClick: () => void handleBulkUndo(result.succeeded),
          },
          duration: UNDO_DELAY_MS,
        })
      }
      if (result.failed.length > 0) {
        console.error('bulkCategorize failures', result.failed)
        toast.error(t('bulk.failed', { count: result.failed.length }))
      }
    } catch (err) {
      reportError(err)
    } finally {
      setBulkPending(false)
    }
  }

  // Displayed rows = `unmatched` transactions (query) + recently
  // matched/discarded rows (local state, while the « Annuler » banner shows).
  const rows = useMemo(() => {
    if (!transactions) return undefined
    const recentById = new Map(recent.map((r) => [r.tx._id, r]))
    const merged = transactions.map((tx) => ({
      tx,
      recent: recentById.get(tx._id),
    }))
    for (const r of recent) {
      if (!transactions.some((tx) => tx._id === r.tx._id)) {
        merged.push({ tx: r.tx, recent: r })
      }
    }
    merged.sort((a, b) => b.tx.transactionDate - a.tx.transactionDate)
    return merged
  }, [transactions, recent])

  const { page, pageCount, setPage } = usePagination(
    rows?.length ?? 0,
    pageResetKey,
  )
  const pagedRows = rows?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const sheetRecent = sheetTx
    ? recent.find((r) => r.tx._id === sheetTx._id)
    : undefined

  if (rows && rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {emptyMessage ?? t('empty')}
      </div>
    )
  }

  return (
    <>
      {selectedIds.size > 0 && (
        <div className="bg-muted/40 mb-3 flex items-center justify-between rounded-lg border px-4 py-2">
          <span className="text-sm font-medium">
            {t('bulk.selected', { count: selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkPending}
              onClick={() => setSelectedIds(new Set())}
            >
              {t('bulk.deselect')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkPending}
              onClick={() => setConfirmStatus('charge')}
            >
              {t('actions.charge')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkPending}
              onClick={() => setConfirmStatus('tax')}
            >
              {t('actions.tax')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkPending}
              onClick={() => setConfirmStatus('product')}
            >
              {t('actions.product')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkPending}
              onClick={() => setConfirmStatus('internal_transfer')}
            >
              {t('actions.internal_transfer')}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{t('col.date')}</TableHead>
              <TableHead>{t('col.label')}</TableHead>
              <TableHead className="text-right">{t('col.amount')}</TableHead>
              <TableHead>{t('col.account')}</TableHead>
              <TableHead className="text-right">{t('col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pagedRows ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map(({ tx, recent: recentAction }) => (
                <TableRow
                  key={tx._id}
                  className={`cursor-pointer ${recentAction ? 'bg-muted/40' : ''}`}
                  onClick={() => setSheetTx(tx)}
                >
                  <TableCell
                    className="w-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!recentAction && (
                      <Checkbox
                        checked={selectedIds.has(tx._id)}
                        onCheckedChange={() => toggleSelected(tx._id)}
                        disabled={bulkPending}
                        aria-label={t('bulk.select')}
                      />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {fmtDate(tx.transactionDate)}
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-md truncate">
                      {tx.rawLabel}
                    </span>
                    {tx.counterparty && (
                      <span className="text-muted-foreground block max-w-md truncate text-xs">
                        {tx.counterparty}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${directionTone(tx.direction)}`}
                  >
                    {fmtSigned(tx.amount, tx.direction)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {accountLabel(tx)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {recentAction ? (
                      <UndoBanner
                        recent={recentAction}
                        pending={pendingId === tx._id}
                        onUndo={() => void handleUndo(recentAction)}
                      />
                    ) : (
                      <RowActions
                        deals={deals}
                        liabilityOptions={liabilityOptions}
                        pending={pendingId === tx._id}
                        onMatch={(target) => void handleMatch(tx, target)}
                        onDiscard={(kind) => void handleDiscard(tx, kind)}
                      />
                    )}
                  </TableCell>
                </TableRow>
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

      <TransactionSheet
        tx={sheetTx}
        onOpenChange={(open) => {
          if (!open) setSheetTx(null)
        }}
        footer={
          sheetTx &&
          (sheetRecent ? (
            <UndoBanner
              recent={sheetRecent}
              pending={pendingId === sheetTx._id}
              onUndo={() => void handleUndo(sheetRecent)}
            />
          ) : (
            <RowActions
              deals={deals}
              liabilityOptions={liabilityOptions}
              pending={pendingId === sheetTx._id}
              onMatch={(target) => void handleMatch(sheetTx, target)}
              onDiscard={(kind) => void handleDiscard(sheetTx, kind)}
            />
          ))
        }
      />

      <AlertDialog
        open={confirmStatus !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmStatus(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(bulkConfirmKeys[confirmStatus ?? 'charge'].title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(bulkConfirmKeys[confirmStatus ?? 'charge'].body, {
                count: selectedIds.size,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>
              {t('bulk.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkPending}
              onClick={() => {
                if (confirmStatus) void handleBulkCategorize(confirmStatus)
              }}
            >
              {t('bulk.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * VAT rate selector for a charge/product row (« À qualifier » /
 * 0% / 5.5% / 10% / 20%) → `setVatRate`. The VAT amount derived from the
 * tax-inclusive total shows below the selector once a rate is set.
 */
function VatRateSelect({
  tx,
  pending,
  onChange,
}: {
  tx: UnmatchedTx
  pending: boolean
  onChange: (vatRateBps: number | null) => void
}) {
  const { t, i18n } = useTranslation('pointage')
  const fmtRate = (bps: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(bps / 10000)
  const fmtEur = (cents: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
    }).format(cents / 100)

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Select
        value={tx.vatRateBps != null ? String(tx.vatRateBps) : 'unset'}
        disabled={pending}
        onValueChange={(value) =>
          onChange(value === 'unset' ? null : Number(value))
        }
      >
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unset">{t('vat.toQualify')}</SelectItem>
          {VAT_RATES_BPS.map((bps) => (
            <SelectItem key={bps} value={String(bps)}>
              {fmtRate(bps)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tx.vatRateBps != null && tx.vatRateBps > 0 && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {t('vat.amount', {
            amount: fmtEur(vatCentsFromTtc(tx.amount, tx.vatRateBps)),
          })}
        </span>
      )}
    </div>
  )
}

/**
 * Read-only view of the discarded transactions (charges / taxes / products
 * / internal transfers): table fed by `listByStatus`, with a per-row
 * « Annuler » action (→ `unmatchTransaction`, the transaction goes back to
 * the « À pointer » queue). On the Charges/Products tabs (`vatEditable`),
 * a VAT column qualifies each row's rate (deductible/collected VAT — see
 * the « TVA récupérable » card on the Treasury page). Rendering is
 * paginated locally (cf. `usePagination`).
 */
export function DiscardedTable({
  transactions,
  emptyMessage,
  vatEditable = false,
  pageResetKey,
}: {
  transactions: Array<UnmatchedTx> | undefined
  /** Alternative empty-state message (e.g. search with no results). */
  emptyMessage?: string
  /** Shows the VAT column (Charges and Products tabs only). */
  vatEditable?: boolean
  /** Resets the pagination to the first page when this key changes. */
  pageResetKey: string
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()

  const unmatchTransaction = useConvexMutation(
    api.transactions.unmatchTransaction,
  )
  const setVatRate = useConvexMutation(api.transactions.setVatRate)
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)

  const { page, pageCount, setPage } = usePagination(
    transactions?.length ?? 0,
    pageResetKey,
  )
  const pagedTransactions = transactions?.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  async function handleUndo(tx: UnmatchedTx) {
    setPendingId(tx._id)
    try {
      // The reactive query removes the row from this view on its own.
      await unmatchTransaction({ transactionId: tx._id })
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  async function handleVatRate(tx: UnmatchedTx, vatRateBps: number | null) {
    setPendingId(tx._id)
    try {
      await setVatRate({
        transactionId: tx._id,
        vatRateBps: vatRateBps as 0 | 550 | 1000 | 2000 | null,
      })
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  if (transactions && transactions.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {emptyMessage ?? t('viewEmpty')}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.date')}</TableHead>
              <TableHead>{t('col.label')}</TableHead>
              <TableHead className="text-right">{t('col.amount')}</TableHead>
              {vatEditable && <TableHead>{t('col.vat')}</TableHead>}
              <TableHead>{t('col.account')}</TableHead>
              <TableHead className="text-right">{t('col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pagedTransactions ? (
              <TableRow>
                <TableCell
                  colSpan={vatEditable ? 6 : 5}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              pagedTransactions.map((tx) => (
                <TableRow key={tx._id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {fmtDate(tx.transactionDate)}
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-md truncate">
                      {tx.rawLabel}
                    </span>
                    {tx.counterparty && (
                      <span className="text-muted-foreground block max-w-md truncate text-xs">
                        {tx.counterparty}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${directionTone(tx.direction)}`}
                  >
                    {fmtSigned(tx.amount, tx.direction)}
                  </TableCell>
                  {vatEditable && (
                    <TableCell>
                      <VatRateSelect
                        tx={tx}
                        pending={pendingId === tx._id}
                        onChange={(vatRateBps) =>
                          void handleVatRate(tx, vatRateBps)
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">
                    {accountLabel(tx)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === tx._id}
                      onClick={() => void handleUndo(tx)}
                    >
                      {t('actions.undo')}
                    </Button>
                  </TableCell>
                </TableRow>
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
    </>
  )
}
