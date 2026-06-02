import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import type { ReactNode } from 'react'

import type { Id } from '../../../convex/_generated/dataModel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'

/**
 * Forme minimale d'une transaction affichable dans le sheet de détail
 * (retours de `listUnmatched`, `listByStatus` ou `listByDeal`).
 */
export type TxDetails = {
  _id: Id<'transactions'>
  direction: 'in' | 'out'
  amount: number
  transactionDate: number
  rawLabel: string
  counterparty: string | null
  account: { label: string; bankName: string } | null
}

/** Formateurs date/montant signé localisés (montants en cents EUR). */
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
 * Toast d'erreur localisé à partir du code `ConvexError` des mutations.
 * Le namespace porte les clés `errors.*` (pointage par défaut, passif…).
 */
export function useReportError(namespace: 'pointage' | 'passif' = 'pointage') {
  const { t } = useTranslation(namespace)
  return (err: unknown) => {
    const code = err instanceof ConvexError ? (err.data as string) : ''
    toast.error(t(`errors.${code}`, t('errors.failed')))
  }
}

/**
 * Sheet de détail lecture seule d'une transaction bancaire (date, libellé
 * brut, contrepartie, montant, sens, compte). Les actions par contexte
 * (pointage, réattribution…) sont injectées via `footer`.
 */
export function TransactionSheet({
  tx,
  onOpenChange,
  footer,
}: {
  tx: TxDetails | null
  onOpenChange: (open: boolean) => void
  footer?: ReactNode
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
                  <span
                    className={tx.direction === 'out' ? 'text-destructive' : ''}
                  >
                    {fmtSigned(tx.amount, tx.direction)}
                  </span>
                }
              />
              <Info
                label={t('detail.direction')}
                value={t(`direction.${tx.direction}`)}
              />
              <Info label={t('detail.account')} value={accountLabel(tx)} />
            </div>
            <SheetFooter>{footer}</SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
