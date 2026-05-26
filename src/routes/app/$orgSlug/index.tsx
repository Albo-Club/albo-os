import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { Mail, PieChart, Users, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { KpiCard } from '~/components/dashboard/KpiCard'

export const Route = createFileRoute('/app/$orgSlug/')({
  component: OrgDashboard,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'dashboard')('metaTitle'),
      },
    ],
  }),
})

function OrgDashboard() {
  const { t } = useTranslation(['dashboard', 'common'])
  const { orgSlug } = Route.useParams()
  const me = useConvexQuery(api.users.me)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })

  const myRole =
    me?.kind === 'ready'
      ? me.orgs.find((o) => o.slug === orgSlug)?.role
      : undefined
  const isAdmin = myRole === 'admin' || myRole === 'owner'

  const members = useConvexQuery(
    api.organizations.listMembers,
    org ? { orgId: org._id } : 'skip',
  )
  const invitations = useConvexQuery(
    api.invitations.listForOrg,
    org && isAdmin ? { orgId: org._id } : 'skip',
  )

  const membersCount = members?.length ?? 0
  const pendingInvites = invitations?.length ?? 0

  return (
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {org?.name ?? orgSlug}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t('dashboard:subtitle')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('dashboard:kpi.activeMembers')}
          value={membersCount}
          hint={
            isAdmin
              ? t('dashboard:kpi.pendingInvites', { count: pendingInvites })
              : undefined
          }
          icon={Users}
        />
        <KpiCard
          label={t('dashboard:kpi.pendingInvitations')}
          value={isAdmin ? pendingInvites : '—'}
          hint={isAdmin ? undefined : t('dashboard:kpi.adminOnly')}
          icon={Mail}
        />
        <KpiCard
          label={t('dashboard:kpi.participations')}
          value="—"
          hint={t('dashboard:kpi.comingSoon')}
          icon={PieChart}
        />
        <KpiCard
          label={t('dashboard:kpi.cash')}
          value="—"
          hint={t('dashboard:kpi.comingSoon')}
          icon={Wallet}
        />
      </div>
    </main>
  )
}
