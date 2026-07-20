import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useAgo } from '~/components/cash/BankConnectionsHealth'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

export const Route = createFileRoute('/app/$orgSlug/settings/integrations')({
  component: IntegrationsSettings,
})

/** Status pill — same visual family as the connection pills on the Cash page
 * (palette classes with dark variants, no brand token). */
const STATE_PILL: Record<string, string> = {
  connected: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  stale: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  action_required: 'bg-red-500/15 text-red-700 dark:text-red-400',
  error: 'bg-red-500/15 text-red-700 dark:text-red-400',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  inactive: 'bg-muted text-muted-foreground',
}

function IntegrationsSettings() {
  const { t } = useTranslation(['settings'])
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })

  if (!org) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('settings:general.loading')}
      </p>
    )
  }
  return <IntegrationsList orgId={org._id} />
}

function IntegrationsList({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation(['settings'])
  const ago = useAgo()
  const integrations = useConvexQuery(api.connections.listIntegrations, {
    orgId,
  })

  if (!integrations) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('settings:general.loading')}
      </p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:integrations.title')}</CardTitle>
        <CardDescription>
          {t('settings:integrations.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-lg border">
          {integrations.map((item) => (
            <div key={item.platform} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {t(`settings:integrations.platforms.${item.platform}.name`)}
                  </span>
                  <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                    {t(`settings:integrations.scope.${item.scope}`)}
                  </span>
                </span>
                {/* Global connectors carry one org-independent state pill. */}
                {item.configured !== undefined && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.configured
                        ? STATE_PILL.connected
                        : STATE_PILL.inactive
                    }`}
                  >
                    {item.configured
                      ? t('settings:integrations.globalConfigured')
                      : t('settings:integrations.globalNotConfigured')}
                  </span>
                )}
                {item.connections !== undefined &&
                  item.connections.length === 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_PILL.inactive}`}
                    >
                      {t('settings:integrations.none')}
                    </span>
                  )}
              </div>
              <p className="text-muted-foreground text-xs">
                {t(
                  `settings:integrations.platforms.${item.platform}.description`,
                )}
              </p>
              {(item.connections ?? []).map((c) => (
                <div
                  key={c.label}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>{c.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATE_PILL[c.state] ?? STATE_PILL.inactive
                    }`}
                  >
                    {t(`settings:integrations.state.${c.state}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {c.lastConnectedAt != null
                      ? t('settings:integrations.lastSync', {
                          ago: ago(c.lastConnectedAt),
                        })
                      : t('settings:integrations.neverSynced')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
