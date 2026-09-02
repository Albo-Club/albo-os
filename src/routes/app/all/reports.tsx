import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
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

/** Minimal shape of an assign target (return of `api.reportInbox.listAssignTargets`). */
type AssignTarget = {
  companyId: Id<'companies'>
  name: string
  orgName: string
}

/**
 * Searchable combobox of the participations the user can attach a report to
 * (Popover + Command). Mirrors `CompanyCombobox` on the deal sheet; the search
 * matches the participation name and its organization, since the same company
 * can appear once per org.
 */
function TargetCombobox({
  targets,
  value,
  onSelect,
}: {
  targets: Array<AssignTarget> | undefined
  value: string
  onSelect: (companyId: string) => void
}) {
  const { t } = useTranslation('reports')
  const [open, setOpen] = useState(false)
  const selected = targets?.find((c) => c.companyId === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={!targets}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected
              ? `${selected.name} — ${selected.orgName}`
              : t('assignDialog.placeholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder={t('assignDialog.search')} />
          <CommandList>
            <CommandEmpty>{t('assignDialog.empty')}</CommandEmpty>
            <CommandGroup>
              {(targets ?? []).map((c) => (
                <CommandItem
                  key={c.companyId}
                  // The companyId guarantees cmdk uniqueness when two orgs
                  // hold a company under the same name.
                  value={`${c.name} ${c.orgName} ${c.companyId}`}
                  onSelect={() => {
                    onSelect(c.companyId)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'size-4',
                      c.companyId === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{c.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {c.orgName}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function InboundReports() {
  const { t, i18n } = useTranslation('reports')
  const rows = useConvexQuery(api.reportInbox.list, {})
  const targets = useConvexQuery(api.reportInbox.listAssignTargets, {})
  const assignCompany = useConvexMutation(api.reportInbox.assignCompany)
  const reprocess = useConvexMutation(api.reportInbox.reprocess)
  const reject = useConvexMutation(api.reportInbox.reject)
  const detachCompany = useConvexMutation(api.reportInbox.detachCompany)
  const deleteReport = useConvexMutation(api.reportInbox.deleteReport)
  const deleteEmail = useConvexMutation(api.reportInbox.deleteEmail)

  const [assignFor, setAssignFor] = useState<Id<'inboundEmails'> | null>(null)
  const [targetId, setTargetId] = useState<string>('')
  const [alsoIds, setAlsoIds] = useState<Array<string>>([])
  // Both ways out of a wrongly filed report share one dialog: detaching keeps
  // the files (this email stays replayable), deleting takes them.
  const [confirmFor, setConfirmFor] = useState<{
    reportId: Id<'companyReports'>
    name: string
    mode: 'detach' | 'delete'
  } | null>(null)
  const [deleteEmailFor, setDeleteEmailFor] = useState<{
    inboundEmailId: Id<'inboundEmails'>
    subject: string
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

  // The dialog stays mounted while it closes — keep the copy stable until it
  // is gone rather than flipping mid-animation.
  const removalDialog =
    confirmFor?.mode === 'delete' ? 'deleteDialog' : 'detachDialog'

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

  const confirmDeleteEmail = async () => {
    if (!deleteEmailFor) return
    await run(
      () => deleteEmail({ inboundEmailId: deleteEmailFor.inboundEmailId }),
      'toasts.emailDeleted',
    )
    setDeleteEmailFor(null)
  }

  const confirmRemoval = async () => {
    if (!confirmFor) return
    const mutate = confirmFor.mode === 'detach' ? detachCompany : deleteReport
    await run(
      () => mutate({ reportId: confirmFor.reportId }),
      confirmFor.mode === 'detach' ? 'toasts.detached' : 'toasts.deleted',
    )
    setConfirmFor(null)
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
                                be detached or deleted — before storage there
                                is nothing on the fiche to take back. The cross
                                keeps the files, the bin takes them. */}
                            {m.reportId ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={t('actions.detach', {
                                    name: m.name,
                                  })}
                                  title={t('actions.detach', { name: m.name })}
                                  className="hover:text-destructive cursor-pointer disabled:cursor-default"
                                  onClick={() =>
                                    setConfirmFor({
                                      reportId: m.reportId!,
                                      name: m.name,
                                      mode: 'detach',
                                    })
                                  }
                                >
                                  <X className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={t('actions.deleteReport', {
                                    name: m.name,
                                  })}
                                  title={t('actions.deleteReport', {
                                    name: m.name,
                                  })}
                                  className="hover:text-destructive -mr-1 cursor-pointer disabled:cursor-default"
                                  onClick={() =>
                                    setConfirmFor({
                                      reportId: m.reportId!,
                                      name: m.name,
                                      mode: 'delete',
                                    })
                                  }
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </>
                            ) : null}
                          </Badge>
                        ))}
                        {row.relatedOrgNames.length > 0 ? (
                          <Badge
                            variant="outline"
                            className="max-w-[16rem]"
                            title={t('related.hint', {
                              orgs: row.relatedOrgNames.join(', '),
                            })}
                          >
                            <span className="truncate">
                              + {row.relatedOrgNames.join(', ')} ?
                            </span>
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
                    <div className="flex gap-1">
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
                        <>
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
                        </>
                      ) : null}
                      {/* The definitive way out, on every row the pipeline is
                          not currently working on. */}
                      {row.status === 'processing' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            setDeleteEmailFor({
                              inboundEmailId: row._id,
                              subject: row.subject,
                            })
                          }
                        >
                          {t('actions.deleteEmail')}
                        </Button>
                      )}
                    </div>
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
          <TargetCombobox
            targets={targets}
            value={targetId}
            onSelect={(value) => {
              setTargetId(value)
              setAlsoIds([])
            }}
          />

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
        open={deleteEmailFor !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteEmailFor(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteEmailDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('deleteEmailDialog.description', {
                subject: deleteEmailFor?.subject ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEmailFor(null)}>
              {t('deleteEmailDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDeleteEmail()}
            >
              {t('deleteEmailDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmFor !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFor(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t(`${removalDialog}.title`)}</DialogTitle>
            <DialogDescription>
              {t(`${removalDialog}.description`, { name: confirmFor?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFor(null)}>
              {t(`${removalDialog}.cancel`)}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmRemoval()}
            >
              {t(`${removalDialog}.confirm`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
