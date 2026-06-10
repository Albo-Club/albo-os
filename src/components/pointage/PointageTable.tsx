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

/** Forme minimale d'une transaction non pointée (retour de `listUnmatched`). */
export type UnmatchedTx = TxDetails

/** Durée d'affichage du bandeau « Annuler » après un pointage/écartement. */
const UNDO_DELAY_MS = 5000

/** Lignes rendues par page (pagination locale des tables de pointage). */
const PAGE_SIZE = 50

/** Destins « écarté » : ignorée, charge, impôt, produit ou virement interne. */
type DiscardKind =
  | 'ignored'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

/** Statuts éligibles au classement en masse (jamais Rattacher ni Ignorer). */
type BulkStatus = 'charge' | 'tax' | 'product' | 'internal_transfer'

/** Clés i18n du dialog de confirmation bulk, par statut. */
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
  // `matched` = rattachée à un deal, `allocated` = pointée sur le passif
  // (l'annulation passe par deallocateTransaction, pas unmatchTransaction).
  kind: 'matched' | 'allocated' | DiscardKind
  targetName?: string
}

/** Combobox de cible (deal / passif) + Rattacher + menu « Écarter ». */
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
 * Bandeau transitoire « Rattachée à {cible} · Annuler » / « Ignorée · Annuler »
 * / « Classée en charge/impôt/produit/virement interne · Annuler ».
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
 * Pagination locale d'affichage : la liste reste complète côté client (le
 * compteur, la sélection bulk et sa purge opèrent sur tout ; la recherche et
 * les onglets filtrent côté serveur, en amont), seul le rendu est découpé en
 * pages de PAGE_SIZE lignes — c'est le nombre de lignes montées (combobox,
 * menus, cases par ligne) qui fait ramer la page, pas la donnée. `resetKey`
 * ramène à la première page (changement de recherche ou d'onglet) ; la page
 * courante est bornée quand la liste rétrécit (lignes pointées/écartées).
 */
function usePagination(totalRows: number, resetKey: string) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  return { page: Math.min(page, pageCount - 1), pageCount, setPage }
}

/** Barre « Page X sur Y » + précédent/suivant, masquée s'il n'y a qu'une page. */
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
 * Table de pointage : transactions `unmatched` triées date desc, actions par
 * ligne (rattacher à un deal OU à une cible passif — equity / C/C —, écarter
 * en ignorée/charge/impôt/produit/virement interne), détail en sheet au clic,
 * et bandeau « Annuler » transitoire (~5 s) après chaque action — qui appelle
 * `unmatchTransaction` (deal/écartée) ou `deallocateTransaction` (passif).
 * Classement en masse via les cases à cocher : barre de sélection →
 * Charge/Impôt/Produit/Virement interne → confirmation →
 * `bulkCategorize` (un seul appel serveur) + toast « Annuler » groupé.
 * La page n'écrit jamais `matchStatus`/`reconciled` directement : tout passe
 * par les mutations du backend. Rendu paginé localement (cf. `usePagination`).
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
  /** Cibles passif (equity / C/C) de l'org, construites par la page. */
  liabilityOptions: LiabilityOptionGroups | undefined
  /** Message d'état vide alternatif (ex. recherche sans résultat). */
  emptyMessage?: string
  /** Remet la pagination à la première page quand cette clé change. */
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
      // Une charge part avec un taux de TVA de 20 % par défaut, ajustable
      // ensuite dans l'onglet Charges (setVatRate).
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
      // Un pointage passif s'annule via deallocateTransaction (un unmatch
      // deal sur une tx allouée passif est refusé par le backend).
      if (action.kind === 'allocated') {
        await deallocateTransaction({ transactionId: tx._id })
      } else {
        await unmatchTransaction({ transactionId: tx._id })
      }
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
 * Sélecteur de taux de TVA d'une ligne charge/produit (« À qualifier » /
 * 0 % / 5,5 % / 10 % / 20 %) → `setVatRate`. Le montant de TVA dérivé du TTC
 * s'affiche sous le sélecteur quand un taux est posé.
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
 * Vue de consultation des transactions écartées (charges / impôts / produits
 * / virements internes) : table lecture seule alimentée par `listByStatus`,
 * avec « Annuler » par ligne (→ `unmatchTransaction`, la transaction repart
 * dans la file « À pointer »). Sur les onglets Charges/Produits
 * (`vatEditable`), une colonne TVA permet de qualifier le taux de chaque
 * ligne (TVA déductible/collectée — cf. carte « TVA récupérable » de la page
 * Trésorerie). Rendu paginé localement (cf. `usePagination`).
 */
export function DiscardedTable({
  transactions,
  emptyMessage,
  vatEditable = false,
  pageResetKey,
}: {
  transactions: Array<UnmatchedTx> | undefined
  /** Message d'état vide alternatif (ex. recherche sans résultat). */
  emptyMessage?: string
  /** Affiche la colonne TVA (onglets Charges et Produits uniquement). */
  vatEditable?: boolean
  /** Remet la pagination à la première page quand cette clé change. */
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
      // La query réactive retire la ligne de cette vue d'elle-même.
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
