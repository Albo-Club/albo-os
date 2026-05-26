import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { ParticipationsTable } from '~/components/participations/ParticipationsTable'

export const Route = createFileRoute('/app/$orgSlug/participations/')({
  component: Participations,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitle'),
      },
    ],
  }),
})

function Participations() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <ParticipationsTable deals={deals} orgSlug={orgSlug} />
    </main>
  )
}
