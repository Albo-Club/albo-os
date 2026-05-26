import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export type SelectedAccount = {
  _id: Id<'bankAccounts'>
  bankName: string
  label: string
}

export function AccountTransactionsSheet({
  account,
  onClose,
}: {
  account: SelectedAccount | null
  onClose: () => void
}) {
  const { t, i18n } = useTranslation('cash')
  const lang = i18n.language

  const transactions = useConvexQuery(
    api.cash.listAccountDealTransactions,
    account ? { bankAccountId: account._id } : 'skip',
  )

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

  return (
    <Sheet open={account != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('tx.title')}</SheetTitle>
          {account && (
            <SheetDescription>
              {t('tx.subtitle', {
                bank: account.bankName,
                label: account.label,
              })}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {!transactions ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {t('tx.loading')}
            </p>
          ) : transactions.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
              {t('tx.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tx.col.date')}</TableHead>
                  <TableHead>{t('tx.col.label')}</TableHead>
                  <TableHead>{t('tx.col.deal')}</TableHead>
                  <TableHead className="text-right">
                    {t('tx.col.amount')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell>{tx.rawLabel}</TableCell>
                    <TableCell>{tx.deal?.targetName ?? '—'}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        tx.direction === 'out'
                          ? 'text-destructive'
                          : 'text-foreground'
                      }`}
                    >
                      {fmtSigned(tx.amount, tx.direction)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
