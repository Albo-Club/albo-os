import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import {
  Banknote,
  Gauge,
  LineChart,
  PieChart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { KpiCard } from '~/components/dashboard/KpiCard'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { cn } from '~/lib/utils'
import { directionTone } from '~/lib/moneyTone'

export const Route = createFileRoute('/app/$orgSlug/')({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'dashboard')('metaTitle'),
      },
    ],
  }),
})

function Dashboard() {
  const { t, i18n } = useTranslation(['dashboard', 'participations'])
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const data = useConvexQuery(
    api.dashboard.getDashboard,
    org ? { orgId: org._id } : 'skip',
  )
  const { fmtEur, fmtEurCompact, fmtDate } = useFormatters()

  if (!data) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('dashboard:title')}
        </h1>
        <div className="text-muted-foreground text-sm">
          {t('dashboard:loading')}
        </div>
      </main>
    )
  }

  const tvpi =
    data.deployedCents > 0
      ? (data.distributedCents + data.navCents) / data.deployedCents
      : null
  const fmtMultiple = (ratio: number | null) =>
    ratio == null
      ? '—'
      : `${new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }).format(ratio)}×`
  const maxInstrument = data.byInstrument.at(0)?.paidCents ?? 0

  return (
    <main className="flex-1 space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('dashboard:title')}
      </h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label={t('dashboard:kpi.participations')}
          value={data.participationsCount}
          hint={t('dashboard:kpi.activeDeals', {
            count: data.activeDealsCount,
          })}
          icon={PieChart}
        />
        <KpiCard
          label={t('dashboard:kpi.deployed')}
          value={fmtEurCompact(data.deployedCents)}
          title={fmtEur(data.deployedCents)}
          icon={Banknote}
        />
        <KpiCard
          label={t('dashboard:kpi.distributed')}
          value={fmtEurCompact(data.distributedCents)}
          title={fmtEur(data.distributedCents)}
          icon={TrendingUp}
        />
        <KpiCard
          label={t('dashboard:kpi.cash')}
          value={fmtEurCompact(data.cashCents)}
          title={fmtEur(data.cashCents)}
          icon={Wallet}
        />
        <KpiCard
          label={t('dashboard:kpi.nav')}
          value={fmtEurCompact(data.navCents)}
          title={fmtEur(data.navCents)}
          hint={data.navIsPartial ? t('dashboard:kpi.navPartial') : undefined}
          icon={LineChart}
        />
        <KpiCard
          label={t('dashboard:kpi.tvpi')}
          value={fmtMultiple(tvpi)}
          icon={Gauge}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('dashboard:allocation.title')}
          </h2>
          {data.byInstrument.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
              {t('dashboard:allocation.empty')}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border p-4">
              {data.byInstrument.map((row) => (
                <div key={row.kind} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>
                      {t(`participations:instrument.${row.kind}`, {
                        defaultValue: row.kind,
                      })}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {fmtEur(row.paidCents)}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (row.paidCents / maxInstrument) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('dashboard:recent.title')}
          </h2>
          {data.recentTransactions.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
              {t('dashboard:recent.empty')}
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {data.recentTransactions.map((tx) => (
                <div
                  key={tx._id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="text-muted-foreground w-20 shrink-0 text-xs">
                    {fmtDate(tx.transactionDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {tx.rawLabel}
                    {tx.dealLabel && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {tx.dealLabel}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      directionTone(tx.direction),
                    )}
                  >
                    {tx.direction === 'out' ? '−' : '+'}
                    {fmtEur(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/app/$orgSlug/cash"
            params={{ orgSlug }}
            className="text-muted-foreground hover:text-foreground inline-block text-sm underline-offset-4 hover:underline"
          >
            {t('dashboard:recent.seeCash')} →
          </Link>
        </section>
      </div>
    </main>
  )
}
