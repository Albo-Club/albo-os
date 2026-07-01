import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { DealsListView } from '~/components/deals/DealsListView'

export const Route = createFileRoute('/app/$orgSlug/deals/')({
  component: DealsList,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'deals')('metaTitle'),
      },
    ],
  }),
})

function DealsList() {
  const { t } = useTranslation('deals')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <DealsListView deals={deals} orgSlug={orgSlug} />
    </main>
  )
}
