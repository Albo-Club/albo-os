import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { AppSidebar } from '~/components/app-shell/AppSidebar'
import { AppHeader } from '~/components/app-shell/AppHeader'
import { getAllNavGroups } from '~/components/app-shell/nav'

export const Route = createFileRoute('/app/all')({
  component: AllOrgsLayout,
})

function AllOrgsLayout() {
  const { t } = useTranslation('nav')
  const me = useConvexQuery(api.users.me)

  if (!me || me.kind !== 'ready') {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </main>
    )
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar
        orgs={me.orgs}
        currentSlug="all"
        myRole={undefined}
        navGroups={getAllNavGroups()}
        me={{
          name: me.user.name,
          email: me.user.email,
          avatarUrl: me.user.avatarUrl,
          superAdmin: me.user.superAdmin,
        }}
      />
      <SidebarInset className="overflow-hidden">
        <AppHeader orgSlug="all" orgName={t('orgSwitcher.allOrganizations')} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
