import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
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
  /** Generalized allocation — routes the un-match (deal vs liability). */
  allocation?: {
    kind: 'deal' | 'equity' | 'intercompany_loan'
    targetId: string
  } | null
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
      maximumFractionDigits: 0,
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
export function TransactionSheet({
  tx,
  onOpenChange,
  footer,
  match,
}: {
  tx: TxDetails | null
  onOpenChange: (open: boolean) => void
  footer?: ReactNode
  /** Linked deal / liability entity (resolved + linked by the caller). */
  match?: ReactNode
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
              {match && <Info label={t('detail.matchedTo')} value={match} />}
            </div>
            <SheetFooter>{footer}</SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
