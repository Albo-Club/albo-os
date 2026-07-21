import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'
import { Link2, Loader2, Unlink } from 'lucide-react'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useAgo } from '~/components/cash/BankConnectionsHealth'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'

export const Route = createFileRoute('/app/$orgSlug/settings/integrations')({
  component: IntegrationsSettings,
})

/** Status dot (Attio-style): the color alone carries the state — green OK,
 * amber degraded, red broken, gray inactive. The text label lives in the
 * dot's tooltip (`title`), never inline. */
const STATE_DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  stale: 'bg-amber-500',
  action_required: 'bg-red-500',
  error: 'bg-red-500',
  pending: 'bg-amber-500',
  inactive: 'bg-muted-foreground/40',
}

function StateDot({ state, label }: { state: string; label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block size-2 shrink-0 rounded-full ${
        STATE_DOT[state] ?? STATE_DOT.inactive
      }`}
    />
  )
}

type Integration = (typeof api.connections.listIntegrations)['_returnType'][number]

function IntegrationsSettings() {
  const { t } = useTranslation(['settings'])
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const me = useConvexQuery(api.users.me)
  const role =
    me?.kind === 'ready'
      ? me.orgs.find((o) => o.slug === orgSlug)?.role
      : undefined
  const canManage = role === 'admin' || role === 'owner'

  if (!org) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('settings:general.loading')}
      </p>
    )
  }
  return <IntegrationsList orgId={org._id} canManage={canManage} />
}

function IntegrationsList({
  orgId,
  canManage,
}: {
  orgId: Id<'organizations'>
  canManage: boolean
}) {
  const { t } = useTranslation(['settings'])
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

  // "Installed" = the org already has at least one connection, or the global
  // capability is operational; everything else is "available to connect".
  const isInstalled = (i: Integration) =>
    (i.connections?.length ?? 0) > 0 || i.configured === true
  const installed = integrations.filter(isInstalled)
  const available = integrations.filter((i) => !isInstalled(i))

  return (
    <div className="space-y-6">
      <IntegrationsGroup
        title={t('settings:integrations.groups.installed')}
        description={t('settings:integrations.description')}
        items={installed}
        emptyLabel={t('settings:integrations.groups.installedEmpty')}
        orgId={orgId}
        canManage={canManage}
      />
      <IntegrationsGroup
        title={t('settings:integrations.groups.available')}
        description={t('settings:integrations.groups.availableDescription')}
        items={available}
        emptyLabel={t('settings:integrations.groups.availableEmpty')}
        orgId={orgId}
        canManage={canManage}
      />
    </div>
  )
}

function IntegrationsGroup({
  title,
  description,
  items,
  emptyLabel,
  orgId,
  canManage,
}: {
  title: string
  description: string
  items: Array<Integration>
  emptyLabel: string
  orgId: Id<'organizations'>
  canManage: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {items.map((item) => (
              <PlatformRow
                key={item.platform}
                item={item}
                orgId={orgId}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PlatformRow({
  item,
  orgId,
  canManage,
}: {
  item: Integration
  orgId: Id<'organizations'>
  canManage: boolean
}) {
  const { t } = useTranslation(['settings', 'common'])
  const ago = useAgo()
  const [connectOpen, setConnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState<{
    id: string
    label: string
  } | null>(null)

  const startBank = useAction(api.powens.startBankConnection)
  const startReconnect = useAction(api.powens.startReconnect)
  const [redirecting, setRedirecting] = useState<string | null>(null)

  async function openWebview(kind: 'connect' | 'reconnect', id?: string) {
    setRedirecting(id ?? 'new')
    try {
      const { webviewUrl } =
        kind === 'connect'
          ? await startBank({ orgId })
          : await startReconnect({ orgId, powensConnectionId: id! })
      window.location.href = webviewUrl
    } catch {
      toast.error(t('settings:integrations.toasts.bankRedirectError'))
      setRedirecting(null)
    }
  }

  const connections = item.connections ?? []
  const hasConnections = connections.length > 0
  // Prominent "Connecter" only while nothing is connected; once a connection
  // exists the entry point shrinks to a discreet "Ajouter" (multi-portal /
  // multi-bank stays possible without shouting).
  const connectVariant = hasConnections ? 'ghost' : 'outline'
  const connectLabel = hasConnections
    ? t('settings:integrations.actions.add')
    : item.auth === 'webview'
      ? t('settings:integrations.actions.connectBank')
      : t('settings:integrations.actions.connect')

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {t(`settings:integrations.platforms.${item.platform}.name`)}
          </span>
          {/* Global connectors: the dot alone says operational or not. */}
          {item.configured !== undefined && (
            <StateDot
              state={item.configured ? 'connected' : 'inactive'}
              label={
                item.configured
                  ? t('settings:integrations.globalConfigured')
                  : t('settings:integrations.globalNotConfigured')
              }
            />
          )}
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
            {t(`settings:integrations.scope.${item.scope}`)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {canManage && item.auth === 'webview' && (
            <Button
              size="sm"
              variant={connectVariant}
              className={hasConnections ? 'text-muted-foreground' : undefined}
              disabled={redirecting !== null}
              onClick={() => void openWebview('connect')}
            >
              {redirecting === 'new' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {connectLabel}
            </Button>
          )}
          {canManage && item.auth === 'credentials' && (
            <Button
              size="sm"
              variant={connectVariant}
              className={hasConnections ? 'text-muted-foreground' : undefined}
              onClick={() => setConnectOpen(true)}
            >
              <Link2 className="size-4" />
              {connectLabel}
            </Button>
          )}
        </span>
      </div>
      <p className="text-muted-foreground/80 text-xs">
        {t(`settings:integrations.platforms.${item.platform}.description`)}
      </p>
      {connections.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <StateDot
              state={c.state}
              label={t(`settings:integrations.state.${c.state}`)}
            />
            <span className="truncate">{c.label}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs tabular-nums">
              {c.lastConnectedAt != null
                ? t('settings:integrations.lastSync', {
                    ago: ago(c.lastConnectedAt),
                  })
                : t('settings:integrations.neverSynced')}
            </span>
            {canManage &&
              item.auth === 'webview' &&
              c.state !== 'connected' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={redirecting !== null}
                  onClick={() => void openWebview('reconnect', c.id)}
                >
                  {redirecting === c.id
                    ? t('settings:integrations.actions.reconnecting')
                    : t('settings:integrations.actions.reconnect')}
                </Button>
              )}
            {canManage && item.auth === 'credentials' && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={t('settings:integrations.actions.disconnect')}
                title={t('settings:integrations.actions.disconnect')}
                onClick={() => setDisconnecting({ id: c.id, label: c.label })}
              >
                <Unlink className="size-4" />
              </Button>
            )}
          </span>
        </div>
      ))}

      {connectOpen && (
        <ConnectDialog
          item={item}
          orgId={orgId}
          onClose={() => setConnectOpen(false)}
        />
      )}
      {disconnecting && (
        <DisconnectDialog
          connection={disconnecting}
          onClose={() => setDisconnecting(null)}
        />
      )}
    </div>
  )
}

/**
 * Generic connect form for a credentials platform: the fields are DRIVEN BY
 * THE REGISTRY declaration (configKeys + credentialKeys) — a new platform
 * gets its form without any UI change (field labels resolve from
 * `settings:integrations.fields.<key>`, falling back to the raw key).
 */
function ConnectDialog({
  item,
  orgId,
  onClose,
}: {
  item: Integration
  orgId: Id<'organizations'>
  onClose: () => void
}) {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const create = useConvexMutation(api.connections.createConnection)
  const [label, setLabel] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const configKeys = item.configKeys ?? []
  const credentialKeys = item.credentialKeys ?? []
  const allKeys = [...configKeys, ...credentialKeys]
  const complete =
    label.trim().length > 0 && allKeys.every((k) => (values[k] ?? '').trim())

  const fieldLabel = (key: string) => {
    const i18nKey = `settings:integrations.fields.${key}`
    return i18n.exists(i18nKey) ? t(i18nKey) : key
  }
  // Per-platform helper text and placeholder, resolved from i18n so a new
  // platform documents its own fields without touching this generic form.
  const fieldHelp = (key: string) => {
    const i18nKey = `settings:integrations.fieldHelp.${item.platform}.${key}`
    return i18n.exists(i18nKey) ? t(i18nKey) : null
  }
  const fieldPlaceholder = (key: string) => {
    const i18nKey = `settings:integrations.fieldPlaceholders.${item.platform}.${key}`
    return i18n.exists(i18nKey) ? t(i18nKey) : undefined
  }

  async function handleSubmit() {
    setSaving(true)
    try {
      await create({
        orgId,
        platform: item.platform,
        label: label.trim(),
        config: Object.fromEntries(
          configKeys.map((k) => [k, values[k].trim()]),
        ),
        credentials: Object.fromEntries(
          credentialKeys.map((k) => [k, values[k]]),
        ),
      })
      toast.success(t('settings:integrations.toasts.connected'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'label_taken'
          ? t('settings:integrations.toasts.labelTaken')
          : t('settings:integrations.toasts.connectError'),
      )
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('settings:integrations.dialog.title', {
              name: t(`settings:integrations.platforms.${item.platform}.name`),
            })}
          </DialogTitle>
          <DialogDescription>
            {t('settings:integrations.dialog.description')}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="connection-label">
              {t('settings:integrations.fields.label')}
            </FieldLabel>
            <Input
              id="connection-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('settings:integrations.fields.labelPlaceholder')}
            />
          </Field>
          {allKeys.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`connection-${key}`}>
                {fieldLabel(key)}
              </FieldLabel>
              <Input
                id={`connection-${key}`}
                type={
                  key.toLowerCase().includes('password') ? 'password' : 'text'
                }
                autoComplete="off"
                value={values[key] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                placeholder={fieldPlaceholder(key)}
              />
              {fieldHelp(key) && (
                <FieldDescription>{fieldHelp(key)}</FieldDescription>
              )}
            </Field>
          ))}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!complete || saving}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('settings:integrations.actions.connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Disconnect = forget the stored credentials (the already-imported data
 * stays). Confirmation dialog, admin-only. */
function DisconnectDialog({
  connection,
  onClose,
}: {
  connection: { id: string; label: string }
  onClose: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const disconnect = useConvexMutation(api.connections.disconnectConnection)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    try {
      await disconnect({
        connectionId: connection.id as Id<'externalConnections'>,
      })
      toast.success(t('settings:integrations.toasts.disconnected'))
      onClose()
    } catch {
      toast.error(t('settings:integrations.toasts.disconnectError'))
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings:integrations.confirm.title', {
              label: connection.label,
            })}
          </DialogTitle>
          <DialogDescription>
            {t('settings:integrations.confirm.description')}
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
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('settings:integrations.actions.disconnect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
