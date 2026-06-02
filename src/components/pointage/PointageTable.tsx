import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { DealCombobox } from './DealCombobox'
import {
  TransactionSheet,
  accountLabel,
  useFormatters,
  useReportError,
} from './TransactionSheet'

import type { Id } from '../../../convex/_generated/dataModel'
import type { DealOption } from './DealCombobox'
import type { TxDetails } from './TransactionSheet'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Forme minimale d'une transaction non pointée (retour de `listUnmatched`). */
export type UnmatchedTx = TxDetails

/** Durée d'affichage du bandeau « Annuler » après un pointage/écartement. */
const UNDO_DELAY_MS = 5000

/** Destins « écarté » : ignorée, charge courante ou impôt. */
type DiscardKind = 'ignored' | 'charge' | 'tax'

/** Statuts éligibles au classement en masse (jamais Rattacher ni Ignorer). */
type BulkStatus = 'charge' | 'tax'

type RecentAction = {
  tx: UnmatchedTx
  kind: 'matched' | DiscardKind
  dealName?: string
}

/** Combobox + Rattacher + menu « Écarter » (Ignorer/Charge/Impôt). */
function RowActions({
  deals,
  pending,
  onMatch,
  onDiscard,
}: {
  deals: Array<DealOption> | undefined
  pending: boolean
  onMatch: (deal: DealOption) => void
  onDiscard: (kind: DiscardKind) => void
}) {
  const { t } = useTranslation('pointage')
  const [deal, setDeal] = useState<DealOption | null>(null)
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
        disabled={!deal || pending}
        onClick={() => deal && onMatch(deal)}
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Bandeau transitoire « Rattachée à {deal} · Annuler » / « Ignorée · Annuler »
 * / « Classée en charge/impôt · Annuler ».
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
        {recent.kind === 'matched'
          ? t('banner.matched', { deal: recent.dealName ?? '—' })
          : t(`banner.${recent.kind}`)}
      </span>
      <Button size="sm" variant="outline" disabled={pending} onClick={onUndo}>
        {t('actions.undo')}
      </Button>
    </div>
  )
}

/**
 * Table de pointage : transactions `unmatched` triées date desc, actions par
 * ligne (rattacher à un deal, écarter en ignorée/charge/impôt), détail en
 * sheet au clic, et bandeau « Annuler » transitoire (~5 s) après chaque
 * action — qui appelle `unmatchTransaction`. Classement en masse via les
 * cases à cocher : barre de sélection → Charge/Impôt → confirmation →
 * `bulkCategorize` (un seul appel serveur) + toast « Annuler » groupé.
 * La page n'écrit jamais `matchStatus`/`reconciled` directement : tout passe
 * par les mutations du backend.
 */
export function PointageTable({
  transactions,
  deals,
  emptyMessage,
}: {
  transactions: Array<UnmatchedTx> | undefined
  deals: Array<DealOption> | undefined
  /** Message d'état vide alternatif (ex. recherche sans résultat). */
  emptyMessage?: string
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()

  const matchTransaction = useConvexMutation(api.transactions.matchTransaction)
  const ignoreTransaction = useConvexMutation(
    api.transactions.ignoreTransaction,
  )
  const categorizeAsCharge = useConvexMutation(
    api.transactions.categorizeAsCharge,
  )
  const categorizeAsTax = useConvexMutation(api.transactions.categorizeAsTax)
  const unmatchTransaction = useConvexMutation(
    api.transactions.unmatchTransaction,
  )
  const bulkCategorize = useConvexMutation(api.transactions.bulkCategorize)

  const discardMutations = {
    ignored: ignoreTransaction,
    charge: categorizeAsCharge,
    tax: categorizeAsTax,
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

  // Purge la sélection des transactions sorties de la file (réactivité
  // Convex après classement, pointage par un autre user…).
  useEffect(() => {
    if (!transactions) return
    setSelectedIds((prev) => {
      const valid = new Set(transactions.map((tx) => tx._id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [transactions])

  // Nettoyage des timers du bandeau « Annuler » au démontage.
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

  async function handleMatch(tx: UnmatchedTx, deal: DealOption) {
    setPendingId(tx._id)
    try {
      await matchTransaction({ transactionId: tx._id, dealId: deal._id })
      addRecent({ tx, kind: 'matched', dealName: deal.target?.name ?? '—' })
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
      await discardMutations[kind]({ transactionId: tx._id })
      addRecent({ tx, kind })
      setSheetTx((cur) => (cur?._id === tx._id ? null : cur))
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  async function handleUndo(tx: UnmatchedTx) {
    setPendingId(tx._id)
    try {
      await unmatchTransaction({ transactionId: tx._id })
      // La query réactive ré-inclut la ligne ; on retire le bandeau après le
      // retour de la mutation pour éviter tout flicker.
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

  // Annulation groupée : boucle de `unmatchTransaction` côté front (volume
  // faible — uniquement les ids du lot qui viennent d'être classés).
  async function handleBulkUndo(ids: Array<Id<'transactions'>>) {
    try {
      await Promise.all(
        ids.map((transactionId) => unmatchTransaction({ transactionId })),
      )
    } catch (err) {
      reportError(err)
    }
  }

  // Classement en masse : UN SEUL appel serveur pour tout le lot. Les lignes
  // classées sortent de la file via la réactivité Convex sur `listUnmatched`.
  async function handleBulkCategorize(status: BulkStatus) {
    const ids = [...selectedIds]
    setBulkPending(true)
    try {
      const result = await bulkCategorize({ transactionIds: ids, status })
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

  // Lignes affichées = transactions `unmatched` (query) + lignes récemment
  // pointées/écartées (state local, le temps du bandeau « Annuler »).
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
            {!rows ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ tx, recent: recentAction }) => (
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
                    className={`text-right tabular-nums ${
                      tx.direction === 'out'
                        ? 'text-destructive'
                        : 'text-foreground'
                    }`}
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
                        onUndo={() => void handleUndo(tx)}
                      />
                    ) : (
                      <RowActions
                        deals={deals}
                        pending={pendingId === tx._id}
                        onMatch={(deal) => void handleMatch(tx, deal)}
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
              onUndo={() => void handleUndo(sheetTx)}
            />
          ) : (
            <RowActions
              deals={deals}
              pending={pendingId === sheetTx._id}
              onMatch={(deal) => void handleMatch(sheetTx, deal)}
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
              {confirmStatus === 'tax'
                ? t('bulk.confirmTax')
                : t('bulk.confirmCharge')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStatus === 'tax'
                ? t('bulk.confirmBodyTax', { count: selectedIds.size })
                : t('bulk.confirmBodyCharge', { count: selectedIds.size })}
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
 * Vue de consultation des transactions écartées (charges / impôts) : table
 * lecture seule alimentée par `listByStatus`, avec « Annuler » par ligne
 * (→ `unmatchTransaction`, la transaction repart dans la file « À pointer »).
 */
export function DiscardedTable({
  transactions,
  emptyMessage,
}: {
  transactions: Array<UnmatchedTx> | undefined
  /** Message d'état vide alternatif (ex. recherche sans résultat). */
  emptyMessage?: string
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()

  const unmatchTransaction = useConvexMutation(
    api.transactions.unmatchTransaction,
  )
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)

  async function handleUndo(tx: UnmatchedTx) {
    setPendingId(tx._id)
    try {
      // La query réactive retire la ligne de cette vue d'elle-même.
      await unmatchTransaction({ transactionId: tx._id })
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
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.date')}</TableHead>
            <TableHead>{t('col.label')}</TableHead>
            <TableHead className="text-right">{t('col.amount')}</TableHead>
            <TableHead>{t('col.account')}</TableHead>
            <TableHead className="text-right">{t('col.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!transactions ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-muted-foreground text-center"
              >
                {t('loading')}
              </TableCell>
            </TableRow>
          ) : (
            transactions.map((tx) => (
              <TableRow key={tx._id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {fmtDate(tx.transactionDate)}
                </TableCell>
                <TableCell>
                  <span className="block max-w-md truncate">{tx.rawLabel}</span>
                  {tx.counterparty && (
                    <span className="text-muted-foreground block max-w-md truncate text-xs">
                      {tx.counterparty}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    tx.direction === 'out'
                      ? 'text-destructive'
                      : 'text-foreground'
                  }`}
                >
                  {fmtSigned(tx.amount, tx.direction)}
                </TableCell>
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
  )
}
