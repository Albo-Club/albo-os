import { Plus } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import { activatableModules } from '../../../convex/lib/modules'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ModuleKey, ModuleState } from '../../../convex/lib/modules'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '~/components/ui/sidebar'

/**
 * « Activer un module » — the escape hatch that makes D37 workable.
 *
 * Hiding an empty module automatically would hide it exactly when it is
 * needed: to create its FIRST element. So every hidden module stays one
 * click away, and turning one on shows it whether or not it holds anything.
 *
 * Renders nothing when every module of the surface is already visible —
 * there is nothing to offer.
 */
export function ModuleActivator({
  orgId,
  states,
  among,
  variant,
}: {
  orgId: Id<'organizations'>
  states: Array<ModuleState> | undefined
  among: ReadonlyArray<ModuleKey>
  /** `sidebar` renders a sidebar row; `tabs` a compact ⋯ trigger. */
  variant: 'sidebar' | 'tabs'
}) {
  const { t } = useTranslation('nav')
  const setEnabled = useConvexMutation(api.modules.setEnabled)
  const hidden = states ? activatableModules(states, among) : []

  if (hidden.length === 0) return null

  async function activate(module: ModuleKey) {
    try {
      await setEnabled({ orgId, module, enabled: true })
      toast.success(t('modules.activated', { module: t(`modules.${module}`) }))
    } catch {
      toast.error(t('modules.failed'))
    }
  }

  const items = (
    <DropdownMenuContent align="start">
      {hidden.map((module) => (
        <DropdownMenuItem key={module} onSelect={() => void activate(module)}>
          {t(`modules.${module}`)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  )

  if (variant === 'tabs') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1 text-sm"
          aria-label={t('modules.activate')}
        >
          ⋯
        </DropdownMenuTrigger>
        {items}
      </DropdownMenu>
    )
  }

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="sm" tooltip={t('modules.activate')}>
            <Plus />
            <span>{t('modules.activate')}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        {items}
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
