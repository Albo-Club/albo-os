import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
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
              <TableHead className="text-right">
                {t('columns.attachments')}
              </TableHead>
              <TableHead>{t('columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  )
}
