import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useConvex } from 'convex/react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { ParticipationsView } from '~/components/participations/ParticipationsView'

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
  // Server-side projection: pre-aggregated company rows across all my orgs.
  const rows = useConvexQuery(api.aggregate.listParticipations, {})
  // One-shot fetch of the full per-deal set, only when an export runs.
  const convex = useConvex()

  return (
    <main className="flex-1 space-y-6 p-6">
      <ParticipationsView
        rows={rows}
        showOrg
        loadExportDeals={() => convex.query(api.aggregate.listDeals, {})}
        // Rendered inside the view's sticky bar, so title + filters stay
        // pinned together while the list scrolls.
        header={
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h1>
            <p className="text-muted-foreground text-sm">{t('allSubtitle')}</p>
          </div>
        }
      />
    </main>
  )
}
