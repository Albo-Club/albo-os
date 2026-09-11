import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Unlink,
} from 'lucide-react'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useAgo } from '~/components/cash/BankConnectionsHealth'
import { CompanyLogo } from '~/components/CompanyLogo'
import { bankDomain } from '~/lib/bankDomains'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'

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

/** platform → website domain, feeding the same logo.dev hotlink as company
 * and bank logos (CompanyLogo). A connection shows its own provider's logo
 * (the bank, via `bankDomain`) and falls back to its platform's. */
const PLATFORM_DOMAINS: Record<string, string | undefined> = {
  powens: 'powens.com',
  vasco: 'vasco.fund',
}

/** VASCO portal slug (`clientSlug`) → website domain. The slug never yields
 * the domain (`parallel` → parallel-invest.com, `teampact` → teampact.ventures),
 * so a lookup is unavoidable; a new portal costs one line here, and an unknown
 * one is not broken, just generic — it falls back to VASCO's own logo. */
const PORTAL_DOMAINS: Record<string, string | undefined> = {
  parallel: 'parallel-invest.com',
  teampact: 'teampact.ventures',
}

/** Logo of ONE connection, most specific first: the provider it reaches (the
 * bank for Powens, the portal for VASCO), then the platform it goes through,
 * then CompanyLogo's generic icon. */
function connectionDomain(
  platform: string,
  connection: { providerName?: string; config?: Record<string, string> },
): string | undefined {
  return (
    bankDomain(connection.providerName) ??
    PORTAL_DOMAINS[connection.config?.clientSlug ?? ''] ??
    PLATFORM_DOMAINS[platform]
  )
}

/** The explanatory copy of a row, folded into a discreet « i ». Prose in
 * permanent grey turns into noise nobody reads; on demand it stays useful. */
function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="text-muted-foreground/50 hover:text-foreground shrink-0 transition-colors"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  )
}

type Integration =
  (typeof api.connections.listIntegrations)['_returnType'][number]

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

  // "Installed" = the org already has at least one connection; everything
  // else is "available to connect".
  const isInstalled = (i: Integration) => (i.connections?.length ?? 0) > 0
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
      <McpConnectorCard />
    </div>
  )
}

/**
 * The claude.ai / MCP connector. Unlike every other row on this page it is a
 * *personal* OAuth grant, not an org connection: there is nothing to store,
 * nothing to sync and no admin gate — only the URL to paste, which is why it
 * lives in its own card rather than in the platform registry.
 *
 * The URL is read from the browser rather than from an env var so it is
 * always the domain the user is actually on (localhost, preview, prod).
 */
function McpConnectorCard() {
  const { t } = useTranslation(['settings'])
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setUrl(`${window.location.origin}/mcp`)
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:integrations.mcp.title')}</CardTitle>
        <CardDescription>
          {t('settings:integrations.mcp.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor="mcp-url">
            {t('settings:integrations.mcp.urlLabel')}
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Input id="mcp-url" readOnly value={url} className="font-mono" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copy}
              disabled={!url}
              title={t('settings:integrations.mcp.copy')}
              aria-label={t('settings:integrations.mcp.copy')}
            >
              {copied ? (
                <Check className="size-4 text-emerald-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
          <FieldDescription>
            {t('settings:integrations.mcp.urlHelp')}
          </FieldDescription>
        </Field>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>{t('settings:integrations.mcp.steps.open')}</li>
          <li>{t('settings:integrations.mcp.steps.paste')}</li>
          <li>{t('settings:integrations.mcp.steps.signIn')}</li>
        </ol>
      </CardContent>
    </Card>
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
        <CardTitle className="flex items-center gap-2">
          {title}
          <InfoHint text={description} />
        </CardTitle>
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
  const [editing, setEditing] = useState<{
    id: string
    label: string
    config: Record<string, string>
  } | null>(null)
  const [renaming, setRenaming] = useState<{
    id: string
    label: string
  } | null>(null)
  const [disconnecting, setDisconnecting] = useState<{
    id: string
    label: string
  } | null>(null)
  const [deletingBank, setDeletingBank] = useState<{
    id: string
    label: string
    accountCount: number
  } | null>(null)

  const startBank = useAction(api.powens.startBankConnection)
  const startReconnect = useAction(api.powens.startReconnect)
  const [redirecting, setRedirecting] = useState<string | null>(null)

  const syncNow = useAction(api.connections.syncNow)
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    try {
      await syncNow({ orgId, platform: item.platform })
      toast.success(t('settings:integrations.toasts.synced'))
    } catch {
      toast.error(t('settings:integrations.toasts.syncError'))
    } finally {
      setSyncing(false)
    }
  }

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

  const platformName = t(
    `settings:integrations.platforms.${item.platform}.name`,
  )
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
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <CompanyLogo
            domain={PLATFORM_DOMAINS[item.platform]}
            companyName={platformName}
            size="md"
          />
          <span className="text-sm font-medium">{platformName}</span>
          <InfoHint
            text={t(
              `settings:integrations.platforms.${item.platform}.description`,
            )}
          />
        </span>
        <span className="flex items-center gap-2">
          {/* On-demand pull (registry `manualSync`) — member-level, read-only. */}
          {item.manualSync && hasConnections && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t('settings:integrations.actions.sync')}
              title={t('settings:integrations.actions.sync')}
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              <RefreshCw
                className={`size-4 ${syncing ? 'animate-spin' : ''}`}
              />
            </Button>
          )}
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
      {/* Connections are nested under the platform they go through: the guide
        * line is what says « these banks arrive via Powens » — at the same
        * indent level they read as a flat list of unrelated rows. */}
      {hasConnections && (
        <div className="ml-3 space-y-1 border-l pl-4">
          {connections.map((c) => (
            <div key={c.id} className="space-y-0.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <StateDot
                    state={c.state}
                    label={t(`settings:integrations.state.${c.state}`)}
                  />
                  <CompanyLogo
                    domain={connectionDomain(item.platform, c)}
                    companyName={c.label}
                    size="sm"
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
                    c.state !== 'connected' &&
                    c.state !== 'inactive' && (
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
                  {canManage && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={t('settings:integrations.actions.rename')}
                      title={t('settings:integrations.actions.rename')}
                      onClick={() => setRenaming({ id: c.id, label: c.label })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                  {canManage && item.auth === 'webview' && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={t('settings:integrations.actions.delete')}
                      title={t('settings:integrations.actions.delete')}
                      onClick={() =>
                        setDeletingBank({
                          id: c.id,
                          label: c.label,
                          accountCount: c.accountCount ?? 0,
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                  {canManage && item.auth === 'credentials' && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label={t('settings:integrations.actions.edit')}
                        title={t('settings:integrations.actions.edit')}
                        onClick={() =>
                          setEditing({
                            id: c.id,
                            label: c.label,
                            config: c.config ?? {},
                          })
                        }
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label={t('settings:integrations.actions.disconnect')}
                        title={t('settings:integrations.actions.disconnect')}
                        onClick={() =>
                          setDisconnecting({ id: c.id, label: c.label })
                        }
                      >
                        <Unlink className="size-4" />
                      </Button>
                    </>
                  )}
                </span>
              </div>
              {c.lastError && (
                <p className="text-destructive line-clamp-2 pl-4 text-xs">
                  {t('settings:integrations.lastError', { message: c.lastError })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {connectOpen && (
        <ConnectDialog
          item={item}
          orgId={orgId}
          onClose={() => setConnectOpen(false)}
        />
      )}
      {editing && (
        <ConnectDialog
          item={item}
          orgId={orgId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={item.manualSync ? () => void handleSync() : undefined}
        />
      )}
      {renaming && (
        <RenameDialog
          orgId={orgId}
          platform={item.platform}
          connection={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {disconnecting && (
        <DisconnectDialog
          connection={disconnecting}
          onClose={() => setDisconnecting(null)}
        />
      )}
      {deletingBank && (
        <DeleteBankConnectionDialog
          orgId={orgId}
          connection={deletingBank}
          onClose={() => setDeletingBank(null)}
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
 * With `existing`, the same form EDITS a connection in place (label + config
 * prefilled, credentials re-entered — they are write-only) and `onSaved`
 * fires after the update (used to re-sync immediately).
 */
function ConnectDialog({
  item,
  orgId,
  existing,
  onClose,
  onSaved,
}: {
  item: Integration
  orgId: Id<'organizations'>
  existing?: { id: string; label: string; config: Record<string, string> }
  onClose: () => void
  onSaved?: () => void
}) {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const create = useConvexMutation(api.connections.createConnection)
  const update = useConvexMutation(api.connections.updateConnection)
  const [label, setLabel] = useState(existing?.label ?? '')
  const [values, setValues] = useState<Record<string, string>>(
    existing ? { ...existing.config } : {},
  )
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
      const config = Object.fromEntries(
        configKeys.map((k) => [k, values[k].trim()]),
      )
      const credentials = Object.fromEntries(
        credentialKeys.map((k) => [k, values[k]]),
      )
      if (existing) {
        await update({
          connectionId: existing.id as Id<'externalConnections'>,
          label: label.trim(),
          config,
          credentials,
        })
        toast.success(t('settings:integrations.toasts.updated'))
      } else {
        await create({
          orgId,
          platform: item.platform,
          label: label.trim(),
          config,
          credentials,
        })
        toast.success(t('settings:integrations.toasts.connected'))
      }
      onSaved?.()
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
            {t(
              existing
                ? 'settings:integrations.dialog.editTitle'
                : 'settings:integrations.dialog.title',
              {
                name: t(
                  `settings:integrations.platforms.${item.platform}.name`,
                ),
              },
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              existing
                ? 'settings:integrations.dialog.editDescription'
                : 'settings:integrations.dialog.description',
            )}
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
            {existing
              ? t('common:actions.save')
              : t('settings:integrations.actions.connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Rename a connection — the one edit every connector shares, whatever its
 * auth kind: a label is ours, not the platform's. Nothing else is touched
 * (credentials stay untouched, the bank keeps sending its own name), which
 * is why it is a separate, credential-free dialog.
 */
function RenameDialog({
  orgId,
  platform,
  connection,
  onClose,
}: {
  orgId: Id<'organizations'>
  platform: string
  connection: { id: string; label: string }
  onClose: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const rename = useConvexMutation(api.connections.renameConnection)
  const [label, setLabel] = useState(connection.label)
  const [saving, setSaving] = useState(false)

  const trimmed = label.trim()

  async function handleSubmit() {
    setSaving(true)
    try {
      await rename({
        orgId,
        platform,
        connectionId: connection.id,
        label: trimmed,
      })
      toast.success(t('settings:integrations.toasts.renamed'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'label_taken'
          ? t('settings:integrations.toasts.labelTaken')
          : t('settings:integrations.toasts.renameError'),
      )
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings:integrations.rename.title', {
              label: connection.label,
            })}
          </DialogTitle>
          <DialogDescription>
            {t('settings:integrations.rename.description')}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="rename-label">
            {t('settings:integrations.fields.label')}
          </FieldLabel>
          <Input
            id="rename-label"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('settings:integrations.fields.labelPlaceholder')}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={saving || trimmed === '' || trimmed === connection.label}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete a bank connection for good — on the Powens side first, then its
 * tracking row (`powens.deleteConnection`, admin-gated). Unlike a portal's
 * « Déconnecter », there are no stored credentials to forget: the connection
 * lives on Powens, so it has to be removed there.
 *
 * The server refuses while the connection still feeds live accounts
 * (`connection_in_use`) — the guard is what keeps an account from losing its
 * feed behind the user's back. Rather than let the click fail, the dialog
 * reads `accountCount` and says so up front: the case that matters here is
 * the leftover of a failed reconnection, which feeds nothing.
 */
function DeleteBankConnectionDialog({
  orgId,
  connection,
  onClose,
}: {
  orgId: Id<'organizations'>
  connection: { id: string; label: string; accountCount: number }
  onClose: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const deleteConnection = useAction(api.powens.deleteConnection)
  const [pending, setPending] = useState(false)
  const inUse = connection.accountCount > 0

  async function handleConfirm() {
    setPending(true)
    try {
      await deleteConnection({ orgId, powensConnectionId: connection.id })
      toast.success(t('settings:integrations.toasts.bankDeleted'))
      onClose()
    } catch {
      toast.error(t('settings:integrations.toasts.bankDeleteError'))
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('settings:integrations.deleteBank.title', {
              label: connection.label,
            })}
          </DialogTitle>
          <DialogDescription>
            {inUse
              ? t('settings:integrations.deleteBank.inUse', {
                  count: connection.accountCount,
                })
              : t('settings:integrations.deleteBank.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t(inUse ? 'common:actions.close' : 'common:actions.cancel')}
          </Button>
          {!inUse && (
            <Button
              variant="destructive"
              onClick={() => void handleConfirm()}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('settings:integrations.actions.delete')}
            </Button>
          )}
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
