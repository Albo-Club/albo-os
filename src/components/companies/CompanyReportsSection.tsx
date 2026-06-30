import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type ReportStatus = 'processing' | 'completed' | 'failed'

const STATUS_VARIANT: Record<
  ReportStatus,
  'secondary' | 'outline' | 'destructive'
> = {
  completed: 'secondary',
  processing: 'outline',
  failed: 'destructive',
}

/**
 * Investor reports ingested by email (read-only). Click a row to read the
 * extracted synthesis + raw content. Writes happen in the report pipeline.
 */
export function CompanyReportsSection({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtDate } = useFormatters()
  const reports = useConvexQuery(api.companyReports.listByCompany, { companyId })
  const [openId, setOpenId] = useState<Id<'companyReports'> | null>(null)
  const detail = useConvexQuery(
    api.companyReports.getById,
    openId ? { reportId: openId } : 'skip',
  )

  if (!reports) {
    return (
      <div className="text-muted-foreground text-sm">
        {t('participations:loading')}
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {t('participations:reports.empty')}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('participations:reports.col.title')}</TableHead>
              <TableHead>{t('participations:reports.col.period')}</TableHead>
              <TableHead>{t('participations:reports.col.type')}</TableHead>
              <TableHead>{t('participations:reports.col.date')}</TableHead>
              <TableHead>{t('participations:reports.col.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((r) => (
              <TableRow
                key={r._id}
                className="cursor-pointer"
                onClick={() => setOpenId(r._id)}
              >
                <TableCell className="font-medium">
                  {r.title ?? r.headline ?? t('participations:reports.untitled')}
                </TableCell>
                <TableCell>{r.reportPeriod ?? '—'}</TableCell>
                <TableCell>
                  {r.reportType ? (
                    <Badge variant="outline">
                      {t(`participations:reports.type.${r.reportType}`)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {fmtDate(r.processedAt ?? r.emailDate)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>
                    {t(`participations:reports.status.${r.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={openId !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.title ??
                detail?.reportPeriod ??
                t('participations:reports.title')}
            </DialogTitle>
          </DialogHeader>

          {!detail ? (
            <div className="text-muted-foreground text-sm">
              {t('participations:loading')}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              {detail.headline && (
                <p className="font-medium">{detail.headline}</p>
              )}

              {detail.keyHighlights.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {detail.keyHighlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}

              {Object.keys(detail.metrics).length > 0 && (
                <div>
                  <h4 className="mb-1 font-semibold">
                    {t('participations:reports.metrics')}
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(detail.metrics).map(([k, val]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-mono">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.rawContent && (
                <div>
                  <h4 className="mb-1 font-semibold">
                    {t('participations:reports.content')}
                  </h4>
                  <div className="text-muted-foreground max-h-72 overflow-y-auto rounded-md border p-3 whitespace-pre-wrap">
                    {detail.rawContent}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
