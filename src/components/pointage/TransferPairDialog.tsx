import { useState } from 'react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../../convex/_generated/api'
import { accountLabel, useFormatters, useReportError } from './TransactionSheet'

import type { Id } from '../../../convex/_generated/dataModel'
import type { TxDetails } from './TransactionSheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { directionTone } from '~/lib/moneyTone'

/**
 * Picks the counter-leg of an internal transfer.
 *
 * The candidate list is narrowed by STRUCTURAL RULE — the other accounts of
 * the same legal entity, opposite direction, still free — and sorted by date.
 * It never ranks by likelihood and never preselects: choosing the counter-leg
 * stays a human gesture (cf. CLAUDE.md, suppression du moteur de suggestion).
 *
 * Closing without picking is legitimate: the transfer simply stays incomplete
 * and shows up under the register's « Virements à apparier » filter.
 */
export function TransferPairDialog({
  tx,
  onClose,
}: {
  /** The already-tagged leg whose counterpart we are looking for. */
  tx: TxDetails | null
  onClose: () => void
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError()
  const [search, setSearch] = useState('')
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)
  const searchArg = useDebouncedValue(search).trim() || undefined

  const pairTransfer = useConvexMutation(api.transfers.pairTransfer)
  const candidates = useConvexQuery(
    api.transfers.listPairable,
    tx ? { transactionId: tx._id, search: searchArg } : 'skip',
  )

  async function handlePick(counterpartId: Id<'transactions'>) {
    if (!tx) return
    setPendingId(counterpartId)
    try {
      await pairTransfer({
        transactionId: tx._id,
        counterpartTransactionId: counterpartId,
      })
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Dialog open={tx != null} onOpenChange={(open) => !open && onClose()}>
      {/* Height cap + scroll: the candidate list is unbounded (cf. CLAUDE.md). */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('transfer.pairTitle')}</DialogTitle>
          <DialogDescription>
            {tx
              ? t('transfer.pairDescription', {
                  amount: fmtSigned(tx.amount, tx.direction),
                  account: accountLabel(tx),
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('transfer.searchPlaceholder')}
        />

        {candidates === undefined ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t('transfer.loading')}
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t('transfer.noCandidate')}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {candidates.map((candidate) => (
              <li
                key={candidate._id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm">
                    {candidate.rawLabel}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {fmtDate(candidate.transactionDate)}
                    {candidate.account ? ` · ${candidate.account.label}` : ''}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`tabular-nums ${directionTone(candidate.direction)}`}
                  >
                    {fmtSigned(candidate.amount, candidate.direction)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingId != null}
                    onClick={() => void handlePick(candidate._id)}
                  >
                    {t('transfer.pick')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('transfer.later')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
