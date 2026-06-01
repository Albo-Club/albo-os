import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
import { PointageTable } from '~/components/pointage/PointageTable'

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

function Pointage() {
  const { t } = useTranslation('pointage')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const transactions = useConvexQuery(
    api.transactions.listUnmatched,
    org ? { orgId: org._id } : 'skip',
  )
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
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
      <PointageTable transactions={transactions} deals={deals} />
    </main>
  )
}
