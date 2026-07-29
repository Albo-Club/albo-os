import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

/**
 * Shared sub-nav of the Investissements section: two router links switching
 * between the Entreprises (participations) and Placements pages. Styled
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
}: {
  orgSlug: string
  active: 'entreprises' | 'placements'
}) {
  const { t } = useTranslation(['participations', 'placements'])

  return (
    // Mirror of ui/tabs.tsx TabsList (default variant, horizontal).
    <div className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
      <Link
        to="/app/$orgSlug/participations"
        params={{ orgSlug }}
        data-state={active === 'entreprises' ? 'active' : 'inactive'}
        className={triggerClass}
      >
        {t('participations:title')}
      </Link>
      <Link
        to="/app/$orgSlug/placements"
        params={{ orgSlug }}
        data-state={active === 'placements' ? 'active' : 'inactive'}
        className={triggerClass}
      >
        {t('placements:title')}
      </Link>
    </div>
  )
}
