import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useAgo } from './BankConnectionsHealth'
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

function AccountsTable({
  accounts,
  orgSlug,
  muted = false,
  showBank = false,
}: {
  accounts: Array<CashAccount>
  orgSlug: string
  muted?: boolean
  /** Bank column instead of the entity one (closed section, mixed banks). */
  showBank?: boolean
}) {
  const { t } = useTranslation('cash')
  const { fmtEur, fmtDate } = useFormatters()
  const ago = useAgo()
  const navigate = useNavigate()

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {showBank && <TableHead>{t('col.bank')}</TableHead>}
            <TableHead>{t('col.account')}</TableHead>
            {!showBank && <TableHead>{t('col.entity')}</TableHead>}
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
              {showBank && (
                <TableCell className="font-medium">{a.bankName}</TableCell>
              )}
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
                    <span
                      className={`text-xs ${
                        a.isConnected &&
                        Date.now() - a.balanceAsOf > STALE_AFTER_MS
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {a.isConnected
                        ? t('syncedAgo', { ago: ago(a.balanceAsOf) })
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
              {!showBank && (
                <TableCell className="text-muted-foreground">
                  {a.owner?.name ?? '—'}
                </TableCell>
              )}
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
 * Bank accounts of the org, grouped by bank ("where is the cash"), with the
 * owning entity as a column and a per-bank subtotal in the group header.
 * The headline available/total figures live in the cockpit KPI band
 * (CashKpis) — this section keeps the tables only. Closed accounts are kept
 * (their transaction history still backs deals) in a separate muted section.
 */
export function CashAccounts({
  accounts,
  orgSlug,
}: {
  accounts: Array<CashAccount> | undefined
  orgSlug: string
}) {
  const { t } = useTranslation('cash')
  const { fmtEur } = useFormatters()

  const { open, closed } = useMemo(() => {
    const all = accounts ?? []
    return {
      open: all.filter((a) => a.accountStatus === 'active'),
      closed: all.filter((a) => a.accountStatus === 'closed'),
    }
  }, [accounts])

  const groups = useMemo(() => {
    // Case-insensitive key: imported rows ("PALATINE") and Powens-created
    // ones ("Palatine") must land in the same bank group.
    const map = new Map<
      string,
      { name: string; accounts: Array<CashAccount>; totalCents: number }
    >()
    for (const a of open) {
      const key = a.bankName.trim().toLowerCase()
      const g =
        map.get(key) ?? { name: a.bankName.trim(), accounts: [], totalCents: 0 }
      g.accounts.push(a)
      g.totalCents += a.currentBalance ?? 0
      map.set(key, g)
    }
    return Array.from(map.entries())
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => b.totalCents - a.totalCents)
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
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold tracking-tight">{g.name}</h2>
            <span className="text-sm font-semibold tabular-nums">
              {fmtEur(g.totalCents)}
            </span>
          </div>
          <AccountsTable accounts={g.accounts} orgSlug={orgSlug} />
        </section>
      ))}

      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-tight">
            {t('closedSection')}
          </h2>
          <AccountsTable accounts={closed} orgSlug={orgSlug} muted showBank />
        </section>
      )}
    </div>
  )
}
