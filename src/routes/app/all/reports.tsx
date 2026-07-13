import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
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

function InboundReports() {
  const { t, i18n } = useTranslation('reports')
  const rows = useConvexQuery(api.reportInbox.list, {})
  const targets = useConvexQuery(api.reportInbox.listAssignTargets, {})
  const assignCompany = useConvexMutation(api.reportInbox.assignCompany)
  const reprocess = useConvexMutation(api.reportInbox.reprocess)
  const reject = useConvexMutation(api.reportInbox.reject)

  const [assignFor, setAssignFor] = useState<Id<'inboundEmails'> | null>(null)
  const [targetId, setTargetId] = useState<string>('')
  const [busy, setBusy] = useState(false)

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
    await run(
      () =>
        assignCompany({
          inboundEmailId: assignFor,
          companyId: targetId as Id<'companies'>,
        }),
      'toasts.assigned',
    )
    setAssignFor(null)
    setTargetId('')
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
                  <TableCell className="max-w-xs truncate">
                    {row.matchedNames.length > 0 ? (
                      row.matchedNames.join(', ')
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
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {reviewable ? (
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
          if (!open) {
            setAssignFor(null)
            setTargetId('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignDialog.title')}</DialogTitle>
            <DialogDescription>{t('assignDialog.description')}</DialogDescription>
          </DialogHeader>
          <Select value={targetId} onValueChange={setTargetId}>
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
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssignFor(null)
                setTargetId('')
              }}
            >
              {t('assignDialog.cancel')}
            </Button>
            <Button disabled={!targetId || busy} onClick={confirmAssign}>
              {t('assignDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
