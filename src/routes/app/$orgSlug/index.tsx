import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { Banknote, PieChart, TrendingUp, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { dpi as dpiRatio, tvpi as tvpiRatio } from '../../../../convex/lib/metrics'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { KpiCard } from '~/components/dashboard/KpiCard'
import { HeroCard } from '~/components/dashboard/HeroCard'
import { AllocationCard } from '~/components/dashboard/AllocationCard'
import { ActivityCard } from '~/components/dashboard/ActivityCard'
import { useFormatters } from '~/components/participations/ParticipationsTable'

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
  const { t } = useTranslation('dashboard')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const data = useConvexQuery(
    api.dashboard.getDashboard,
    org ? { orgId: org._id } : 'skip',
  )
  const { fmtEur, fmtEurCompact, fmtDate, fmtMultiple } = useFormatters()

  if (!data) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      </main>
    )
  }

  const tvpi = tvpiRatio({
    capital: data.deployedCents,
    proceeds: data.distributedCents,
    residual: data.navCents,
  })
  const dpi = dpiRatio({
    called: data.deployedCents,
    distributed: data.distributedCents,
  })

  return (
    <main className="flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('overview', { date: fmtDate(Date.now()) })}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_2fr]">
        <HeroCard
          navCents={data.navCents}
          navIsPartial={data.navIsPartial}
          tvpi={tvpi}
          series={data.navSeries}
        />
        <div className="grid grid-cols-2 gap-4">
          <KpiCard
            label={t('kpi.deployed')}
            value={fmtEurCompact(data.deployedCents)}
            title={fmtEur(data.deployedCents)}
            hint={t('kpi.deployedHint', { count: data.participationsCount })}
            icon={Banknote}
          />
          <KpiCard
            label={t('kpi.distributed')}
            value={fmtEurCompact(data.distributedCents)}
            title={fmtEur(data.distributedCents)}
            hint={t('kpi.dpiHint', { value: fmtMultiple(dpi) })}
            icon={TrendingUp}
          />
          <KpiCard
            label={t('kpi.cash')}
            value={fmtEurCompact(data.cashCents)}
            title={fmtEur(data.cashCents)}
            hint={t('kpi.accounts', { count: data.accountsCount })}
            icon={Wallet}
          />
          <KpiCard
            label={t('kpi.participations')}
            value={data.participationsCount}
            hint={t('kpi.activeDeals', { count: data.activeDealsCount })}
            icon={PieChart}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <AllocationCard
          totalCents={data.deployedCents}
          rows={data.byInstrument}
        />
        <ActivityCard orgSlug={orgSlug} transactions={data.recentTransactions} />
      </div>
    </main>
  )
}
