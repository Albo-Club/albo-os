import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Loader2, RefreshCw, Unlink } from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { VascoCommunication } from '../../../convex/vasco'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/** ISO datetime string → localized date (communications carry ISO strings, not
 * ms epochs, so we can't reuse the cents/ms formatters). */
export function useIsoDate() {
  const { i18n } = useTranslation()
  return (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(i18n.language, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
  }
}

/** A single downloadable attachment. Downloads go through a Convex proxy
 * (the VASCO URL is auth-gated), then open the returned short-lived URL. */
function DocumentButton({
  orgId,
  clientSlug,
  doc,
}: {
  orgId: Doc<'companies'>['orgId']
  clientSlug: string
  doc: VascoCommunication['documents'][number]
}) {
  const { t } = useTranslation('vasco')
  const download = useAction(api.vasco.downloadCommunicationDocument)
  const [pending, setPending] = useState(false)

  async function handleDownload() {
    setPending(true)
    try {
      const { url } = await download({
        orgId,
        clientSlug,
        documentId: doc.documentId,
      })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error(t('communications.downloadError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => void handleDownload()}
      title={doc.name ?? undefined}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      <span className="max-w-[16rem] truncate">
        {doc.name ?? t('communications.download')}
      </span>
    </Button>
  )
}

/**
 * One communication in full, opened from its bubble in the company timeline.
 * Same shape as a report's detail dialog — only the content differs: the body
 * as published, and the attachments, which are downloaded live from the portal
 * (nothing is stored on our side, so there is no reading state to show).
 */
export function VascoCommunicationDialog({
  communication,
  orgId,
  clientSlug,
  onClose,
}: {
  communication: VascoCommunication | null
  orgId: Doc<'companies'>['orgId']
  clientSlug: string
  onClose: () => void
}) {
  const { t } = useTranslation('vasco')
  const fmtIso = useIsoDate()

  return (
    <Dialog
      open={communication !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {communication?.title ?? t('communications.untitled')}
          </DialogTitle>
          <DialogDescription>
            {t('communications.publishedOn', {
              date: fmtIso(
                communication?.publishDate ?? communication?.period ?? null,
              ),
            })}
          </DialogDescription>
        </DialogHeader>

        {communication && (
          <div className="space-y-4 text-sm">
            {communication.bodyText && (
              <p className="text-muted-foreground whitespace-pre-wrap">
                {communication.bodyText}
              </p>
            )}

            {communication.documents.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold">
                  {t('communications.attachments')}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {communication.documents.map((doc) => (
                    <DocumentButton
                      key={doc.documentId}
                      orgId={orgId}
                      clientSlug={clientSlug}
                      doc={doc}
                    />
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('communications.attachmentsHint')}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Shared "refresh now" trigger: pulls Parallel live and refreshes the org's
 * cache; the reactive read queries then update on their own. */
export function useVascoRefresh(orgId: Doc<'companies'>['orgId']) {
  const { t } = useTranslation('vasco')
  const refreshNow = useAction(api.vasco.refreshVascoCacheNow)
  const [refreshing, setRefreshing] = useState(false)
  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshNow({ orgId })
    } catch {
      toast.error(t('communications.refreshError'))
    } finally {
      setRefreshing(false)
    }
  }, [refreshNow, orgId, t])
  return { refreshing, doRefresh }
}

/**
 * Communications of a linked entity, for the company timeline — read from the
 * local cache (reactive, instant), kept fresh by a cron and by the "refresh"
 * button the timeline renders. On the first ever view (empty cache) it pulls
 * once to bootstrap. Returns nothing for an unlinked entity, which is what
 * keeps VASCO invisible on the rest of the portfolio.
 */
export function useVascoCommunications(company: Doc<'companies'>) {
  const clientSlug = company.vascoClientSlug ?? ''
  const issuerId = company.vascoIssuerId ?? ''
  const linked = Boolean(clientSlug && issuerId)
  const data = useConvexQuery(
    api.vasco.getCachedCommunications,
    linked ? { orgId: company.orgId, clientSlug, issuerId } : 'skip',
  )
  const { refreshing, doRefresh } = useVascoRefresh(company.orgId)
  const bootstrapped = useRef(false)

  // Bootstrap (option 1): if the cache has never been filled, pull once.
  useEffect(() => {
    if (data && data.lastFetchedAt === null && !bootstrapped.current) {
      bootstrapped.current = true
      void doRefresh()
    }
  }, [data, doRefresh])

  return {
    linked,
    clientSlug,
    communications: data?.communications ?? [],
    loading: linked && data === undefined,
    refreshing,
    doRefresh,
  }
}

/** Pick a VASCO issuer (e.g. a Parallel SPV) to link this entity to, or
 * unlink it. Opened from the entity page's « Intégrations » dialog (menu ⋯) —
 * the only place where the link is made or broken. */
export function VascoLinkDialog({
  company,
  onClose,
}: {
  company: Doc<'companies'>
  onClose: () => void
}) {
  const { t } = useTranslation('vasco')
  const setLink = useConvexMutation(api.companies.setVascoLink)
  const data = useConvexQuery(api.vasco.listCachedVascoIssuers, {
    orgId: company.orgId,
  })
  // Connection state, to tell "no issuer on the portal" apart from "the
  // connection is failing" when the cache comes back empty.
  const integrations = useConvexQuery(api.connections.listIntegrations, {
    orgId: company.orgId,
  })
  const vascoConnections =
    integrations?.find((i) => i.platform === 'vasco')?.connections ?? []
  const connectionFailing =
    vascoConnections.length > 0 &&
    !vascoConnections.some((c) => c.state === 'connected') &&
    vascoConnections.some((c) => c.state === 'error')
  const { refreshing, doRefresh } = useVascoRefresh(company.orgId)
  const bootstrapped = useRef(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  // Bootstrap (option 1): if the cache has never been filled, pull once.
  useEffect(() => {
    if (data && data.lastFetchedAt === null && !bootstrapped.current) {
      bootstrapped.current = true
      void doRefresh()
    }
  }, [data, doRefresh])

  const issuers = data?.issuers ?? []
  const loading = data === undefined || (refreshing && issuers.length === 0)

  async function handlePick(clientSlug: string, issuerId: string) {
    setPendingKey(`${clientSlug}:${issuerId}`)
    try {
      await setLink({ id: company._id, clientSlug, issuerId })
      toast.success(t('link.saved'))
      onClose()
    } catch {
      toast.error(t('link.saveError'))
      setPendingKey(null)
    }
  }

  async function handleUnlink() {
    setPendingKey('unlink')
    try {
      await setLink({ id: company._id })
      toast.success(t('link.unlinked'))
      onClose()
    } catch {
      toast.error(t('link.saveError'))
      setPendingKey(null)
    }
  }

  const currentKey =
    company.vascoClientSlug && company.vascoIssuerId
      ? `${company.vascoClientSlug}:${company.vascoIssuerId}`
      : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('link.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('link.dialogDescription')}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="text-muted-foreground text-sm">
            {t('link.loadingIssuers')}
          </div>
        )}
        {!loading && issuers.length === 0 && (
          <div
            className={
              connectionFailing
                ? 'text-destructive text-sm'
                : 'text-muted-foreground text-sm'
            }
          >
            {connectionFailing
              ? t('link.connectionError')
              : t('link.noIssuers')}
          </div>
        )}
        {!loading && issuers.length > 0 && (
          <div className="space-y-1">
            {issuers.map((iss) => {
              const key = `${iss.clientSlug}:${iss.issuerId}`
              const isCurrent = key === currentKey
              return (
                <button
                  key={key}
                  type="button"
                  disabled={pendingKey !== null}
                  onClick={() => void handlePick(iss.clientSlug, iss.issuerId)}
                  className={cn(
                    'hover:bg-accent/60 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                    isCurrent ? 'border-primary' : 'border-transparent',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {iss.issuerLabel ?? iss.issuerId}
                    </p>
                    {iss.sampleTitle && (
                      <p className="text-muted-foreground truncate text-xs">
                        {iss.sampleTitle}
                      </p>
                    )}
                  </div>
                  {pendingKey === key && (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doRefresh()}
            disabled={refreshing}
          >
            <RefreshCw
              className={refreshing ? 'size-4 animate-spin' : 'size-4'}
            />
            {t('communications.refresh')}
          </Button>
          {currentKey && (
            <Button
              variant="outline"
              onClick={() => void handleUnlink()}
              disabled={pendingKey !== null}
            >
              <Unlink className="size-4" />
              {pendingKey === 'unlink' ? t('link.unlinking') : t('link.unlink')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

