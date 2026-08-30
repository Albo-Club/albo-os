import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SIDEBAR_MODULES, isVisible } from '../../../convex/lib/modules'
import { OrgSwitcher } from './OrgSwitcher'
import { NavUser } from './NavUser'
import { getNavGroups } from './nav'
import { ModuleActivator } from './ModuleActivator'
import type { ModuleState } from '../../../convex/lib/modules'
import type { Id } from '../../../convex/_generated/dataModel'
import type { NavGroup } from './nav'
import { Badge } from '~/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar'

type NavLeaf = ReturnType<typeof getNavGroups>[number]['items'][number]

type Org = {
  _id: string
  slug: string
  name: string
  logoUrl?: string | null
  role: string
}

type Me = {
  name: string | null
  email: string
  avatarUrl: string | null | undefined
  superAdmin: boolean
}

export function AppSidebar({
  orgs,
  currentSlug,
  myRole,
  me,
  navGroups,
  orgId,
  modules,
}: {
  orgs: Array<Org>
  currentSlug: string
  myRole: string | undefined
  me: Me
  navGroups?: Array<NavGroup>
  /** Absent in the cross-org view, which has no modules to activate. */
  orgId?: Id<'organizations'>
  modules?: Array<ModuleState>
}) {
  const location = useLocation()
  const { t } = useTranslation(['nav', 'common'])
  const groups = navGroups ?? getNavGroups()
  const isAdmin = myRole === 'admin' || myRole === 'owner'

  const renderItem = (item: NavLeaf, size?: 'sm') => {
    const Icon = item.icon
    const title = t(`nav:${item.titleKey}`)

    if (item.soon) {
      return (
        <SidebarMenuItem key={item.titleKey}>
          <SidebarMenuButton
            disabled
            tooltip={title}
            size={size}
            aria-disabled="true"
            className="cursor-not-allowed"
          >
            {Icon ? <Icon className="opacity-60" /> : null}
            <span className="opacity-60">{title}</span>
            <Badge
              variant="outline"
              className="ml-auto border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-800/50 dark:bg-yellow-950/50 dark:text-yellow-300 group-data-[collapsible=icon]:hidden"
            >
              {t('nav:soon')}
            </Badge>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    }

    const isParam = item.to.includes('$orgSlug')
    const href = isParam ? item.to.replace('$orgSlug', currentSlug) : item.to
    // Exact-or-prefix match against a resolved path (`$orgSlug` substituted).
    const matchesPath = (path: string) =>
      location.pathname === path || location.pathname.startsWith(path + '/')
    const isActive =
      item.to === '/app/$orgSlug'
        ? location.pathname === href
        : matchesPath(href) ||
          (item.alsoActiveOn ?? []).some((prefix) =>
            matchesPath(prefix.replace('$orgSlug', currentSlug)),
          )
    return (
      <SidebarMenuItem key={item.titleKey}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={title}
          size={size}
        >
          {isParam ? (
            <Link to={item.to} params={{ orgSlug: currentSlug }}>
              {Icon ? <Icon /> : null}
              <span>{title}</span>
            </Link>
          ) : (
            <Link to={item.to}>
              {Icon ? <Icon /> : null}
              <span>{title}</span>
            </Link>
          )}
        </SidebarMenuButton>
        {item.demo && <SidebarMenuBadge>{t('common:demo')}</SidebarMenuBadge>}
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <OrgSwitcher orgs={orgs} currentSlug={currentSlug} />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const visibleItems = group.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false
            // An entry with no module is always shown — « À faire » carries
            // the signals of every other one, and the workspace entries are
            // not modules (SPEC D37).
            if (!item.module) return true
            // While the query is in flight, show everything: a sidebar that
            // flickers items away on load reads as data loss.
            if (!modules) return true
            const state = modules.find((row) => row.key === item.module)
            return state ? isVisible(state) : true
          })
          const activator =
            orgId && !group.secondary ? (
              <ModuleActivator
                orgId={orgId}
                states={modules}
                among={SIDEBAR_MODULES}
                variant="sidebar"
              />
            ) : null
          if (visibleItems.length === 0 && !activator) return null
          return (
            <SidebarGroup
              key={group.labelKey}
              className={group.secondary ? 'mt-auto' : undefined}
            >
              {!group.secondary && (
                <SidebarGroupLabel>{t(`nav:${group.labelKey}`)}</SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) =>
                    renderItem(item, group.secondary ? 'sm' : undefined),
                  )}
                  {activator}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          name={me.name}
          email={me.email}
          avatarUrl={me.avatarUrl}
          superAdmin={me.superAdmin}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
