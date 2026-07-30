import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AccountFreshness } from './CashAccounts'
import type { CashAccount } from './CashAccounts'
import { directionTone, signTone } from '~/lib/moneyTone'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'

/** Gross inflows/outflows and net of one KPI window (30 or 90 days). */
export type FlowWindow = {
  inCents: number
  outCents: number
  netCents: number
}

/**
 * Cockpit KPI band (Cash « Vue d'ensemble » tab, above the curve): where the
 * available cash sits (total + one line per account, each linking to its
 * detail), then the 30- and 90-day windows side by side. Purely
 * presentational — the data comes from ForecastOverview (accounts + upcoming
 * entries). `null` values render as skeletons while loading.
 *
 * Rounding follows CLAUDE.md § « Gestion des arrondis » : account balances
 * are real amounts (cent-precise), the flow windows are forecast figures
 * (rounded to the euro).
 */
export function CashKpis({
  accounts,
  availableCents,
  orgSlug,
  flows30,
  flows90,
  fmtEur,
  fmtEurCents,
}: {
  /** Available accounts (active, non-pledged) — `undefined` while loading. */
  accounts: Array<CashAccount> | undefined
  /** Sum of the accounts above; `null` while loading. */
  availableCents: number | null
  orgSlug: string
  flows30: FlowWindow | null
  flows90: FlowWindow | null
  fmtEur: (cents?: number | null) => string
  fmtEurCents: (cents?: number | null) => string
}) {
  const { t } = useTranslation('cash')

  const fmtSigned = (cents: number) =>
    `${cents >= 0 ? '+' : '−'}${fmtEur(Math.abs(cents))}`

  const flowTile = (key: string, title: string, flows: FlowWindow | null) => (
    <Card key={key}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {flows == null ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span className="text-muted-foreground">{t('kpis.inflows')}</span>
              <span className={directionTone('in')}>
                +{fmtEur(flows.inCents)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span className="text-muted-foreground">
                {t('kpis.outflows')}
              </span>
              <span className={directionTone('out')}>
                −{fmtEur(flows.outCents)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t pt-1 font-semibold tabular-nums">
              <span>{t('kpis.net')}</span>
              <span className={signTone(flows.netCents)}>
                {fmtSigned(flows.netCents)}
              </span>
            </div>
          </>
        )}
        <p className="text-muted-foreground text-xs">{t('kpis.flowsHint')}</p>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            {t('availableBalance')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {availableCents == null ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums">
              {fmtEurCents(availableCents)}
            </p>
          )}
          {accounts && accounts.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {t('accountsEmpty')}
            </p>
          )}
          {accounts && accounts.length > 0 && (
            <div className="divide-y border-t">
              {accounts.map((a) => (
                <Link
                  key={a._id}
                  to="/app/$orgSlug/cash/$accountId"
                  params={{ orgSlug, accountId: a._id }}
                  className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 px-2 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {a.displayName ?? a.label}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {a.owner ? `${a.bankName} · ${a.owner.name}` : a.bankName}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-medium tabular-nums">
                      {a.currentBalance == null
                        ? t('noBalance')
                        : fmtEurCents(a.currentBalance)}
                    </span>
                    <AccountFreshness account={a} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        {flowTile('flows30', t('kpis.window30'), flows30)}
        {flowTile('flows90', t('kpis.window90'), flows90)}
      </div>
    </div>
  )
}
