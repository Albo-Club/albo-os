import { useState } from 'react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'

type Health = 'connected' | 'stale' | 'action_required'

/** Status pill — same visual family as the session pill in
 * active-sessions.tsx (palette classes with dark variants, no brand token). */
const HEALTH_PILL: Record<Health, string> = {
  connected: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  stale: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  action_required: 'bg-red-500/15 text-red-700 dark:text-red-400',
}

function useAgo() {
  const { t } = useTranslation('cash')
  return (ms: number) => {
    const minutes = Math.max(1, Math.round((Date.now() - ms) / 60_000))
    if (minutes < 90) return t('connections.ago.minutes', { count: minutes })
    const hours = Math.round(minutes / 60)
    if (hours < 48) return t('connections.ago.hours', { count: hours })
    return t('connections.ago.days', { count: Math.round(hours / 24) })
  }
}

/**
 * Sync-health of the org's Powens bank connections: one row per connection
 * with a health pill (connected / late / reconnect needed), the last
 * successful sync, the accounts it feeds, and a "Reconnect" button opening
 * the Powens webview reconnect flow when the connection is degraded.
 * Renders nothing while loading or when the org has no tracked connection.
 */
export function BankConnectionsHealth({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('cash')
  const ago = useAgo()
  const connections = useConvexQuery(api.powens.listConnections, { orgId })
  const startReconnect = useAction(api.powens.startReconnect)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)

  if (!connections || connections.length === 0) return null

  async function handleReconnect(powensConnectionId: string) {
    setReconnectingId(powensConnectionId)
    try {
      const { webviewUrl } = await startReconnect({
        orgId,
        powensConnectionId,
      })
      window.location.href = webviewUrl
    } catch {
      toast.error(t('connections.reconnectFailed'))
      setReconnectingId(null)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight">
        {t('connections.title')}
      </h2>
      <div className="divide-y rounded-lg border">
        {connections.map((c) => (
          <div
            key={c._id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {c.connectorName ?? t('connections.unknownConnector')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_PILL[c.health]}`}
                >
                  {t(`connections.health.${c.health}`)}
                </span>
              </span>
              <span className="text-muted-foreground text-xs">
                {c.lastSuccessfulSyncAt != null
                  ? t('connections.lastSync', {
                      ago: ago(c.lastSuccessfulSyncAt),
                    })
                  : t('connections.neverSynced')}
                {c.accountLabels.length > 0 && (
                  <> · {c.accountLabels.join(', ')}</>
                )}
              </span>
              {c.errorMessage && (
                <span className="text-destructive text-xs">
                  {c.errorMessage}
                </span>
              )}
            </div>
            {c.health !== 'connected' && (
              <Button
                size="sm"
                variant={
                  c.health === 'action_required' ? 'default' : 'outline'
                }
                disabled={reconnectingId !== null}
                onClick={() => handleReconnect(c.powensConnectionId)}
              >
                {reconnectingId === c.powensConnectionId
                  ? t('connections.reconnecting')
                  : t('connections.reconnect')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
