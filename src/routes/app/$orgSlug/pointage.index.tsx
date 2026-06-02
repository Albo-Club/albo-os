import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
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

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const transactions = useConvexQuery(
    api.transactions.listUnmatched,
    org ? { orgId: org._id } : 'skip',
  )
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )
  const discarded = useConvexQuery(
    api.transactions.listByStatus,
    org && view !== 'unmatched' ? { orgId: org._id, status: view } : 'skip',
  )

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
      {view === 'unmatched' ? (
        <PointageTable transactions={transactions} deals={deals} />
      ) : (
        <DiscardedTable transactions={discarded} />
      )}
    </main>
  )
}
