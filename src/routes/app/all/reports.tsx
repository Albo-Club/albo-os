import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Skeleton } from '~/components/ui/skeleton'
import { Spinner } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/all/reports')({
  component: InboundReports,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'reports')('metaTitle'),
      },
    ],
  }),
})

type InboundStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'needs_review'
  | 'rejected'

const STATUS_VARIANT: Record<
  InboundStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  received: 'secondary',
  processing: 'secondary',
  processed: 'default',
  needs_review: 'destructive',
  rejected: 'outline',
}

/**
 * Dice coefficient on character bigrams — used ONLY to bring the likely
 * counterpart to the top of the related list ("Parallel Invest SPV13" next to
 * "Parallel Invest SPV 13 (Bernay)"). It never decides anything: the entities
 * are related by their domain, and the user ticks the ones that apply.
 */
function nameProximity(a: string, b: string): number {
  const grams = (s: string) => {
    const clean = s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    return new Set(
      Array.from({ length: Math.max(clean.length - 1, 0) }, (_, i) =>
        clean.slice(i, i + 2),
      ),
    )
  }
  const [ga, gb] = [grams(a), grams(b)]
  if (ga.size === 0 || gb.size === 0) return 0
  const shared = [...ga].filter((g) => gb.has(g)).length
  return (2 * shared) / (ga.size + gb.size)
}

function InboundReports() {
  const { t, i18n } = useTranslation('reports')
  const rows = useConvexQuery(api.reportInbox.list, {})
  const targets = useConvexQuery(api.reportInbox.listAssignTargets, {})
  const assignCompany = useConvexMutation(api.reportInbox.assignCompany)
  const reprocess = useConvexMutation(api.reportInbox.reprocess)
  const reject = useConvexMutation(api.reportInbox.reject)
  const detachCompany = useConvexMutation(api.reportInbox.detachCompany)

  const [assignFor, setAssignFor] = useState<Id<'inboundEmails'> | null>(null)
  const [targetId, setTargetId] = useState<string>('')
  const [alsoIds, setAlsoIds] = useState<Array<string>>([])
  const [detachFor, setDetachFor] = useState<{
    reportId: Id<'companyReports'>
    name: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const assignRow = (rows ?? []).find((r) => r._id === assignFor) ?? null
  const attachedIds = new Set<string>(
    (assignRow?.matched ?? []).map((m) => m.companyId),
  )

  // Entities related to the chosen one: SAME DOMAIN, ANOTHER organization —
  // one company held by both orgs under different names. Suggested, never
  // ticked on our own (on a sponsor domain the neighbours are other
  // vehicles). Sorted by name proximity so the real counterpart comes first.
  const related = useMemo(() => {
    const target = (targets ?? []).find((c) => c.companyId === targetId)
    if (!target?.domain) return []
    return (targets ?? [])
      .filter(
        (c) =>
          c.companyId !== target.companyId &&
          c.domain === target.domain &&
          c.orgId !== target.orgId,
      )
      .sort((a, b) => nameProximity(b.name, target.name) - nameProximity(a.name, target.name))
  }, [targets, targetId])

  const closeAssign = () => {
    setAssignFor(null)
    setTargetId('')
    setAlsoIds([])
  }

  const run = async (fn: () => Promise<unknown>, successKey: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(t(successKey))
    } catch {
      toast.error(t('toasts.error'))
    } finally {
      setBusy(false)
    }
  }

  const confirmAssign = async () => {
    if (!assignFor || !targetId) return
    const companyIds = [targetId, ...alsoIds] as Array<Id<'companies'>>
    await run(
      () => assignCompany({ inboundEmailId: assignFor, companyIds }),
      'toasts.assigned',
    )
    closeAssign()
  }

  const confirmDetach = async () => {
    if (!detachFor) return
    await run(
      () => detachCompany({ reportId: detachFor.reportId }),
      'toasts.detached',
    )
    setDetachFor(null)
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      {rows === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.received')}</TableHead>
              <TableHead>{t('columns.from')}</TableHead>
              <TableHead>{t('columns.subject')}</TableHead>
              <TableHead>{t('columns.participation')}</TableHead>
              <TableHead>{t('columns.content')}</TableHead>
              <TableHead className="text-right">
                {t('columns.attachments')}
              </TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const reviewable =
                row.status === 'needs_review' || row.status === 'rejected'
              return (
                <TableRow key={row._id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(row.receivedAt).toLocaleString(i18n.language, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.fromEmail}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {row.subject}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {row.matched.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {row.matched.map((m) => (
                          <Badge
                            key={m.companyId}
                            variant="secondary"
                            className="max-w-[16rem] font-normal"
                          >
                            <span className="truncate">{m.name}</span>
                            {/* Only an entity actually carrying a report can
                                be detached — before storage there is nothing
                                on the fiche to take back. */}
                            {m.reportId ? (
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={t('actions.detach', {
                                  name: m.name,
                                })}
                                title={t('actions.detach', { name: m.name })}
                                className="hover:text-destructive -mr-1 cursor-pointer disabled:cursor-default"
                                onClick={() =>
                                  setDetachFor({
                                    reportId: m.reportId!,
                                    name: m.name,
                                  })
                                }
                              >
                                <X className="size-3" />
                              </button>
                            ) : null}
                          </Badge>
                        ))}
                        {row.relatedOrgNames.length > 0 ? (
                          <Badge
                            variant="outline"
                            title={t('related.hint', {
                              orgs: row.relatedOrgNames.join(', '),
                            })}
                          >
                            + {row.relatedOrgNames.join(', ')} ?
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.sourcesSummary ? (
                      <span>
                        {row.sourcesSummary.extracted > 0 && (
                          <span>✅ {row.sourcesSummary.extracted} </span>
                        )}
                        {row.sourcesSummary.stored > 0 && (
                          <span>📦 {row.sourcesSummary.stored} </span>
                        )}
                        {row.sourcesSummary.failed > 0 && (
                          <span>⚠️ {row.sourcesSummary.failed}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.attachmentsCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {row.status === 'processing' && (
                          <Spinner className="size-3" />
                        )}
                        {t(`status.${row.status}`)}
                      </Badge>
                      {row.statusReason ? (
                        <span className="text-muted-foreground text-xs">
                          {t(`reasons.${row.statusReason}`, {
                            defaultValue: row.statusReason,
                          })}
                        </span>
                      ) : null}
                    </div>
                    {row.error ? (
                      <p
                        className="text-muted-foreground mt-1 max-w-xs truncate text-xs"
                        title={row.error}
                      >
                        {row.error}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.status === 'processed' ? (
                      // Adding a participation to an already stored report:
                      // the only way to serve a company held by both orgs
                      // under different names.
                      <Button
                        size="sm"
                        variant={row.relatedOrgNames.length > 0 ? 'outline' : 'ghost'}
                        disabled={busy}
                        onClick={() => setAssignFor(row._id)}
                      >
                        {t('actions.assignAlso')}
                      </Button>
                    ) : reviewable ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setAssignFor(row._id)}
                        >
                          {t('actions.assign')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => reprocess({ inboundEmailId: row._id }),
                              'toasts.reprocessed',
                            )
                          }
                        >
                          {t('actions.reprocess')}
                        </Button>
                        {row.status === 'needs_review' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => reject({ inboundEmailId: row._id }),
                                'toasts.rejected',
                              )
                            }
                          >
                            {t('actions.reject')}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={assignFor !== null}
        onOpenChange={(open) => {
          if (!open) closeAssign()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t(
                assignRow?.status === 'processed'
                  ? 'assignDialog.titleAlso'
                  : 'assignDialog.title',
              )}
            </DialogTitle>
            <DialogDescription>{t('assignDialog.description')}</DialogDescription>
          </DialogHeader>
          <Select
            value={targetId}
            onValueChange={(value) => {
              setTargetId(value)
              setAlsoIds([])
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('assignDialog.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {(targets ?? []).map((c) => (
                <SelectItem key={c.companyId} value={c.companyId}>
                  {c.name} — {c.orgName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {related.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('assignDialog.relatedTitle')}</p>
              <p className="text-muted-foreground text-xs">
                {t('assignDialog.relatedHint')}
              </p>
              {related.map((c) => {
                const attached = attachedIds.has(c.companyId)
                return (
                  <div key={c.companyId} className="flex items-center gap-2">
                    <Checkbox
                      id={`also-${c.companyId}`}
                      checked={attached || alsoIds.includes(c.companyId)}
                      disabled={attached}
                      onCheckedChange={(checked) =>
                        setAlsoIds((prev) =>
                          checked === true
                            ? [...prev, c.companyId]
                            : prev.filter((id) => id !== c.companyId),
                        )
                      }
                    />
                    <Label
                      htmlFor={`also-${c.companyId}`}
                      className="text-sm font-normal"
                    >
                      {c.name} — {c.orgName}
                      {attached ? (
                        <span className="text-muted-foreground text-xs">
                          {t('assignDialog.alreadyAttached')}
                        </span>
                      ) : null}
                    </Label>
                  </div>
                )
              })}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeAssign}>
              {t('assignDialog.cancel')}
            </Button>
            <Button disabled={!targetId || busy} onClick={confirmAssign}>
              {t('assignDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detachFor !== null}
        onOpenChange={(open) => {
          if (!open) setDetachFor(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('detachDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('detachDialog.description', { name: detachFor?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetachFor(null)}>
              {t('detachDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDetach()}
            >
              {t('detachDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
