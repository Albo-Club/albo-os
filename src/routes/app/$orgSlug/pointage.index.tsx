import { useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import type { LiabilityOptionGroups } from '~/lib/liabilityOptions'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { buildLiabilityOptions } from '~/lib/liabilityOptions'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import {
  DiscardedTable,
  PointageTable,
} from '~/components/pointage/PointageTable'

export const Route = createFileRoute('/app/$orgSlug/pointage/')({
  component: Pointage,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'pointage')('metaTitle'),
      },
    ],
  }),
})

/** Page views: matching queue (default) or browsing discarded ones. */
type View = 'unmatched' | 'charge' | 'tax' | 'product' | 'internal_transfer'

function Pointage() {
  const { t } = useTranslation(['pointage', 'passif'])
  const { orgSlug } = Route.useParams()
  const [view, setView] = useState<View>('unmatched')

  // Server-side search (Convex search index), debounced, shared across
  // tabs. `undefined` = no search → query path unchanged.
  const [search, setSearch] = useState('')
  const searchArg = useDebouncedValue(search).trim() || undefined

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const liveTransactions = useConvexQuery(
    api.transactions.listUnmatched,
    org ? { orgId: org._id, search: searchArg } : 'skip',
  )
  // Lightweight options queries: the comboboxes only need ids + names, and
  // unlike deals.list / getLiabilities these don't read transactions — so
  // each pointage write doesn't re-run (and re-download) them.
  const deals = useConvexQuery(
    api.deals.listOptions,
    org ? { orgId: org._id } : 'skip',
  )
  const liabilities = useConvexQuery(
    api.liabilities.listOptions,
    org ? { orgId: org._id } : 'skip',
  )
  const liveDiscarded = useConvexQuery(
    api.transactions.listByStatus,
    org && view !== 'unmatched'
      ? { orgId: org._id, status: view, search: searchArg }
      : 'skip',
  )

  // Liability targets for the combobox (Equity / Shareholder loan groups),
  // built by the tested pure helper (tests/liabilityOptions.test.ts).
  // Labels resolved via the `passif` namespace (same keys as the Passif page).
  const liabilityOptions = useMemo<LiabilityOptionGroups | undefined>(() => {
    if (!liabilities) return undefined
    return buildLiabilityOptions(liabilities, {
      equityType: (type) =>
        t(`passif:equity.type.${type}`, { defaultValue: type }),
      receivable: t('passif:loans.receivable'),
      payable: t('passif:loans.payable'),
    })
  }, [liabilities, t])

  // While a new search term is reloading, keep the last displayed list
  // (no empty-list flash). The discarded cache is tied to its tab so it
  // never shows another status.
  const lastTransactionsRef = useRef(liveTransactions)
  if (liveTransactions !== undefined)
    lastTransactionsRef.current = liveTransactions
  const transactions = liveTransactions ?? lastTransactionsRef.current

  const lastDiscardedRef = useRef<{
    view: View
    data: typeof liveDiscarded
  }>({ view, data: undefined })
  if (liveDiscarded !== undefined)
    lastDiscardedRef.current = { view, data: liveDiscarded }
  const discarded =
    liveDiscarded ??
    (lastDiscardedRef.current.view === view
      ? lastDiscardedRef.current.data
      : undefined)

  const searchEmptyMessage = searchArg ? t('search.noResults') : undefined

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          {transactions && transactions.length > 0 && (
            <Badge variant="secondary">
              {t('counter', { count: transactions.length })}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <TabsList>
          <TabsTrigger value="unmatched">{t('view.unmatched')}</TabsTrigger>
          <TabsTrigger value="charge">{t('view.charge')}</TabsTrigger>
          <TabsTrigger value="tax">{t('view.tax')}</TabsTrigger>
          <TabsTrigger value="product">{t('view.product')}</TabsTrigger>
          <TabsTrigger value="internal_transfer">
            {t('view.internal_transfer')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('search.placeholder')}
        className="max-w-sm"
      />
      {view === 'unmatched' ? (
        <PointageTable
          transactions={transactions}
          deals={deals}
          liabilityOptions={liabilityOptions}
          emptyMessage={searchEmptyMessage}
          pageResetKey={searchArg ?? ''}
        />
      ) : (
        <DiscardedTable
          transactions={discarded}
          emptyMessage={searchEmptyMessage}
          vatEditable={view === 'charge' || view === 'product'}
          pageResetKey={`${view}:${searchArg ?? ''}`}
        />
      )}
    </main>
  )
}
