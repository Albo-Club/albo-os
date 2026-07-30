import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useAgo } from './BankConnectionsHealth'
import type { Id } from '../../../convex/_generated/dataModel'
import { bankDomain } from '~/lib/bankDomains'
import { CompanyLogo } from '~/components/CompanyLogo'
import { Badge } from '~/components/ui/badge'
import { Skeleton } from '~/components/ui/skeleton'

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
 * be trusted), manual entry date otherwise. Shared by the accounts card rows.
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

/** One account row of the card — bank logo, names, freshness, balance. */
function AccountRow({
  account,
  orgSlug,
  dim,
}: {
  account: CashAccount
  orgSlug: string
  dim: boolean
}) {
  const { t } = useTranslation('cash')
  const { fmtEur } = useFormatters()

  return (
    <Link
      to="/app/$orgSlug/cash/$accountId"
      params={{ orgSlug, accountId: account._id }}
      className={`hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5 text-sm ${
        dim ? 'text-muted-foreground bg-muted/30' : ''
      }`}
    >
      <CompanyLogo
        domain={bankDomain(account.bankName)}
        companyName={account.bankName}
        size="md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">
            {account.displayName ?? account.label}
          </span>
          {account.pledged && (
            <Badge variant="outline">{t('badges.pledged')}</Badge>
          )}
          {account.accountStatus === 'closed' && (
            <Badge variant="secondary">{t('badges.closed')}</Badge>
          )}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {account.owner
            ? `${account.bankName} · ${account.owner.name}`
            : account.bankName}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 flex-col items-end">
        <span className="font-medium tabular-nums">
          {fmtEur(account.currentBalance) ?? t('noBalance')}
        </span>
        {dim ? (
          <span className="text-muted-foreground text-xs">
            {t('unavailable.hint')}
          </span>
        ) : (
          <AccountFreshness account={account} />
        )}
      </span>
    </Link>
  )
}

/**
 * The accounts card of the Cash overview: available accounts first (each row
 * linking to its detail), then the pledged/closed ones, dimmed with their
 * badge — one card so where the money sits reads in one glance. A footer line
 * sums the NON-LIQUID placements (capitalization accounts, term deposits…)
 * managed on the Placements page, so sleeping cash stays visible without
 * polluting the available balance.
 */
export function CashAccountsCard({
  accounts,
  orgSlug,
  nonLiquidCents,
}: {
  accounts: Array<CashAccount> | undefined
  orgSlug: string
  /** Sum of non-liquid placements (cents) — `null` while loading. */
  nonLiquidCents: number | null
}) {
  const { t } = useTranslation('cash')
  const { fmtEur } = useFormatters()

  // Available first, then pledged (real money, just not spendable), closed
  // last — each bucket biggest balance first.
  const rows = useMemo(() => {
    if (!accounts) return undefined
    const rank = (a: CashAccount) =>
      a.accountStatus === 'closed' ? 2 : a.pledged ? 1 : 0
    return [...accounts].sort(
      (a, b) =>
        rank(a) - rank(b) || (b.currentBalance ?? 0) - (a.currentBalance ?? 0),
    )
  }, [accounts])

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('accounts.title')}
      </h2>
      {!rows ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('accountsEmpty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="divide-y">
            {rows.map((account) => (
              <AccountRow
                key={account._id}
                account={account}
                orgSlug={orgSlug}
                dim={account.pledged || account.accountStatus === 'closed'}
              />
            ))}
          </div>
          {nonLiquidCents != null && nonLiquidCents > 0 && (
            <div className="bg-muted/30 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-sm">
              <span>
                {t('accounts.nonLiquid', { amount: fmtEur(nonLiquidCents) })}
              </span>
              <Link
                to="/app/$orgSlug/placements"
                params={{ orgSlug }}
                className="text-foreground font-medium hover:underline"
              >
                {t('accounts.nonLiquidCta')} →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
