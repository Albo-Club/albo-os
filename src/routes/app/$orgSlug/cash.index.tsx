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
import { CashAccounts } from '~/components/cash/CashAccounts'
import { CategoryBreakdown } from '~/components/cash/CategoryBreakdown'
import {
  ForecastEntriesSection,
  ForecastRulesSection,
} from '~/components/cash/ForecastSection'
import { ForecastMatchSuggestions } from '~/components/cash/ForecastMatchSuggestions'
import { ForecastOverview } from '~/components/cash/ForecastOverview'
import { TransactionsLedger } from '~/components/cash/TransactionsLedger'
import { UpcomingEntriesSection } from '~/components/cash/UpcomingEntries'
import { VatCard } from '~/components/cash/VatCard'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

type CashTab = 'apercu' | 'transactions' | 'analyse'

export const Route = createFileRoute('/app/$orgSlug/cash/')({
  component: Cash,
  // `?tab=` keeps the active tab linkable (and is the landing of the /pointage
  // redirect). Optional so existing `<Link to="/cash">` callers need not pass
  // it; absent / unknown = overview, and the URL stays clean on the overview.
  validateSearch: (search: Record<string, unknown>): { tab?: CashTab } =>
    search.tab === 'transactions' || search.tab === 'analyse'
      ? { tab: search.tab }
      : {},
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
            search:
              value === 'transactions' || value === 'analyse'
                ? { tab: value as CashTab }
                : {},
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="apercu">{t('tabs.apercu')}</TabsTrigger>
          <TabsTrigger value="transactions">
            {t('tabs.transactions')}
          </TabsTrigger>
          <TabsTrigger value="analyse">{t('tabs.analyse')}</TabsTrigger>
        </TabsList>
        <TabsContent value="apercu" className="space-y-6 pt-4">
          {/* Cockpit first: KPIs + curve + grid, then the 30/90-day
              maturities and suggested reconciliations; accounts/VAT and the
              rules/one-off management move below. */}
          {org && <ForecastOverview orgId={org._id} accounts={accounts} />}
          {org && <UpcomingEntriesSection orgId={org._id} />}
          {org && <ForecastMatchSuggestions orgId={org._id} />}
          <CashAccounts accounts={accounts} orgSlug={orgSlug} />
          {org && <VatCard orgId={org._id} orgSlug={orgSlug} />}
          {org && <ForecastRulesSection orgId={org._id} />}
          {org && <ForecastEntriesSection orgId={org._id} />}
        </TabsContent>
        <TabsContent value="transactions" className="pt-4">
          {org && <TransactionsLedger orgId={org._id} orgSlug={orgSlug} />}
        </TabsContent>
        <TabsContent value="analyse" className="pt-4">
          {org && <CategoryBreakdown orgId={org._id} />}
        </TabsContent>
      </Tabs>
    </main>
  )
}
