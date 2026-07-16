import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import {
  BankConnectionsHealth,
  ConnectionsBanner,
} from '~/components/cash/BankConnectionsHealth'
import { CashAccounts } from '~/components/cash/CashAccounts'
import { CashAlertCard } from '~/components/cash/CashAlertCard'
import { CategoryBreakdown } from '~/components/cash/CategoryBreakdown'
import {
  ForecastEntriesSection,
  ForecastRulesSection,
} from '~/components/cash/ForecastSection'
import { ForecastGridSection } from '~/components/cash/ForecastGridSection'
import { ForecastMatchSuggestions } from '~/components/cash/ForecastMatchSuggestions'
import { ForecastOverview } from '~/components/cash/ForecastOverview'
import { TransactionsLedger } from '~/components/cash/TransactionsLedger'
import { UpcomingEntriesSection } from '~/components/cash/UpcomingEntries'
import { VatCard } from '~/components/cash/VatCard'
import { VatSuggestionCard } from '~/components/cash/VatSuggestionCard'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

type CashTab = 'apercu' | 'previsionnel' | 'transactions' | 'gestion'

const NON_DEFAULT_TABS: ReadonlyArray<CashTab> = [
  'previsionnel',
  'transactions',
  'gestion',
]

export const Route = createFileRoute('/app/$orgSlug/cash/')({
  component: Cash,
  // `?tab=` keeps the active tab linkable (and is the landing of the /pointage
  // redirect). Optional so existing `<Link to="/cash">` callers need not pass
  // it; absent / unknown = overview, and the URL stays clean on the overview.
  validateSearch: (search: Record<string, unknown>): { tab?: CashTab } => {
    // Legacy bookmark: the old Analysis tab now lives in Prévisionnel.
    if (search.tab === 'analyse') return { tab: 'previsionnel' }
    return NON_DEFAULT_TABS.includes(search.tab as CashTab)
      ? { tab: search.tab as CashTab }
      : {}
  },
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'cash')('metaTitle'),
      },
    ],
  }),
})

function Cash() {
  const { t } = useTranslation('cash')
  const { orgSlug } = Route.useParams()
  const { tab = 'apercu' } = Route.useSearch()
  const navigate = useNavigate()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    org ? { orgId: org._id } : 'skip',
  )
  const startBankConnection = useAction(api.powens.startBankConnection)
  const [connecting, setConnecting] = useState(false)

  async function handleConnect() {
    if (!org) return
    setConnecting(true)
    try {
      const { webviewUrl } = await startBankConnection({ orgId: org._id })
      window.location.href = webviewUrl
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(t(`connect.errors.${code}`, t('connect.failed')))
      setConnecting(false)
    }
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Button onClick={handleConnect} disabled={!org || connecting}>
          {connecting ? t('connect.connecting') : t('connect.button')}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({
            to: '/app/$orgSlug/cash',
            params: { orgSlug },
            search: NON_DEFAULT_TABS.includes(value as CashTab)
              ? { tab: value as CashTab }
              : {},
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="apercu">{t('tabs.apercu')}</TabsTrigger>
          <TabsTrigger value="previsionnel">
            {t('tabs.previsionnel')}
          </TabsTrigger>
          <TabsTrigger value="transactions">
            {t('tabs.transactions')}
          </TabsTrigger>
          <TabsTrigger value="gestion">{t('tabs.gestion')}</TabsTrigger>
        </TabsList>
        {/* Vue d'ensemble: the essentials only — degraded-connection banner,
            KPI band + projected-balance curve, and where the cash sits
            (accounts by bank). Everything else lives in the other tabs. */}
        <TabsContent value="apercu" className="space-y-6 pt-4">
          {org && <ConnectionsBanner orgId={org._id} orgSlug={orgSlug} />}
          {org && <ForecastOverview orgId={org._id} accounts={accounts} />}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('accountsTitle')}
            </h2>
            <CashAccounts accounts={accounts} orgSlug={orgSlug} />
          </section>
        </TabsContent>
        {/* Prévisionnel: the month-by-month detail — the "to handle" queue
            (upcoming/overdue entries, suggested reconciliations), the
            committed pipeline + category × month grid, and the
            retrospective per-category analysis. */}
        <TabsContent value="previsionnel" className="space-y-6 pt-4">
          {org && <UpcomingEntriesSection orgId={org._id} />}
          {org && <ForecastMatchSuggestions orgId={org._id} />}
          {org && <ForecastGridSection orgId={org._id} />}
          {org && <CategoryBreakdown orgId={org._id} />}
        </TabsContent>
        <TabsContent value="transactions" className="pt-4">
          {org && <TransactionsLedger orgId={org._id} orgSlug={orgSlug} />}
        </TabsContent>
        {/* Règles & échéances: everything one configures — recurring rules
            (+ suggestions), one-off entries, VAT, threshold alert, bank
            connections health. */}
        <TabsContent value="gestion" className="space-y-6 pt-4">
          {org && <ForecastRulesSection orgId={org._id} />}
          {org && <ForecastEntriesSection orgId={org._id} />}
          {org && <VatCard orgId={org._id} orgSlug={orgSlug} />}
          {org && <VatSuggestionCard orgId={org._id} />}
          {org && <CashAlertCard orgId={org._id} />}
          {org && <BankConnectionsHealth orgId={org._id} />}
        </TabsContent>
      </Tabs>
    </main>
  )
}
