import { useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Input } from '~/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

export const Route = createFileRoute('/app/$orgSlug/cash/$accountId')({
  component: AccountDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'cash')('metaTitleDetail'),
      },
    ],
  }),
})

function BackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation('cash')
  return (
    <Link
      to="/app/$orgSlug/cash"
      params={{ orgSlug }}
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      {t('back')}
    </Link>
  )
}

function NotFound() {
  const { t } = useTranslation('cash')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <BackLink orgSlug={orgSlug} />
      <p className="text-muted-foreground text-sm">{t('notFound')}</p>
    </main>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

function AccountDetail() {
  const { t, i18n } = useTranslation('cash')
  const lang = i18n.language
  const { orgSlug, accountId } = Route.useParams()
  const account = useConvexQuery(api.cash.getAccount, {
    bankAccountId: accountId as Id<'bankAccounts'>,
  })

  // Recherche serveur (search index Convex), debouncée. Pendant le
  // rechargement d'un nouveau terme, on garde la dernière liste affichée
  // (pas de flash de liste vide).
  const [search, setSearch] = useState('')
  const searchArg = useDebouncedValue(search).trim() || undefined
  const liveTransactions = useConvexQuery(api.cash.listAccountTransactions, {
    bankAccountId: accountId as Id<'bankAccounts'>,
    search: searchArg,
  })
  const lastTransactionsRef = useRef(liveTransactions)
  if (liveTransactions !== undefined) {
    lastTransactionsRef.current = liveTransactions
  }
  const transactions = liveTransactions ?? lastTransactionsRef.current

  const fmtEur = (cents?: number | null) =>
    cents == null
      ? null
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(cents / 100)
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
    <main className="flex-1 space-y-6 p-6">
      <BackLink orgSlug={orgSlug} />
      <h1 className="text-2xl font-semibold tracking-tight">
        {account ? `${account.bankName} · ${account.label}` : t('loading')}
      </h1>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <Info label={t('detail.owner')} value={account?.owner?.name} />
        <Info
          label={t('col.balance')}
          value={account ? (fmtEur(account.currentBalance) ?? t('noBalance')) : null}
        />
        <Info
          label={t('detail.asOf')}
          value={account?.balanceAsOf != null ? fmtDate(account.balanceAsOf) : null}
        />
        <Info label={t('detail.iban')} value={account?.iban} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">{t('tx.title')}</h2>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tx.search.placeholder')}
          className="max-w-sm"
        />
        {!transactions ? (
          <p className="text-muted-foreground text-sm">{t('tx.loading')}</p>
        ) : transactions.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
            {searchArg ? t('tx.search.noResults') : t('tx.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
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
          </div>
        )}
      </section>
    </main>
  )
}
