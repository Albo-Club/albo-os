import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
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

/** Vues de la page : file de pointage (défaut) ou consultation des écartées. */
type View = 'unmatched' | 'charge' | 'tax' | 'product' | 'internal_transfer'

function Pointage() {
  const { t } = useTranslation('pointage')
  const { orgSlug } = Route.useParams()
  const [view, setView] = useState<View>('unmatched')

  // Recherche serveur (search index Convex), debouncée, partagée entre les
  // onglets. `undefined` = pas de recherche → chemin de query inchangé.
  const [search, setSearch] = useState('')
  const searchArg = useDebouncedValue(search).trim() || undefined

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const liveTransactions = useConvexQuery(
    api.transactions.listUnmatched,
    org ? { orgId: org._id, search: searchArg } : 'skip',
  )
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )
  const liveDiscarded = useConvexQuery(
    api.transactions.listByStatus,
    org && view !== 'unmatched'
      ? { orgId: org._id, status: view, search: searchArg }
      : 'skip',
  )

  // Pendant le rechargement d'un nouveau terme de recherche, on garde la
  // dernière liste affichée (pas de flash de liste vide). Le cache des
  // écartées est lié à son onglet pour ne jamais montrer un autre statut.
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
          emptyMessage={searchEmptyMessage}
        />
      ) : (
        <DiscardedTable
          transactions={discarded}
          emptyMessage={searchEmptyMessage}
        />
      )}
    </main>
  )
}
