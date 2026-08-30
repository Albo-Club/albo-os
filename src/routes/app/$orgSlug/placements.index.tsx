import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import { api } from '../../../../convex/_generated/api'
import { isTreasuryPlacement } from '../../../../convex/lib/instrumentMapping'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { isPledgedPlacement } from '~/components/cash/CashAccounts'
import { CreatePlacementDialog } from '~/components/placements/CreatePlacementDialog'
import { PlacementsView } from '~/components/placements/PlacementsView'
import { InvestmentsTabs } from '~/components/investments/InvestmentsTabs'
import { Button } from '~/components/ui/button'

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
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    org ? { orgId: org._id } : 'skip',
  )
  const [creating, setCreating] = useState(false)
  const placements = useMemo(
    () => deals?.filter((d) => isTreasuryPlacement(d.instrumentKind)),
    [deals],
  )
  // Pledged accounts are blocked money — treasury lists them no more, they
  // read as long-term placements (shared predicate with the Cash page).
  const pledgedAccounts = useMemo(
    () => accounts?.filter(isPledgedPlacement),
    [accounts],
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('nav:items.investments')}
          </h1>
          <Button onClick={() => setCreating(true)} disabled={!org}>
            <Plus className="size-4" />
            {t('create.button')}
          </Button>
        </div>
        <InvestmentsTabs
          orgSlug={orgSlug}
          active="placements"
          orgId={org?._id}
        />
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <PlacementsView
        deals={placements}
        orgSlug={orgSlug}
        pledgedAccounts={pledgedAccounts}
      />
      {creating && org && (
        <CreatePlacementDialog
          orgId={org._id}
          orgSlug={orgSlug}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  )
}
