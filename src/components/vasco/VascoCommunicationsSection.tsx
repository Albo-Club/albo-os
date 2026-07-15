import { useCallback, useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { useConvexMutation } from '@convex-dev/react-query'
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

/** Live list of communications for a linked entity. Fetches on mount and on
 * demand (the underlying Convex function is an action, not reactive). */
function CommunicationsList({
  company,
  onChangeLink,
}: {
  company: Doc<'companies'>
  onChangeLink: () => void
}) {
  const { t } = useTranslation('vasco')
  const fetchComms = useAction(api.vasco.fetchCommunications)
  const clientSlug = company.vascoClientSlug ?? ''
  const issuerId = company.vascoIssuerId ?? ''
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [items, setItems] = useState<Array<VascoCommunication>>([])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetchComms({ orgId: company.orgId, clientSlug, issuerId })
      setItems(res.communications)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [fetchComms, company.orgId, clientSlug, issuerId])

  useEffect(() => {
    void load()
  }, [load])

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
            onClick={() => void load()}
            disabled={status === 'loading'}
          >
            <RefreshCw
              className={status === 'loading' ? 'size-4 animate-spin' : 'size-4'}
            />
            {t('communications.refresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onChangeLink}>
            <Link2 className="size-4" />
            {t('link.change')}
          </Button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="text-muted-foreground text-sm">
          {t('communications.loading')}
        </div>
      )}
      {status === 'error' && (
        <div className="text-destructive text-sm">
          {t('communications.error')}
        </div>
      )}
      {status === 'ready' && items.length === 0 && (
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          {t('communications.empty')}
        </div>
      )}
      {status === 'ready' && items.length > 0 && (
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
  const listIssuers = useAction(api.vasco.listVascoIssuers)
  const setLink = useConvexMutation(api.companies.setVascoLink)
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [issuers, setIssuers] = useState<
    Array<{
      clientSlug: string
      issuerId: string
      issuerLabel: string | null
      sampleTitle: string | null
    }>
  >([])
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await listIssuers({ orgId: company.orgId })
        setIssuers(res.issuers)
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    })()
  }, [listIssuers, company.orgId])

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

        {status === 'loading' && (
          <div className="text-muted-foreground text-sm">
            {t('link.loadingIssuers')}
          </div>
        )}
        {status === 'error' && (
          <div className="text-destructive text-sm">
            {t('link.issuersError')}
          </div>
        )}
        {status === 'ready' && issuers.length === 0 && (
          <div className="text-muted-foreground text-sm">
            {t('link.noIssuers')}
          </div>
        )}
        {status === 'ready' && issuers.length > 0 && (
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

        {currentKey && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void handleUnlink()}
              disabled={pendingKey !== null}
            >
              <Unlink className="size-4" />
              {pendingKey === 'unlink' ? t('link.unlinking') : t('link.unlink')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Parallel communications for an entity, in its Report section. Shown only on
 * portfolio entities that look like Parallel investments — "parallel" in the
 * name (the SPVs are all "PARALLEL INVEST …"), the domain, or an origin field
 * (`sponsor`/`group`) — plus any entity already linked. Off on the org's legal
 * entities (group_*) and on the many non-Parallel portfolio lines, so the
 * linker isn't noise. All data is read live (on-demand actions); nothing is
 * stored.
 */
export function VascoCommunicationsSection({
  company,
}: {
  company: Doc<'companies'>
}) {
  const { t } = useTranslation('vasco')
  const [linkOpen, setLinkOpen] = useState(false)
  const isLinked = Boolean(company.vascoClientSlug && company.vascoIssuerId)

  // Detect a Parallel investment across every field that may carry the marker
  // (name OR domain OR sponsor/group) so none slip through, whatever the data
  // state — the live domain isn't always filled on SPVs. Portfolio-only; the
  // org's legal entities (group_*) never show the linker.
  const looksParallel =
    company.kind === 'portfolio' &&
    /parallel/i.test(
      `${company.name} ${company.domain ?? ''} ${company.sponsor ?? ''} ${company.group ?? ''}`,
    )
  if (!isLinked && !looksParallel) return null

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
