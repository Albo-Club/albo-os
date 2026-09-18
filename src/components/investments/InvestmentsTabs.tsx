import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import { ALL_MODULES, visibleModules } from '../../../convex/lib/modules'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ModuleKey } from '../../../convex/lib/modules'

/**
 * Shared sub-nav of the Investissements section: three router links
 * switching between the Entreprises (participations), Placements and
 * Immobilier pages. Real estate is a TAB here and not a sidebar entry: a
 * property would distort the TVPI/MOIC of the portfolio if it sat under
 * Entreprises (SPEC D28), but it is still an investment.
 *
 * Which of the three are on screen is the org's own choice, made from the
 * page's own ⋯ on the title row (`SubsectionsMenu`) — not from a trigger of
 * its own here, which put two identical ⋯ one under the other in the same
 * corner. Styled
 * exactly like the shadcn TabsList/TabsTrigger default variant from
 * `~/components/ui/tabs` — but built from `Link`s with a `data-state`
 * attribute, since these are navigation tabs (the active one is derived
 * from the route), not local Tabs state.
 */

// Mirror of ui/tabs.tsx TabsTrigger (default variant, horizontal), with the
// group-dependent selectors resolved since there is no Tabs root here.
const triggerClass =
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring dark:text-muted-foreground dark:hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export function InvestmentsTabs({
  orgSlug,
  active,
  orgId,
}: {
  orgSlug: string
  active: ModuleKey
  /** Absent = every tab is shown (no org resolved yet). */
  orgId?: Id<'organizations'>
}) {
  const { t } = useTranslation(['participations', 'placements', 'immobilier'])
  const modules = useConvexQuery(
    api.modules.list,
    orgId ? { orgId } : 'skip',
  )

  // A sub-section that holds nothing and was not ticked is hidden (SPEC
  // D37) — but the one being looked at never is: hiding the page you are on
  // would be a trapdoor. While the query is in flight everything shows, so
  // tabs never flicker away.
  const visible = new Set(modules ? visibleModules(modules) : ALL_MODULES)
  const shows = (tab: ModuleKey) => tab === active || visible.has(tab)

  return (
    <div className="flex items-center gap-2">
      {/* Mirror of ui/tabs.tsx TabsList (default variant, horizontal). */}
      <div className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
        {shows('entreprises') ? (
          <Link
            to="/app/$orgSlug/participations"
            params={{ orgSlug }}
            data-state={active === 'entreprises' ? 'active' : 'inactive'}
            className={triggerClass}
          >
            {t('participations:title')}
          </Link>
        ) : null}
        {shows('placements') ? (
          <Link
            to="/app/$orgSlug/placements"
            params={{ orgSlug }}
            data-state={active === 'placements' ? 'active' : 'inactive'}
            className={triggerClass}
          >
            {t('placements:title')}
          </Link>
        ) : null}
        {shows('immobilier') ? (
          <Link
            to="/app/$orgSlug/immobilier"
            params={{ orgSlug }}
            data-state={active === 'immobilier' ? 'active' : 'inactive'}
            className={triggerClass}
          >
            {t('immobilier:title')}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
