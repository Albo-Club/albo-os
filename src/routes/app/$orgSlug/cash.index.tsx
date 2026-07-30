import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import type { LedgerFilter } from '~/components/cash/TransactionsLedger'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import {
  BankConnectionsHealth,
  ConnectionsBanner,
} from '~/components/cash/BankConnectionsHealth'
import { CashAlertCard } from '~/components/cash/CashAlertCard'
import { CommittedPipelineCard } from '~/components/cash/CommittedPipelineCard'
import {
  ForecastEntriesSection,
  ForecastRulesSection,
} from '~/components/cash/ForecastSection'
import { ForecastMatchSuggestions } from '~/components/cash/ForecastMatchSuggestions'
import { ForecastOverview } from '~/components/cash/ForecastOverview'
import {
  LEDGER_FILTERS,
  TransactionsLedger,
} from '~/components/cash/TransactionsLedger'
import { VatCard } from '~/components/cash/VatCard'
import { VatSuggestionCard } from '~/components/cash/VatSuggestionCard'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

type CashTab = 'apercu' | 'gestion'

export const Route = createFileRoute('/app/$orgSlug/cash/')({
  component: Cash,
  // `?tab=gestion` keeps the settings tab linkable; `?filter=` preselects the
  // register's status filter (To do CTAs, overdue-entries email). Legacy
  // bookmarks: the old Prévisionnel / Transactions / Analyse tabs merged into
  // the overview, so their `?tab=` values fall back to it.
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: CashTab; filter?: LedgerFilter } => ({
    ...(search.tab === 'gestion' ? { tab: 'gestion' as const } : {}),
    ...(LEDGER_FILTERS.includes(search.filter as LedgerFilter)
      ? { filter: search.filter as LedgerFilter }
      : {}),
  }),
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
  const { tab = 'apercu', filter } = Route.useSearch()
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
            search: value === 'gestion' ? { tab: 'gestion' } : {},
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="apercu">{t('tabs.apercu')}</TabsTrigger>
          <TabsTrigger value="gestion">{t('tabs.gestion')}</TabsTrigger>
        </TabsList>
        {/* Vue d'ensemble — the whole daily surface in one scroll: the
            degraded-connection banner, the projected-balance KPIs + curve,
            the accounts card, then the single register (planned entries +
            transactions) behind its filter bar. The suggested forecast-entry
            reconciliations sit above the register, whatever the active
            filter — the suggestion is about the entry, not the transaction's
            status. */}
        <TabsContent value="apercu" className="space-y-6 pt-4">
          {org && <ConnectionsBanner orgId={org._id} orgSlug={orgSlug} />}
          {org && (
            <ForecastOverview
              orgId={org._id}
              orgSlug={orgSlug}
              accounts={accounts}
            />
          )}
          {org && <ForecastMatchSuggestions orgId={org._id} />}
          {/* Remount on ?filter= change so a To do CTA lands pre-filtered
              even when the page is already open. */}
          {org && (
            <TransactionsLedger
              key={filter ?? 'all'}
              orgId={org._id}
              orgSlug={orgSlug}
              initialFilter={filter}
            />
          )}
        </TabsContent>
        {/* Gestion — everything one configures monthly: recurring rules
            (+ suggestions), one-off entries, the undated committed pipeline,
            VAT, threshold alert, bank connections health. */}
        <TabsContent value="gestion" className="space-y-6 pt-4">
          {org && <ForecastRulesSection orgId={org._id} />}
          {org && <ForecastEntriesSection orgId={org._id} />}
          {org && <CommittedPipelineCard orgId={org._id} />}
          {org && <VatCard orgId={org._id} orgSlug={orgSlug} />}
          {org && <VatSuggestionCard orgId={org._id} />}
          {org && <CashAlertCard orgId={org._id} />}
          {org && <BankConnectionsHealth orgId={org._id} />}
        </TabsContent>
      </Tabs>
    </main>
  )
}
