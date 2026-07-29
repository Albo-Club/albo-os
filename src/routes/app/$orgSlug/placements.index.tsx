import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { isTreasuryPlacement } from '../../../../convex/lib/instrumentMapping'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { PlacementsView } from '~/components/placements/PlacementsView'
import { InvestmentsTabs } from '~/components/investments/InvestmentsTabs'

export const Route = createFileRoute('/app/$orgSlug/placements/')({
  component: Placements,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'placements')('metaTitle'),
      },
    ],
  }),
})

/**
 * Treasury placements page: the deals tracked as accounts (crypto,
 * capitalization accounts, term deposits, brokerage) — excluded from the
 * Participations list, rendered Finary-style by PlacementsView. Same
 * `deals.list` subscription as Participations, partitioned client-side.
 */
function Placements() {
  const { t } = useTranslation(['placements', 'nav'])
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )
  const placements = useMemo(
    () => deals?.filter((d) => isTreasuryPlacement(d.instrumentKind)),
    [deals],
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('nav:items.investments')}
        </h1>
        <InvestmentsTabs orgSlug={orgSlug} active="placements" />
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <PlacementsView deals={placements} orgSlug={orgSlug} />
    </main>
  )
}
