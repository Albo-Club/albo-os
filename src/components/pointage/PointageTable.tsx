import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
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
import { Button } from '~/components/ui/button'
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
 * action — qui appelle `unmatchTransaction`. La page n'écrit jamais
 * `matchStatus`/`reconciled` directement : tout passe par les mutations du
 * backend.
 */
export function PointageTable({
  transactions,
  deals,
}: {
  transactions: Array<UnmatchedTx> | undefined
  deals: Array<DealOption> | undefined
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

  const discardMutations = {
    ignored: ignoreTransaction,
    charge: categorizeAsCharge,
    tax: categorizeAsTax,
  }

  const [recent, setRecent] = useState<Array<RecentAction>>([])
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)
  const [sheetTx, setSheetTx] = useState<UnmatchedTx | null>(null)
  const timeoutsRef = useRef(
    new Map<Id<'transactions'>, ReturnType<typeof setTimeout>>(),
  )

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
        {t('empty')}
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
              <TableHead>{t('col.account')}</TableHead>
              <TableHead className="text-right">{t('col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows ? (
              <TableRow>
                <TableCell
                  colSpan={5}
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
}: {
  transactions: Array<UnmatchedTx> | undefined
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
        {t('viewEmpty')}
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
