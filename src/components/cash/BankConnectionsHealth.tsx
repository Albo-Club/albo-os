import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/** `untracked` = a Powens-linked account whose connection has no tracking
 * row (connection made under an unmanaged Powens user — nothing refreshes,
 * nothing is monitored). Fix = a fresh « Connecter une banque », not a
 * reconnect (there is no tracked connection to reconnect).
 *
 * `obsolete` = a degraded connection feeding no account (leftover of a failed
 * connection attempt, or accounts taken over by another connection). Nothing
 * to repair and nothing to alert on: it is offered for deletion. */
type Health =
  | 'connected'
  | 'stale'
  | 'action_required'
  | 'untracked'
  | 'obsolete'

/** Health states worth an alert — `obsolete` is deliberately out (no incident
 * behind it), which is what makes the banner disappear on its own. */
function isDegraded(health: Health): boolean {
  return health !== 'connected' && health !== 'obsolete'
}

/** Status pill — same visual family as the session pill in
 * active-sessions.tsx (palette classes with dark variants, no brand token). */
const HEALTH_PILL: Record<Health, string> = {
  connected: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  stale: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  action_required: 'bg-red-500/15 text-red-700 dark:text-red-400',
  untracked: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  obsolete: 'bg-muted text-muted-foreground',
}

/** Relative "il y a X min/h/j" formatter — shared with the per-account
 * freshness badges (CashAccounts). */
export function useAgo() {
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
 * Action banner shown at the top of the « Vue d'ensemble » tab when at
 * least one Powens connection is degraded: names the banks and links to
 * the connections list of the « Règles & échéances » tab (where the
 * reconnect flow lives). Renders nothing when everything is healthy.
 */
export function ConnectionsBanner({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
}) {
  const { t } = useTranslation('cash')
  const connections = useConvexQuery(api.powens.listConnections, { orgId })

  const degraded = (connections ?? []).filter((c) => isDegraded(c.health))
  if (degraded.length === 0) return null

  const worst: Health = degraded.some((c) => c.health === 'action_required')
    ? 'action_required'
    : degraded.some((c) => c.health === 'stale')
      ? 'stale'
      : 'untracked'
  const names = degraded
    .map((c) => c.connectorName ?? t('connections.unknownConnector'))
    .join(', ')
  const tone =
    worst === 'action_required'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      <span className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" />
        {t(`connections.banner.${worst}`, { count: degraded.length, names })}
      </span>
      <Button asChild size="sm" variant="outline">
        <Link
          to="/app/$orgSlug/cash"
          params={{ orgSlug }}
          search={{ tab: 'gestion' }}
        >
          {t('connections.banner.manage')}
        </Link>
      </Button>
    </div>
  )
}

/**
 * Sync-health of the org's Powens bank connections: one row per connection
 * with a health pill (connected / late / reconnect needed / untracked /
 * obsolete), the last successful sync, the accounts it feeds, and a
 * "Reconnect" button opening the Powens webview reconnect flow when the
 * connection is degraded (tracked ones only) — replaced by "Delete" on an
 * obsolete one. Renders nothing while loading or when the org has no
 * tracked connection nor untracked Powens-linked account.
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
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(
    null,
  )

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
            key={c.key}
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
                  ? t(
                      c.health === 'untracked'
                        ? 'connections.lastData'
                        : 'connections.lastSync',
                      { ago: ago(c.lastSuccessfulSyncAt) },
                    )
                  : t('connections.neverSynced')}
                {c.accountLabels.length > 0 && (
                  <> · {c.accountLabels.join(', ')}</>
                )}
              </span>
              {c.health === 'untracked' && (
                <span className="text-muted-foreground text-xs">
                  {t('connections.untrackedHint')}
                </span>
              )}
              {c.health === 'obsolete' && (
                <span className="text-muted-foreground text-xs">
                  {t('connections.obsoleteHint')}
                </span>
              )}
              {c.errorMessage && (
                <span className="text-destructive text-xs">
                  {c.errorMessage}
                </span>
              )}
            </div>
            {/* No reconnect for an untracked connection: there is nothing to
                reconnect under the managed Powens user — the fix is a fresh
                « Connecter une banque ». */}
            {isDegraded(c.health) && c.health !== 'untracked' && (
              <Button
                size="sm"
                variant={c.health === 'action_required' ? 'default' : 'outline'}
                disabled={reconnectingId !== null}
                onClick={() => handleReconnect(c.powensConnectionId)}
              >
                {reconnectingId === c.powensConnectionId
                  ? t('connections.reconnecting')
                  : t('connections.reconnect')}
              </Button>
            )}
            {c.health === 'obsolete' && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() =>
                  setDeleting({
                    id: c.powensConnectionId,
                    name: c.connectorName ?? t('connections.unknownConnector'),
                  })
                }
              >
                {t('connections.delete')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {deleting && (
        <DeleteConnectionDialog
          orgId={orgId}
          connection={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

/** Confirms deleting an obsolete connection — it disappears from Powens as
 * well, so it can never come back through the polling cron. */
function DeleteConnectionDialog({
  orgId,
  connection,
  onClose,
}: {
  orgId: Id<'organizations'>
  connection: { id: string; name: string }
  onClose: () => void
}) {
  const { t } = useTranslation(['cash', 'common'])
  const deleteConnection = useAction(api.powens.deleteConnection)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    try {
      await deleteConnection({ orgId, powensConnectionId: connection.id })
      toast.success(t('cash:connections.deleted'))
      onClose()
    } catch {
      toast.error(t('cash:connections.deleteFailed'))
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('cash:connections.deleteConfirm.title', {
              name: connection.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t('cash:connections.deleteConfirm.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={pending}
          >
            {t('cash:connections.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
