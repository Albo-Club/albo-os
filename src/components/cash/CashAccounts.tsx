import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
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
  /** Editable custom name — shown instead of `label` when present. */
  displayName: string | null
  accountKind: string | null
  currency: string
  currentBalance: number | null
  balanceAsOf: number | null
  /** 'closed' = closed at the bank, kept for history (out of balances). */
  accountStatus: 'active' | 'closed'
  /** Pledged/blocked funds — listed but out of the AVAILABLE balance. */
  pledged: boolean
  /** Powens-synced (balance refreshes itself) vs manual balance entry. */
  isConnected: boolean
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

function AccountsTable({
  accounts,
  orgSlug,
  muted = false,
}: {
  accounts: Array<CashAccount>
  orgSlug: string
  muted?: boolean
}) {
  const { t } = useTranslation('cash')
  const { fmtEur, fmtDate } = useFormatters()
  const navigate = useNavigate()

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.bank')}</TableHead>
            <TableHead>{t('col.account')}</TableHead>
            <TableHead className="text-right">{t('col.balance')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow
              key={a._id}
              className={`cursor-pointer ${muted ? 'text-muted-foreground' : ''}`}
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
                  <span className="flex flex-wrap items-center gap-1.5">
                    {a.displayName ?? a.label}
                    {a.pledged && (
                      <Badge variant="outline">{t('badges.pledged')}</Badge>
                    )}
                    {a.accountStatus === 'closed' && (
                      <Badge variant="secondary">{t('badges.closed')}</Badge>
                    )}
                  </span>
                  {a.balanceAsOf != null && (
                    <span className="text-muted-foreground text-xs">
                      {a.isConnected
                        ? t('asOf', { date: fmtDate(a.balanceAsOf) })
                        : t('manualAsOf', { date: fmtDate(a.balanceAsOf) })}
                    </span>
                  )}
                  {a.balanceAsOf == null && !a.isConnected && (
                    <span className="text-muted-foreground text-xs">
                      {t('notConnected')}
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
  )
}

/**
 * Bank accounts of the org, grouped by owning entity. The headline
 * available/total figures moved to the cockpit KPI band (CashKpis) — this
 * section keeps the tables only. Closed accounts are kept (their
 * transaction history still backs deals) in a separate muted section.
 */
export function CashAccounts({
  accounts,
  orgSlug,
}: {
  accounts: Array<CashAccount> | undefined
  orgSlug: string
}) {
  const { t } = useTranslation('cash')

  const { open, closed } = useMemo(() => {
    const all = accounts ?? []
    return {
      open: all.filter((a) => a.accountStatus === 'active'),
      closed: all.filter((a) => a.accountStatus === 'closed'),
    }
  }, [accounts])

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; accounts: Array<CashAccount> }
    >()
    for (const a of open) {
      const key = a.owner?._id ?? '—'
      const g = map.get(key) ?? { name: a.owner?.name ?? '—', accounts: [] }
      g.accounts.push(a)
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({ id, ...g }))
  }, [open])

  if (!accounts) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full max-w-xs" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('accountsEmpty')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.id} className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">{g.name}</h2>
          <AccountsTable accounts={g.accounts} orgSlug={orgSlug} />
        </section>
      ))}

      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-tight">
            {t('closedSection')}
          </h2>
          <AccountsTable accounts={closed} orgSlug={orgSlug} muted />
        </section>
      )}
    </div>
  )
}
