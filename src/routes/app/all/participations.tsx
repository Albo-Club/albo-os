import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { ParticipationsTable } from '~/components/participations/ParticipationsTable'

export const Route = createFileRoute('/app/all/participations')({
  component: AllParticipations,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitleAll'),
      },
    ],
  }),
})

function AllParticipations() {
  const { t } = useTranslation('participations')
  const deals = useConvexQuery(api.aggregate.listDeals, {})

  return (
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('allSubtitle')}</p>
      </div>
      <ParticipationsTable deals={deals} showOrg />
    </main>
  )
}
