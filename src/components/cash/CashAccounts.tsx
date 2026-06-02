import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { Id } from '../../../convex/_generated/dataModel'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export type CashAccount = {
  _id: Id<'bankAccounts'>
  bankName: string
  label: string
  /** Nom personnalisé éditable — affiché à la place de `label` si présent. */
  displayName: string | null
  accountKind: string | null
  currency: string
  currentBalance: number | null
  balanceAsOf: number | null
  owner: { _id: Id<'companies'>; name: string; kind: string } | null
}

function useFormatters() {
  const { i18n } = useTranslation('cash')
  const lang = i18n.language
  const fmtEur = (cents?: number | null) =>
    cents == null
      ? null
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(cents / 100)
  const fmtDate = (ms?: number | null) =>
    ms == null
      ? null
      : new Date(ms).toLocaleDateString(lang, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
  return { fmtEur, fmtDate }
}

export function CashAccounts({
  accounts,
  orgSlug,
}: {
  accounts: Array<CashAccount> | undefined
  orgSlug: string
}) {
  const { t } = useTranslation('cash')
  const { fmtEur, fmtDate } = useFormatters()
  const navigate = useNavigate()

  const groups = useMemo(() => {
    if (!accounts) return undefined
    const map = new Map<
      string,
      { name: string; accounts: Array<CashAccount> }
    >()
    for (const a of accounts) {
      const key = a.owner?._id ?? '—'
      const g = map.get(key) ?? { name: a.owner?.name ?? '—', accounts: [] }
      g.accounts.push(a)
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({ id, ...g }))
  }, [accounts])

  const total = useMemo(
    () =>
      accounts?.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0) ?? 0,
    [accounts],
  )

  if (!groups) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full max-w-xs" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('accountsEmpty')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-xs">
        <CardHeader>
          <CardTitle className="text-muted-foreground text-sm font-medium">
            {t('totalBalance')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold tabular-nums">
            {fmtEur(total)}
          </p>
        </CardContent>
      </Card>

      {groups.map((g) => (
        <section key={g.id} className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">{g.name}</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.bank')}</TableHead>
                  <TableHead>{t('col.account')}</TableHead>
                  <TableHead className="text-right">
                    {t('col.balance')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.accounts.map((a) => (
                  <TableRow
                    key={a._id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate({
                        to: '/app/$orgSlug/cash/$accountId',
                        params: { orgSlug, accountId: a._id },
                      })
                    }
                  >
                    <TableCell className="font-medium">{a.bankName}</TableCell>
                    <TableCell>
                      <span className="flex flex-col gap-0.5">
                        <span>{a.displayName ?? a.label}</span>
                        {a.balanceAsOf != null && (
                          <span className="text-muted-foreground text-xs">
                            {t('asOf', { date: fmtDate(a.balanceAsOf) })}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEur(a.currentBalance) ?? t('noBalance')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  )
}
