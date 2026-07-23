import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, FileText, Paperclip } from 'lucide-react'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

type EmailRow = {
  _id: Id<'companyEmails'>
  subject: string
  snippet: string | null
  fromEmail: string
  fromName: string | null
  sentAt: number
  direction: 'incoming' | 'outgoing'
  attachmentCount: number
}

/** Localised relative age, e.g. "il y a 13 j" / "13 days ago". */
function useRelativeAge() {
  const { i18n } = useTranslation()
  return (ms: number) => {
    const days = Math.round((Date.now() - ms) / 86_400_000)
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    if (Math.abs(days) < 45) return rtf.format(-days, 'day')
    const months = Math.round(days / 30)
    if (Math.abs(months) < 12) return rtf.format(-months, 'month')
    return rtf.format(-Math.round(days / 365), 'year')
  }
}

function EmailCard({ email, onOpen }: { email: EmailRow; onOpen: () => void }) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const relAge = useRelativeAge()
  const Icon = email.direction === 'outgoing' ? ArrowUpRight : ArrowDownLeft

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
    >
      <div
        className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
        title={t(
          email.direction === 'outgoing' ? 'emails.sent' : 'emails.received',
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {email.subject || t('emails.noSubject')}
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {email.fromName ?? email.fromEmail}
          {email.snippet ? ` — ${email.snippet}` : ''}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {fmtDate(email.sentAt)} · {relAge(email.sentAt)}
        </p>
      </div>

      {email.attachmentCount > 0 && (
        <Paperclip
          className="text-muted-foreground size-4 shrink-0"
          aria-label={t('emails.attachments')}
        />
      )}
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </div>
  )
}

/** Shared by the participation tab and the consolidated /app/all/emails
 * page — the read authorization lives in the `gmail.getById` query. */
export function EmailDetailDialog({
  openId,
  onClose,
}: {
  openId: Id<'companyEmails'> | null
  onClose: () => void
}) {
  const { t } = useTranslation('participations')
  const { fmtDate } = useFormatters()
  const detail = useConvexQuery(
    api.gmail.getById,
    openId ? { emailId: openId } : 'skip',
  )

  return (
    <Dialog open={openId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? detail.subject || t('emails.noSubject') : t('loading')}
          </DialogTitle>
        </DialogHeader>

        {detail && (
          <div className="space-y-4 text-sm">
            <div className="text-muted-foreground space-y-0.5 text-xs">
              <p>
                <span className="font-medium">{t('emails.from')}</span>{' '}
                {detail.fromName
                  ? `${detail.fromName} <${detail.fromEmail}>`
                  : detail.fromEmail}
              </p>
              <p>
                <span className="font-medium">{t('emails.to')}</span>{' '}
                {detail.toEmails.join(', ')}
              </p>
              {detail.ccEmails.length > 0 && (
                <p>
                  <span className="font-medium">{t('emails.cc')}</span>{' '}
                  {detail.ccEmails.join(', ')}
                </p>
              )}
              <p>
                {fmtDate(detail.sentAt)} ·{' '}
                {t('emails.receivedVia', {
                  mailbox: detail.accountEmails.join(', '),
                })}
              </p>
            </div>

            {detail.attachments.length > 0 && (
              <div>
                <h4 className="mb-1 font-semibold">{t('emails.attachments')}</h4>
                <div className="space-y-1">
                  {detail.attachments.map((att, i) =>
                    att.url ? (
                      <a
                        key={i}
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:bg-accent/40 flex items-center gap-2 rounded-md border p-2 text-sm transition-colors"
                      >
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <span className="truncate">{att.filename}</span>
                        {att.size != null && (
                          <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                            {Math.max(1, Math.round(att.size / 1024))} Ko
                          </span>
                        )}
                      </a>
                    ) : null,
                  )}
                </div>
              </div>
            )}

            {detail.bodyText && (
              <div className="text-foreground/90 max-h-96 overflow-y-auto rounded-md border p-3 text-sm break-words whitespace-pre-wrap">
                {detail.bodyText}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Emails tab: the portfolio email timeline of one participation, fed by the
 * Gmail connector (cf. convex/gmail.ts). Read-only; the sync cron writes.
 */
export function CompanyEmailsSection({
  companyId,
}: {
  companyId: Id<'companies'>
}) {
  const { t } = useTranslation('participations')
  const emails = useConvexQuery(api.gmail.listByCompany, { companyId })
  const [openId, setOpenId] = useState<Id<'companyEmails'> | null>(null)

  if (!emails) {
    return <div className="text-muted-foreground text-sm">{t('loading')}</div>
  }

  if (emails.length === 0) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        {t('emails.empty')}
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('emails.title')}
      </h2>
      <div className="space-y-2">
        {emails.map((e) => (
          <EmailCard key={e._id} email={e} onOpen={() => setOpenId(e._id)} />
        ))}
      </div>
      <EmailDetailDialog openId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}
