import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { useConvexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import type { ReactNode } from 'react'

import type { Id } from '../../../convex/_generated/dataModel'
import { directionTone } from '~/lib/moneyTone'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'

/**
 * Minimal shape of a transaction displayable in the detail sheet
 * (returns of `listUnmatched`, `listByStatus` or `listByDeal`).
 */
export type TxDetails = {
  _id: Id<'transactions'>
  direction: 'in' | 'out'
  amount: number
  transactionDate: number
  rawLabel: string
  counterparty: string | null
  /** VAT rate (bps) of expenses/income — null = still to qualify. */
  vatRateBps?: number | null
  /** Broad treasury category (charge/product only) — null = to qualify. */
  category?: string | null
  /** Matching status — present on `listLedger` rows; drives the status badge. */
  matchStatus?:
    | 'unmatched'
    | 'matched'
    | 'ignored'
    | 'charge'
    | 'tax'
    | 'product'
    | 'internal_transfer'
  /** Generalized allocation — routes the un-match (deal / liability / transfer). */
  allocation?: {
    kind: 'deal' | 'equity' | 'intercompany_loan' | 'transfer' | 'loan'
    targetId: string
  } | null
  /** Internal transfer still missing its counter-leg (cf. lib/transfers.ts). */
  transferIncomplete?: boolean
  account: { label: string; bankName: string } | null
}

/** Localized date / signed-amount formatters (amounts in EUR cents). */
export function useFormatters() {
  const { i18n } = useTranslation('pointage')
  const lang = i18n.language
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  const fmtSigned = (cents: number, direction: 'in' | 'out') => {
    const signed = direction === 'out' ? -cents : cents
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: 'always',
    }).format(signed / 100)
  }
  return { fmtDate, fmtSigned }
}

export function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

export function accountLabel(tx: TxDetails) {
  return tx.account ? `${tx.account.bankName} · ${tx.account.label}` : '—'
}

/**
 * Localized error toast built from the `ConvexError` code of mutations.
 * The namespace holds the `errors.*` keys (pointage by default, passif…).
 */
export function useReportError(namespace: 'pointage' | 'passif' = 'pointage') {
  const { t } = useTranslation(namespace)
  return (err: unknown) => {
    const code = err instanceof ConvexError ? (err.data as string) : ''
    toast.error(t(`errors.${code}`, t('errors.failed')))
  }
}

/**
 * Read-only detail sheet of a bank transaction (date, raw label,
 * counterparty, amount, direction, account). Context-specific actions
 * (matching, reassignment…) are injected via `footer`.
 */
/**
 * Internal-transfer block of the detail sheet: the counter-leg, plus the two
 * figures a per-line label used to swallow — the amount gap (bank fees,
 * partial transfer) and the in-transit delay (banks settle on different
 * days). Both are derived server-side from the two legs, never stored.
 */
function TransferDetails({ tx }: { tx: TxDetails }) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  const transfer = useConvexQuery(api.transfers.getForTransaction, {
    transactionId: tx._id,
  })
  if (!transfer) return null

  if (!transfer.complete) {
    return (
      <Info
        label={t('transfer.counterpart')}
        value={<span className="text-warning">{t('transfer.missingLeg')}</span>}
      />
    )
  }

  const other = transfer.legs.find((leg) => leg._id !== tx._id)
  return (
    <>
      <Info
        label={t('transfer.counterpart')}
        value={
          other ? (
            <span>
              {fmtSigned(other.amount, other.direction)}
              {other.account ? ` · ${other.account.label}` : ''}
              {` · ${fmtDate(other.transactionDate)}`}
            </span>
          ) : null
        }
      />
      {transfer.gapCents !== 0 && transfer.gapCents != null && (
        <Info
          label={t('transfer.gap')}
          value={
            <span className="text-warning">
              {fmtSigned(Math.abs(transfer.gapCents), 'out')}
            </span>
          }
        />
      )}
      {transfer.transitDays != null && transfer.transitDays !== 0 && (
        <Info
          label={t('transfer.transit')}
          value={t('transfer.transitDays', { count: transfer.transitDays })}
        />
      )}
    </>
  )
}

export function TransactionSheet({
  tx,
  onOpenChange,
  footer,
  match,
  status,
}: {
  tx: TxDetails | null
  onOpenChange: (open: boolean) => void
  footer?: ReactNode
  /** Linked deal / liability entity (resolved + linked by the caller). */
  match?: ReactNode
  /** Matching-status badge — rendered by the caller so the sheet mirrors the
   * table's status column (it used to vanish when opening a row). */
  status?: ReactNode
}) {
  const { t } = useTranslation('pointage')
  const { fmtDate, fmtSigned } = useFormatters()
  return (
    <Sheet open={tx != null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {tx && (
          <>
            <SheetHeader>
              <SheetTitle>{t('detail.title')}</SheetTitle>
              <SheetDescription>{t('detail.description')}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4">
              <Info label={t('col.date')} value={fmtDate(tx.transactionDate)} />
              <Info label={t('detail.rawLabel')} value={tx.rawLabel} />
              <Info label={t('detail.counterparty')} value={tx.counterparty} />
              <Info
                label={t('col.amount')}
                value={
                  <span className={directionTone(tx.direction)}>
                    {fmtSigned(tx.amount, tx.direction)}
                  </span>
                }
              />
              <Info
                label={t('detail.direction')}
                value={t(`direction.${tx.direction}`)}
              />
              <Info label={t('detail.account')} value={accountLabel(tx)} />
              {status && <Info label={t('col.status')} value={status} />}
              {match && <Info label={t('detail.matchedTo')} value={match} />}
              {tx.matchStatus === 'internal_transfer' && (
                <TransferDetails tx={tx} />
              )}
            </div>
            <SheetFooter>{footer}</SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
