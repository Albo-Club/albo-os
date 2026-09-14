import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { IdentitySection } from '~/components/companies/EntityFiche'
import {
  useDealTitle,
  useFormatters,
} from '~/components/participations/ParticipationsTable'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { LoadingLine } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'

/**
 * The activity journal of a company's deals — who did what, when — one line
 * per gesture, newest first, grouped by day. The compact "journal" form was
 * chosen over a richer timeline on purpose: the amounts already live in the
 * deals table above and the narrative in the reports feed below, so this
 * section answers "who touched this deal?" and nothing more.
 *
 * Consecutive lines written by the Attio sync collapse into the first one
 * plus a count, so a burst of webhooks does not bury the human gestures.
 */

type Row = FunctionReturnType<typeof api.dealEvents.listByCompany>[number]

/** A run of consecutive system rows shows its first line plus a count. */
type Visible = { row: Row; collapsed: number }

/** How many lines show before "see more". */
const COLLAPSED_COUNT = 5

/** Placeholder the sentence is split on, so the deal renders as a link. */
const DEAL_TOKEN = '__DEAL__'

function collapseSystemRuns(rows: Array<Row>): Array<Visible> {
  const out: Array<Visible> = []
  for (const row of rows) {
    const last = out.at(-1)
    if (
      last &&
      row.actor.kind === 'system' &&
      last.row.actor.kind === 'system'
    ) {
      last.collapsed += 1
    } else {
      out.push({ row, collapsed: 0 })
    }
  }
  return out
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase() || '?'
}

export function DealActivitySection({
  companyId,
  orgSlug,
}: {
  companyId: Id<'companies'>
  orgSlug: string
}) {
  const { t, i18n } = useTranslation('participations')
  const events = useConvexQuery(api.dealEvents.listByCompany, { companyId })
  const [expanded, setExpanded] = useState(false)

  const rows = useMemo(() => collapseSystemRuns(events ?? []), [events])
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT)
  const hidden = rows.length - visible.length

  // Day headers: today / yesterday / a short date, computed in the viewer's
  // locale from the event timestamp.
  const dayLabel = (ms: number) => {
    const d = new Date(ms)
    const today = new Date()
    const startOf = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000)
    if (diff === 0) return t('activity.today')
    if (diff === 1) return t('activity.yesterday')
    return d.toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
    })
  }
  const timeLabel = (ms: number) =>
    new Date(ms).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <IdentitySection
      title={t('activity.title')}
      icon={<History className="size-3.5" />}
      count={events?.length}
    >
      {!events ? (
        <LoadingLine>{t('loading')}</LoadingLine>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('activity.empty')}</p>
      ) : (
        <div className="flex flex-col">
          {visible.map((item, i) => {
            const prev = i > 0 ? visible[i - 1] : undefined
            const day = dayLabel(item.row.at)
            const showDay = !prev || dayLabel(prev.row.at) !== day
            return (
              <Fragment key={item.row._id}>
                {showDay && (
                  <div
                    className={cn(
                      'text-muted-foreground text-[10px] font-semibold tracking-wider uppercase',
                      i === 0 ? 'pb-1' : 'pt-3 pb-1',
                    )}
                  >
                    {day}
                  </div>
                )}
                <div className="flex items-start gap-2.5 border-b py-1.5 last:border-0">
                  <ActorAvatar row={item.row} />
                  <div className="min-w-0 flex-1 text-sm">
                    <Sentence row={item.row} orgSlug={orgSlug} />
                    {item.collapsed > 0 && (
                      <span className="text-muted-foreground">
                        {' · '}
                        {t('activity.collapsedSync', { count: item.collapsed })}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    title={new Date(item.row.at).toLocaleString(i18n.language)}
                  >
                    {timeLabel(item.row.at)}
                  </span>
                </div>
              </Fragment>
            )
          })}
          {hidden > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground mt-2 self-start"
              onClick={() => setExpanded(true)}
            >
              {t('activity.showMore', { count: hidden })}
            </Button>
          )}
        </div>
      )}
    </IdentitySection>
  )
}

function ActorAvatar({ row }: { row: Row }) {
  const { t } = useTranslation('participations')
  const name =
    row.actor.kind === 'user'
      ? row.actor.name
      : t(`activity.actor.${row.actor.kind}`)
  return (
    <Avatar className="mt-0.5 size-5">
      <AvatarFallback
        className={cn(
          'text-[9px] font-semibold',
          row.actor.kind === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground border',
        )}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** "<actor> <verb phrase with the deal as a link>", from one i18n key per
 * event kind. The key carries `{{deal}}`, interpolated with a placeholder
 * and split, so the link can sit anywhere the language needs it. */
function Sentence({ row, orgSlug }: { row: Row; orgSlug: string }) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtEurCents, fmtDate } = useFormatters()
  const dealTitle = useDealTitle()
  const { event } = row

  const actorName =
    row.actor.kind === 'user'
      ? row.actor.name
      : t(`activity.actor.${row.actor.kind}`)

  let text = ''
  switch (event.kind) {
    case 'created':
      text = t('activity.ev.created', { deal: DEAL_TOKEN })
      break
    case 'status_changed':
      text = t('activity.ev.status_changed', {
        deal: DEAL_TOKEN,
        from: t(`status.${event.from}`, { defaultValue: event.from }),
        to: t(`status.${event.to}`, { defaultValue: event.to }),
      })
      if (event.proceedsCents != null) {
        text += t('activity.ev.proceedsSuffix', {
          amount: fmtEurCents(event.proceedsCents),
        })
      }
      break
    case 'converted':
      text = t('activity.ev.converted', {
        deal: DEAL_TOKEN,
        from: t(`instrument.${event.from}`, { defaultValue: event.from }),
        to: t(`instrument.${event.to}`, { defaultValue: event.to }),
      })
      break
    case 'fields_changed': {
      const changes = event.changes
        .map(
          (c) =>
            `${t(`activity.field.${c.field}`)} ${fmtEur(c.from)} → ${fmtEur(c.to)}`,
        )
        .join(', ')
      text =
        changes.length > 0
          ? t('activity.ev.fields_changed', { deal: DEAL_TOKEN, changes }) +
            (event.otherCount > 0
              ? t('activity.ev.otherFieldsSuffix', { count: event.otherCount })
              : '')
          : t('activity.ev.fields_changed_count', {
              deal: DEAL_TOKEN,
              count: event.otherCount,
            })
      break
    }
    case 'valuation_added':
      text = t('activity.ev.valuation_added', {
        deal: DEAL_TOKEN,
        date: fmtDate(event.asOf),
        amount: fmtEur(event.fairValueCents),
      })
      break
    case 'transaction_matched':
      text = t('activity.ev.transaction_matched', {
        deal: DEAL_TOKEN,
        amount: fmtEurCents(event.amountCents),
      })
      break
    case 'transaction_unmatched':
      text = t('activity.ev.transaction_unmatched', {
        deal: DEAL_TOKEN,
        amount: fmtEurCents(event.amountCents),
      })
      break
    case 'document_attached':
      text = t('activity.ev.document_attached', {
        deal: DEAL_TOKEN,
        title: event.title,
      })
      break
    case 'entry_realized':
      text = t('activity.ev.entry_realized', {
        deal: DEAL_TOKEN,
        date: fmtDate(event.date),
        amount: fmtEurCents(event.amountCents),
      })
      break
  }

  const [before, after] = text.split(DEAL_TOKEN)
  const hasDeal = text.includes(DEAL_TOKEN)
  const dealNode = row.deal ? (
    <Link
      to="/app/$orgSlug/deals/$dealId"
      params={{ orgSlug, dealId: row.deal._id }}
      className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-current"
    >
      {dealTitle(row.deal)}
    </Link>
  ) : (
    <span className="text-muted-foreground">{t('activity.deletedDeal')}</span>
  )

  return (
    <>
      <span className="font-medium">{actorName}</span>
      {row.actor.kind === 'user' && row.actor.viaAgent && (
        <span className="text-muted-foreground"> {t('activity.viaAgent')}</span>
      )}{' '}
      {before}
      {hasDeal && dealNode}
      {after}
    </>
  )
}
