import { useMemo } from 'react'
import { Coins, LineChart, PiggyBank, TrendingUp } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { directionTone } from '~/lib/moneyTone'
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
 * four account tiles, the dated balance history and the matched transactions.
 * The envelope contents (securities inside a brokerage account…) will come
 * with the Powens Wealth integration — deliberately absent for now.
 */
function PlacementDetail() {
  const { t } = useTranslation(['placements', 'participations'])
  const { orgSlug, dealId } = Route.useParams()
  const { fmtEurCents, fmtDate, fmtPercent } = useFormatters()

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
