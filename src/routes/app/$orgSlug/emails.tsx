import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowDownLeft, ArrowUpRight, Paperclip, Sparkles } from 'lucide-react'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { EmailDetailDialog } from '~/components/companies/CompanyEmailsSection'
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

export const Route = createFileRoute('/app/$orgSlug/emails')({
  component: OrgEmails,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'participations')(
          'emails.page.metaTitle',
        ),
      },
    ],
  }),
})

/**
 * Org-scoped email feed: every stored email linked to this workspace's
 * participations, most recent first. Read-only — the timeline is managed
 * by the Gmail sync (cf. the per-participation Emails tab for the
 * entity-level view).
 */
function OrgEmails() {
  const { t, i18n } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const rows = useConvexQuery(
    api.gmail.listByOrg,
    org ? { orgId: org._id } : 'skip',
  )
  const [openId, setOpenId] = useState<Id<'companyEmails'> | null>(null)

  return (
    <main className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('emails.page.title')}
        </h1>
        <p className="text-muted-foreground text-sm">
          {rows === undefined
            ? t('emails.page.subtitleLoading')
            : t('emails.page.subtitle', { count: rows.length })}
        </p>
      </div>

      {rows === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('emails.page.empty')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('emails.page.col.date')}</TableHead>
              <TableHead>{t('emails.page.col.subject')}</TableHead>
              <TableHead>{t('emails.page.col.from')}</TableHead>
              <TableHead>{t('emails.page.col.companies')}</TableHead>
              <TableHead>{t('emails.page.col.mailboxes')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const Icon =
                row.direction === 'outgoing' ? ArrowUpRight : ArrowDownLeft
              return (
                <TableRow
                  key={row._id}
                  className="cursor-pointer"
                  onClick={() => setOpenId(row._id)}
                >
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(row.sentAt).toLocaleString(i18n.language, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <span className="flex items-center gap-2">
                      <Icon
                        className="text-muted-foreground size-4 shrink-0"
                        aria-label={t(
                          row.direction === 'outgoing'
                            ? 'emails.sent'
                            : 'emails.received',
                        )}
                      />
                      <span className="truncate font-medium">
                        {row.subject || t('emails.noSubject')}
                      </span>
                      {row.attachmentCount > 0 && (
                        <Paperclip
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-label={t('emails.attachments')}
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {row.fromName ?? row.fromEmail}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {row.companies.map((c) => (
                        <Badge
                          key={c.companyId}
                          variant="secondary"
                          title={c.viaLlm ? t('emails.aiMatched') : undefined}
                          asChild
                        >
                          <Link
                            to="/app/$orgSlug/participations/$companyId"
                            params={{ orgSlug, companyId: c.companyId }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.name}
                            {c.viaLlm && (
                              <Sparkles
                                className="size-3"
                                aria-label={t('emails.aiMatched')}
                              />
                            )}
                          </Link>
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                    {row.accountEmails.join(', ')}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <EmailDetailDialog openId={openId} onClose={() => setOpenId(null)} />
    </main>
  )
}
