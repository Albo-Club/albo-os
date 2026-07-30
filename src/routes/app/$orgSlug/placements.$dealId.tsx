import { useMemo, useState } from 'react'
import { Coins, LineChart, PiggyBank, TrendingUp } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import {
  PLACEMENT_LIQUIDITIES,
  isTreasuryPlacement,
  placementLiquidity,
} from '../../../../convex/lib/instrumentMapping'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
import { directionTone, signTone } from '~/lib/moneyTone'
import { xirr } from '~/lib/xirr'
import { CompanyLogo } from '~/components/CompanyLogo'
import { KpiCard } from '~/components/placements/KpiCard'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/$orgSlug/placements/$dealId')({
  component: PlacementDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'placements',
        )('metaTitleDetail'),
      },
    ],
  }),
})

function NotFound() {
  const { t } = useTranslation('placements')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/placements"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('fiche.back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('fiche.notFound')}</p>
    </main>
  )
}

/**
 * Light placement sheet — a placement is an ACCOUNT with a light reporting,
 * not a participation: header (name, bank, type, editable liquidity), the
 * four account tiles, the dated balance history, the envelope contents
 * (Powens Wealth positions of the linked bank account) and the matched
 * transactions.
 */
function PlacementDetail() {
  const { t, i18n } = useTranslation(['placements', 'participations'])
  const { orgSlug, dealId } = Route.useParams()
  const { fmtEurCents, fmtDate, fmtPercent } = useFormatters()
  // A quantity of securities is not money — plain localized number, up to
  // 4 fraction digits, trailing zeros trimmed.
  const fmtQty = (qty?: number | null) =>
    qty == null
      ? '—'
      : new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 4,
        }).format(qty)

  const deal = useConvexQuery(api.deals.getById, {
    id: dealId as Id<'deals'>,
  })
  const txs = useConvexQuery(api.transactions.listByDeal, {
    dealId: dealId as Id<'deals'>,
  })
  const valuations = useConvexQuery(api.valuations.list, {
    dealId: dealId as Id<'deals'>,
  })
  const updateDeal = useConvexMutation(api.deals.update)
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    deal ? { orgId: deal.orgId } : 'skip',
  )
  const positions = useConvexQuery(
    api.investments.listByAccount,
    deal?.bankAccountId ? { bankAccountId: deal.bankAccountId } : 'skip',
  )
  const refreshInvestments = useAction(api.investments.refresh)
  const [refreshing, setRefreshing] = useState(false)

  // Account metrics from the matched transactions (same conventions as the
  // Placements list: paid = outflows, withdrawn = inflows, gain only once a
  // balance is declared, XIRR of the signed flows + balance as terminal flow).
  const metrics = useMemo(() => {
    if (!txs) return undefined
    const now = Date.now()
    let paid = 0
    let withdrawn = 0
    const flows: Array<{ amount: number; date: number }> = []
    for (const tx of txs) {
      if (tx.direction === 'out') paid += tx.amount
      else withdrawn += tx.amount
      flows.push({
        amount: tx.direction === 'out' ? -tx.amount : tx.amount,
        date: tx.transactionDate,
      })
    }
    const balance = deal?.currentValue ?? null
    const gain = balance == null ? null : balance + withdrawn - paid
    const gainPct = gain != null && paid > 0 ? gain / paid : null
    const annualized =
      balance == null
        ? null
        : xirr([
            ...flows,
            ...(balance > 0 ? [{ amount: balance, date: now }] : []),
          ])
    return { paid, withdrawn, balance, gain, gainPct, annualized }
  }, [txs, deal?.currentValue])

  if (deal === undefined) {
    return (
      <main className="flex-1 p-6">
        <p className="text-muted-foreground text-sm">
          {t('participations:loading')}
        </p>
      </main>
    )
  }

  // A non-placement deal has a full deal sheet — point there instead.
  if (!isTreasuryPlacement(deal.instrumentKind)) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <Link
          to="/app/$orgSlug/placements"
          params={{ orgSlug }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          {t('fiche.back')}
        </Link>
        <p className="text-muted-foreground text-sm">
          {t('fiche.notPlacement')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/app/$orgSlug/deals/$dealId"
            params={{ orgSlug, dealId }}
          >
            {t('fiche.openDeal')}
          </Link>
        </Button>
      </main>
    )
  }

  const name = deal.target?.name ?? deal.name ?? '—'
  const liquidity = placementLiquidity(deal.instrumentKind, deal.liquidity)

  const linkedAccount = deal.bankAccountId
    ? accounts?.find((a) => a._id === deal.bankAccountId)
    : undefined
  const totalValuation = (positions ?? []).reduce(
    (sum, p) => sum + (p.valuation ?? 0),
    0,
  )
  const lastSyncedAt =
    positions && positions.length > 0
      ? Math.max(...positions.map((p) => p.syncedAt))
      : null

  async function handleLiquidityChange(value: string) {
    try {
      await updateDeal({
        id: dealId as Id<'deals'>,
        patch: { liquidity: value as (typeof PLACEMENT_LIQUIDITIES)[number] },
      })
      toast.success(t('liquidity.saved'))
    } catch {
      toast.error(t('liquidity.errors.default'))
    }
  }

  async function handleLinkAccount(value: string) {
    try {
      await updateDeal({
        id: dealId as Id<'deals'>,
        patch: { bankAccountId: value as Id<'bankAccounts'> },
      })
      toast.success(t('envelope.linked'))
    } catch {
      toast.error(t('envelope.errors.link'))
    }
  }

  async function handleUnlinkAccount() {
    try {
      await updateDeal({
        id: dealId as Id<'deals'>,
        patch: { bankAccountId: null },
      })
      toast.success(t('envelope.unlinked'))
    } catch {
      toast.error(t('envelope.errors.link'))
    }
  }

  async function handleRefresh() {
    if (!deal) return
    setRefreshing(true)
    try {
      const result = await refreshInvestments({ orgId: deal.orgId })
      toast.success(t('envelope.refreshed', { count: result.positions }))
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      if (code === 'powens_wealth_unavailable')
        toast.error(t('envelope.errors.wealthUnavailable'))
      else if (code === 'powens_no_user')
        toast.error(t('envelope.errors.noUser'))
      else toast.error(t('envelope.errors.refresh'))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <Link
        to="/app/$orgSlug/placements"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('fiche.back')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CompanyLogo
            domain={deal.target?.domain}
            companyName={name}
            size="lg"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground text-sm">
              {t(`participations:instrument.${deal.instrumentKind}`, {
                defaultValue: deal.instrumentKind,
              })}
              {deal.bankName ? ` · ${deal.bankName}` : ''}
              {deal.closingDate
                ? ` · ${t('col.opened')} ${fmtDate(deal.closingDate)}`
                : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t('liquidity.label')}
          </span>
          <Select value={liquidity} onValueChange={handleLiquidityChange}>
            <SelectTrigger size="sm" aria-label={t('liquidity.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLACEMENT_LIQUIDITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`liquidity.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('col.balance')}
          value={
            metrics?.balance == null ? '—' : fmtEurCents(metrics.balance)
          }
          icon={PiggyBank}
        />
        <KpiCard
          label={t('tiles.invested')}
          value={metrics ? fmtEurCents(metrics.paid - metrics.withdrawn) : '—'}
          hint={t('tiles.investedHint')}
          icon={Coins}
        />
        <KpiCard
          label={t('tiles.gain')}
          value={metrics?.gain == null ? '—' : fmtEurCents(metrics.gain)}
          delta={
            metrics?.gainPct == null
              ? undefined
              : Math.round(metrics.gainPct * 1000) / 10
          }
          icon={TrendingUp}
        />
        <KpiCard
          label={t('tiles.yield')}
          value={fmtPercent(metrics?.annualized ?? null)}
          hint={t('tiles.yieldHint')}
          icon={LineChart}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('fiche.history.title')}</h2>
        {!valuations || valuations.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('fiche.history.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fiche.history.col.date')}</TableHead>
                  <TableHead className="text-right">
                    {t('fiche.history.col.value')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuations.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(row.asOf)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmtEurCents(row.fairValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('envelope.title')}</h2>
        {!deal.bankAccountId ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground text-sm">
              {t('envelope.linkExplain')}
            </p>
            <div className="mt-3 flex justify-center">
              <Select onValueChange={handleLinkAccount}>
                <SelectTrigger
                  size="sm"
                  aria-label={t('envelope.selectPlaceholder')}
                >
                  <SelectValue placeholder={t('envelope.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map((account) => (
                    <SelectItem key={account._id} value={account._id}>
                      {account.bankName} ·{' '}
                      {account.displayName ?? account.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {linkedAccount
                  ? `${linkedAccount.bankName} · ${linkedAccount.displayName ?? linkedAccount.label}`
                  : '—'}
              </span>
              <Button variant="ghost" size="sm" onClick={handleUnlinkAccount}>
                {t('envelope.unlink')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? t('envelope.refreshing') : t('envelope.refresh')}
              </Button>
            </div>
            {positions && positions.length > 0 ? (
              <>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('envelope.col.support')}</TableHead>
                        <TableHead className="text-right">
                          {t('envelope.col.quantity')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('envelope.col.unitValue')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('envelope.col.valuation')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('envelope.col.gain')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((position) => {
                        // Cost basis = valuation − diff; the percentage only
                        // makes sense on a positive cost.
                        const cost =
                          position.valuation != null && position.diff != null
                            ? position.valuation - position.diff
                            : null
                        const pct =
                          cost != null && cost > 0 && position.diff != null
                            ? position.diff / cost
                            : null
                        return (
                          <TableRow key={position._id}>
                            <TableCell>
                              <div className="max-w-[320px] truncate font-medium">
                                {position.label}
                              </div>
                              {position.isinCode ? (
                                <div className="text-muted-foreground text-xs">
                                  {position.isinCode}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtQty(position.quantity)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {position.unitValue == null
                                ? '—'
                                : fmtEurCents(position.unitValue)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {position.valuation == null
                                ? '—'
                                : fmtEurCents(position.valuation)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                position.diff != null &&
                                  signTone(position.diff),
                              )}
                            >
                              {position.diff == null
                                ? '—'
                                : `${position.diff > 0 ? '+' : ''}${fmtEurCents(position.diff)}${
                                    pct == null ? '' : ` (${fmtPercent(pct)})`
                                  }`}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3}>{t('envelope.total')}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtEurCents(totalValuation)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                {lastSyncedAt != null && (
                  <p className="text-muted-foreground text-xs">
                    {t('envelope.syncedOn', { date: fmtDate(lastSyncedAt) })}
                  </p>
                )}
              </>
            ) : positions ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                {t('envelope.empty')}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('fiche.tx.title')}</h2>
        {!txs || txs.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('fiche.tx.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('participations:tx.col.date')}</TableHead>
                  <TableHead className="text-right">
                    {t('participations:tx.col.amount')}
                  </TableHead>
                  <TableHead>{t('participations:tx.col.label')}</TableHead>
                  <TableHead>{t('participations:tx.col.account')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txs.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        directionTone(tx.direction),
                      )}
                    >
                      {tx.direction === 'out' ? '−' : '+'}
                      {fmtEurCents(tx.amount)}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">
                      {tx.rawLabel}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.account
                        ? `${tx.account.bankName} · ${tx.account.label}`
                        : '—'}
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
