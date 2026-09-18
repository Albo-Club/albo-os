import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import {
  ALL_MODULES,
  hideBlockedBy,
  visibleModules,
} from '../../../convex/lib/modules'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ModuleKey } from '../../../convex/lib/modules'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Button } from '~/components/ui/button'

/**
 * Which sub-sections of Investissements are on screen.
 *
 * It lists all three with their state and goes BOTH WAYS. The first version
 * only listed what was hidden and only ever wrote « enabled »: once a
 * sub-section was added, it left the menu and nothing could take it back out.
 * The server always accepted `false`; no screen ever asked.
 *
 * A row that cannot be hidden says why rather than disappearing: it holds
 * rows (hiding it would take them along), or it is the last one left. Both
 * rules live in `convex/lib/modules.ts` — the server cannot end up in a
 * hidden-everything state either, since `visibleModules` falls back.
 *
 * It lives in the page's OWN ⋯, on the title row — not next to the tabs and
 * not in a second ⋯ below the first. Two identical triggers stacked in the
 * same corner is what the far-right placement produced on Entreprises, which
 * already had a ⋯ for its page actions.
 */
export function SubsectionsItems({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation([
    'nav',
    'participations',
    'placements',
    'immobilier',
  ])
  // Its own subscription rather than a prop from each page: Convex shares one
  // subscription per (query, args), so this is the same read the tab row does.
  const states = useConvexQuery(api.modules.list, { orgId })
  const setEnabled = useConvexMutation(api.modules.setEnabled)

  const label: Record<ModuleKey, string> = {
    entreprises: t('participations:title'),
    placements: t('placements:title'),
    immobilier: t('immobilier:title'),
  }

  async function toggle(module: ModuleKey, next: boolean) {
    try {
      await setEnabled({ orgId, module, enabled: next })
      toast.success(
        t(next ? 'nav:modules.shown' : 'nav:modules.hidden', {
          module: label[module],
        }),
      )
    } catch {
      toast.error(t('nav:modules.failed'))
    }
  }

  const visible = states ? visibleModules(states) : []

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs">
        {t('nav:modules.subsections')}
      </DropdownMenuLabel>
      {ALL_MODULES.map((module) => {
        // Read off `visibleModules` and not off `isVisible` alone: the
        // fallback puts Entreprises on screen for an org that has chosen
        // nothing, and a row shown as unticked while its tab is there would
        // be a lie. While the query is in flight everything reads as on,
        // like the tabs themselves.
        const on = states ? visible.includes(module) : true
        const blocked = states ? hideBlockedBy(states, module) : null
        return (
          <DropdownMenuCheckboxItem
            key={module}
            checked={on}
            disabled={!states || (on && blocked !== null)}
            // Radix closes the menu on select; keeping it open lets several
            // sub-sections be ticked in one go.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(next) => void toggle(module, next)}
          >
            <span>{label[module]}</span>
            {on && blocked ? (
              <span className="text-muted-foreground ml-auto pl-3 text-xs">
                {t(`nav:modules.blocked.${blocked}`)}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        )
      })}
    </>
  )
}

/**
 * The same list behind its own ⋯ — for the two pages of the section whose
 * title row carries plain buttons and no menu of its own (Placements,
 * Immobilier). On Entreprises the items go straight into the page's existing
 * ⋯ instead, so there is never more than one in the corner.
 */
export function SubsectionsMenu({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation('nav')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('modules.subsections')}
        >
          <span aria-hidden className="text-base leading-none">
            ⋯
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <SubsectionsItems orgId={orgId} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
