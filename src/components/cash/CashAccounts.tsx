import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useAgo } from './BankConnectionsHealth'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

// Mirrors STALE_AFTER_MS in convex/powens.ts (Powens re-syncs ~24h; past
// 48h without fresh data something is wrong).
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

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
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
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

/**
 * Balance freshness of one account, as a small muted line: sync recency for
 * a connected account (amber past STALE_AFTER_MS — the balance can no longer
 * be trusted), manual entry date otherwise. Shared by the available-cash
 * list of the KPI band and the unavailable-accounts table below it.
 */
export function AccountFreshness({ account }: { account: CashAccount }) {
  const { t } = useTranslation('cash')
  const { fmtDate } = useFormatters()
  const ago = useAgo()

  if (account.balanceAsOf == null) {
    if (account.isConnected) return null
    return (
      <span className="text-muted-foreground text-xs">{t('notConnected')}</span>
    )
  }
  const stale =
    account.isConnected && Date.now() - account.balanceAsOf > STALE_AFTER_MS
  return (
    <span
      className={`text-xs ${
        stale ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
      }`}
    >
      {account.isConnected
        ? t('syncedAgo', { ago: ago(account.balanceAsOf) })
        : t('manualAsOf', { date: fmtDate(account.balanceAsOf) })}
    </span>
  )
}

function AccountsTable({
  accounts,
  orgSlug,
}: {
  accounts: Array<CashAccount>
  orgSlug: string
}) {
  const { t } = useTranslation('cash')
  const { fmtEur } = useFormatters()
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
              className="text-muted-foreground cursor-pointer"
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
                  <AccountFreshness account={a} />
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
 * Bottom of the Cash « Vue d'ensemble » tab: the accounts that are NOT part
 * of the available cash — pledged/blocked funds and accounts closed at the
 * bank (kept because their transaction history still backs deals). The
 * available accounts themselves are listed in the KPI band at the top of the
 * tab (CashKpis), so nothing is repeated here. Renders nothing when the org
 * has no such account.
 */
export function UnavailableAccountsSection({
  accounts,
  orgSlug,
}: {
  accounts: Array<CashAccount> | undefined
  orgSlug: string
}) {
  const { t } = useTranslation('cash')

  // Pledged first (real money, just not spendable), closed last.
  const rows = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.pledged || a.accountStatus === 'closed')
        .sort(
          (a, b) =>
            Number(a.accountStatus === 'closed') -
              Number(b.accountStatus === 'closed') ||
            (b.currentBalance ?? 0) - (a.currentBalance ?? 0),
        ),
    [accounts],
  )

  if (rows.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('unavailable.title')}
        </h2>
        <span className="text-muted-foreground text-sm">
          {t('unavailable.hint')}
        </span>
      </div>
      <AccountsTable accounts={rows} orgSlug={orgSlug} />
    </section>
  )
}
