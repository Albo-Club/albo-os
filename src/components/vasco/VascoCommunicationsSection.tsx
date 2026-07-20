import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Download,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
} from 'lucide-react'

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
function useIsoDate() {
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

function CommunicationCard({
  communication,
  orgId,
  clientSlug,
}: {
  communication: VascoCommunication
  orgId: Doc<'companies'>['orgId']
  clientSlug: string
}) {
  const { t } = useTranslation('vasco')
  const fmtIso = useIsoDate()

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {communication.title ?? t('communications.title')}
          </p>
          <p className="text-muted-foreground text-xs">
            {t('communications.publishedOn', {
              date: fmtIso(communication.publishDate ?? communication.period),
            })}
          </p>
        </div>
      </div>

      {communication.bodyText && (
        <p className="text-muted-foreground max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
          {communication.bodyText}
        </p>
      )}

      {communication.documents.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {communication.documents.map((doc) => (
            <DocumentButton
              key={doc.documentId}
              orgId={orgId}
              clientSlug={clientSlug}
              doc={doc}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Shared "refresh now" trigger: pulls Parallel live and refreshes the org's
 * cache; the reactive read queries then update on their own. */
function useVascoRefresh(orgId: Doc<'companies'>['orgId']) {
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

/** Communications for a linked entity — read from the local cache (reactive,
 * instant). Kept fresh by a cron + the manual "refresh" button. On the first
 * ever view (empty cache) it pulls once to bootstrap. */
function CommunicationsList({
  company,
  onChangeLink,
}: {
  company: Doc<'companies'>
  onChangeLink: () => void
}) {
  const { t } = useTranslation('vasco')
  const clientSlug = company.vascoClientSlug ?? ''
  const issuerId = company.vascoIssuerId ?? ''
  const data = useConvexQuery(api.vasco.getCachedCommunications, {
    orgId: company.orgId,
    clientSlug,
    issuerId,
  })
  const { refreshing, doRefresh } = useVascoRefresh(company.orgId)
  const bootstrapped = useRef(false)

  // Bootstrap (option 1): if the cache has never been filled, pull once.
  useEffect(() => {
    if (data && data.lastFetchedAt === null && !bootstrapped.current) {
      bootstrapped.current = true
      void doRefresh()
    }
  }, [data, doRefresh])

  const items = data?.communications ?? []
  const loading = data === undefined || (refreshing && items.length === 0)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          {t('communications.title')}
        </h3>
        <div className="flex items-center gap-1">
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
          <Button variant="ghost" size="sm" onClick={onChangeLink}>
            <Link2 className="size-4" />
            {t('link.change')}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="text-muted-foreground text-sm">
          {t('communications.loading')}
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          {t('communications.empty')}
        </div>
      )}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((c) => (
            <CommunicationCard
              key={c.communicationId}
              communication={c}
              orgId={company.orgId}
              clientSlug={clientSlug}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** Pick a Parallel issuer (SPV) to link this entity to, or unlink it. */
function LinkParallelDialog({
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
          <div className="text-muted-foreground text-sm">
            {t('link.noIssuers')}
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

/**
 * VASCO investor communications for an entity, in its Report section. Shown
 * only on portfolio entities that look like an investment made through one of
 * the org's CONNECTED VASCO portals — a connected client slug ("parallel",
 * "teampact", …) appears in the name (Parallel SPVs are all
 * "PARALLEL INVEST …"), the domain, or an origin field (`sponsor`/`group`) —
 * plus any entity already linked. Off on the org's legal entities (group_*)
 * and on unrelated portfolio lines, so the linker isn't noise. All data is
 * read live (on-demand actions); nothing is stored.
 */
export function VascoCommunicationsSection({
  company,
}: {
  company: Doc<'companies'>
}) {
  const { t } = useTranslation('vasco')
  const [linkOpen, setLinkOpen] = useState(false)
  const isLinked = Boolean(company.vascoClientSlug && company.vascoIssuerId)

  // Detect an investment made through a connected portal across every field
  // that may carry the marker (name OR domain OR sponsor/group) so none slip
  // through, whatever the data state — the live domain isn't always filled on
  // SPVs. Driven by the org's active connections (no hardcoded platform);
  // portfolio-only, the org's legal entities (group_*) never show the linker.
  const connectedSlugs = useConvexQuery(api.vasco.listConnectedClientSlugs, {
    orgId: company.orgId,
  })
  const haystack =
    `${company.name} ${company.domain ?? ''} ${company.sponsor ?? ''} ${company.group ?? ''}`.toLowerCase()
  const looksConnected =
    company.kind === 'portfolio' &&
    (connectedSlugs ?? []).some((slug) => haystack.includes(slug.toLowerCase()))
  if (!isLinked && !looksConnected) return null

  return (
    <div className="space-y-3">
      {isLinked ? (
        <CommunicationsList
          company={company}
          onChangeLink={() => setLinkOpen(true)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">
            {t('link.prompt')}
          </span>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 className="size-4" />
            {t('link.cta')}
          </Button>
        </div>
      )}

      {linkOpen && (
        <LinkParallelDialog company={company} onClose={() => setLinkOpen(false)} />
      )}
    </div>
  )
}
