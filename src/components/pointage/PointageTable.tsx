import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { Link } from '@tanstack/react-router'
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
import type {
  LiabilityOption,
  LiabilityOptionGroups,
} from '~/lib/liabilityOptions'
import type { TxDetails } from './TransactionSheet'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'
import { CHARGE_CATEGORIES, PRODUCT_CATEGORIES } from '~/lib/categories'
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
import { Badge } from '~/components/ui/badge'
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
 * Linked target (deal / liability) of a matched transaction, rendered as a
 * clickable link to its detail: a deal → its fiche, an equity/loan allocation
 * → the Passif page (no per-entity detail). The label is resolved from the
 * already-loaded picker options (`deals` / `liabilityOptions`), so no extra
 * server read. `stopPropagation` keeps the row's open-sheet click from firing.
 * Without `orgSlug` (e.g. aggregated view) the label stays plain text.
 */
function MatchLink({
  allocation,
  dealsById,
  liabilityByTarget,
  orgSlug,
}: {
  allocation: { kind: 'deal' | 'equity' | 'intercompany_loan'; targetId: string }
  dealsById: Map<string, DealOption>
  liabilityByTarget: Map<string, LiabilityOption>
  orgSlug?: string
}) {
  const linkClass =
    'text-muted-foreground hover:text-foreground inline-flex max-w-xs items-center gap-0.5 truncate text-xs hover:underline'

  if (allocation.kind === 'deal') {
    const deal = dealsById.get(allocation.targetId)
    const label = deal?.target?.name ?? deal?.name ?? null
    if (!label) return null
    return orgSlug ? (
      <Link
        to="/app/$orgSlug/deals/$dealId"
        params={{ orgSlug, dealId: allocation.targetId }}
        onClick={(e) => e.stopPropagation()}
        className={linkClass}
      >
        <span className="truncate">{label}</span>
        <ArrowUpRight className="size-3 shrink-0" />
      </Link>
    ) : (
      <span className="text-muted-foreground text-xs">{label}</span>
    )
  }

  // equity | intercompany_loan → no per-entity detail, link to the Passif page.
  const label = liabilityByTarget.get(allocation.targetId)?.label ?? null
  if (!label) return null
  return orgSlug ? (
    <Link
      to="/app/$orgSlug/passif"
      params={{ orgSlug }}
      onClick={(e) => e.stopPropagation()}
      className={linkClass}
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-3 shrink-0" />
    </Link>
  ) : (
    <span className="text-muted-foreground text-xs">{label}</span>
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
  orgSlug,
  emptyMessage,
  pageResetKey,
  statusColumn = false,
}: {
  transactions: Array<UnmatchedTx> | undefined
  deals: Array<DealOption> | undefined
  /** Liability targets (equity / C/C) of the org, built by the page. */
  liabilityOptions: LiabilityOptionGroups | undefined
  /** Org slug, to link a matched row to its deal / Passif. Absent = no link. */
  orgSlug?: string
  /** Alternative empty-state message (e.g. search with no results). */
  emptyMessage?: string
  /** Resets the pagination to the first page when this key changes. */
  pageResetKey: string
  /**
   * Ledger mode (Transactions tab): show a status column and resolve the
   * per-row action from `tx.matchStatus` (match/discard for unmatched, VAT
   * select + detach for charge/product, detach otherwise). Rows stay visible
   * after an action (reactivity), so the transient « Annuler » banner is
   * bypassed here — it is kept only for the pure « À pointer » inbox
   * (`statusColumn = false`, the default).
   */
  statusColumn?: boolean
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()

  // Resolve a matched row's `allocation.targetId` → display label + link, from
  // the picker options already loaded for the comboboxes (no extra read).
  const dealsById = useMemo(
    () => new Map((deals ?? []).map((d) => [d._id as string, d])),
    [deals],
  )
  const liabilityByTarget = useMemo(
    () =>
      new Map(
        [
          ...(liabilityOptions?.equityOptions ?? []),
          ...(liabilityOptions?.loanOptions ?? []),
        ].map((o) => [o.targetId, o]),
      ),
    [liabilityOptions],
  )

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
  const setVatRate = useConvexMutation(api.transactions.setVatRate)
  const setCategory = useConvexMutation(api.transactions.setCategory)

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
  // reactivity after categorization, matching by another user…). In ledger
  // mode a row can stay in the list but flip out of `unmatched` — only
  // unmatched rows are bulk-selectable, so drop the rest too.
  useEffect(() => {
    if (!transactions) return
    setSelectedIds((prev) => {
      const valid = new Set(
        transactions
          .filter((tx) => (tx.matchStatus ?? 'unmatched') === 'unmatched')
          .map((tx) => tx._id),
      )
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
        // Ledger mode keeps the row visible (reactivity) — no transient banner.
        if (!statusColumn)
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
        if (!statusColumn)
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
      const result =
        kind === 'charge'
          ? await categorizeAsCharge({
              transactionId: tx._id,
              vatRateBps: DEFAULT_VAT_RATE_BPS,
            })
          : await discardMutations[kind]({ transactionId: tx._id })
      // The gesture was memorized as a learned rule — surface it once so
      // the automatic classification of future rows is never a surprise.
      if (result?.ruleCreated) toast(t('rules.created'))
      if (!statusColumn) addRecent({ tx, kind })
      setSheetTx((cur) => (cur?._id === tx._id ? null : cur))
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  // Ledger mode: return a matched/categorized row to « À pointer ». Routes
  // by allocation kind (a deal unmatch on a liability-allocated tx is rejected
  // by the backend), mirroring handleUndo.
  async function handleDetach(tx: UnmatchedTx) {
    setPendingId(tx._id)
    try {
      if (
        tx.allocation?.kind === 'equity' ||
        tx.allocation?.kind === 'intercompany_loan'
      ) {
        await deallocateTransaction({ transactionId: tx._id })
      } else {
        await unmatchTransaction({ transactionId: tx._id })
      }
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  // Ledger mode: qualify a charge/product VAT rate inline (feeds the VAT card).
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

  // Ledger mode: qualify a charge/product broad category inline. Setting a
  // category memorizes a learned rule (surfaced once via toast).
  async function handleCategory(tx: UnmatchedTx, category: string | null) {
    setPendingId(tx._id)
    try {
      const result = await setCategory({ transactionId: tx._id, category })
      if (result.ruleCreated) toast(t('rules.created'))
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

  // Per-row (and sheet-footer) actions. Inbox mode (no status column) keeps
  // the historical match/discard + transient « Annuler » banner. Ledger mode
  // resolves the action from the row's status and acts immediately (the row
  // updates via reactivity, no banner).
  function actionsFor(tx: UnmatchedTx, recentAction: RecentAction | undefined) {
    const status = tx.matchStatus ?? 'unmatched'
    const pending = pendingId === tx._id
    if (!statusColumn) {
      return recentAction ? (
        <UndoBanner
          recent={recentAction}
          pending={pending}
          onUndo={() => void handleUndo(recentAction)}
        />
      ) : (
        <RowActions
          deals={deals}
          liabilityOptions={liabilityOptions}
          pending={pending}
          onMatch={(target) => void handleMatch(tx, target)}
          onDiscard={(kind) => void handleDiscard(tx, kind)}
        />
      )
    }
    if (status === 'unmatched') {
      return (
        <RowActions
          deals={deals}
          liabilityOptions={liabilityOptions}
          pending={pending}
          onMatch={(target) => void handleMatch(tx, target)}
          onDiscard={(kind) => void handleDiscard(tx, kind)}
        />
      )
    }
    const detach = (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void handleDetach(tx)}
      >
        {t('actions.detach')}
      </Button>
    )
    if (status === 'charge' || status === 'product') {
      return (
        <div className="flex items-center justify-end gap-2">
          <CategorySelect
            tx={tx}
            status={status}
            pending={pending}
            onChange={(category) => void handleCategory(tx, category)}
          />
          <VatRateSelect
            tx={tx}
            pending={pending}
            onChange={(vatRateBps) => void handleVatRate(tx, vatRateBps)}
          />
          {detach}
        </div>
      )
    }
    return <div className="flex justify-end">{detach}</div>
  }

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
              {statusColumn && <TableHead>{t('col.status')}</TableHead>}
              <TableHead className="text-right">{t('col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pagedRows ? (
              <TableRow>
                <TableCell
                  colSpan={statusColumn ? 7 : 6}
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
                    {!recentAction &&
                      (tx.matchStatus ?? 'unmatched') === 'unmatched' && (
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
                  {statusColumn && (
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="secondary">
                          {t(`status.${tx.matchStatus ?? 'unmatched'}`)}
                        </Badge>
                        {tx.allocation && (
                          <MatchLink
                            allocation={tx.allocation}
                            dealsById={dealsById}
                            liabilityByTarget={liabilityByTarget}
                            orgSlug={orgSlug}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {actionsFor(tx, recentAction)}
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
        footer={sheetTx && actionsFor(sheetTx, sheetRecent)}
        match={
          sheetTx?.allocation ? (
            <MatchLink
              allocation={sheetTx.allocation}
              dealsById={dealsById}
              liabilityByTarget={liabilityByTarget}
              orgSlug={orgSlug}
            />
          ) : undefined
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
 * Broad treasury category selector for a charge/product row (« À qualifier »
 * / salaries, fees, subscriptions… — src/lib/categories.ts) → `setCategory`.
 * Labels resolve from `common:categories.<slug>`.
 */
function CategorySelect({
  tx,
  status,
  pending,
  onChange,
}: {
  tx: UnmatchedTx
  status: 'charge' | 'product'
  pending: boolean
  onChange: (category: string | null) => void
}) {
  const { t } = useTranslation(['pointage', 'common'])
  const options = status === 'charge' ? CHARGE_CATEGORIES : PRODUCT_CATEGORIES
  return (
    <Select
      value={tx.category ?? 'unset'}
      disabled={pending}
      onValueChange={(value) => onChange(value === 'unset' ? null : value)}
    >
      <SelectTrigger size="sm" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unset">{t('pointage:category.toQualify')}</SelectItem>
        {options.map((slug) => (
          <SelectItem key={slug} value={slug}>
            {t(`common:categories.${slug}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
