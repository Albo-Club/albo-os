import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { directionTone } from '~/lib/moneyTone'
import { ConnectionsBanner } from '~/components/cash/BankConnectionsHealth'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'

export const Route = createFileRoute('/app/$orgSlug/todo')({
  component: Todo,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'todo')('metaTitle'),
      },
    ],
  }),
})

/** Shared shell of the auto-signal sections: title + count badge + body. */
function TodoSection({
  title,
  count,
  action,
  children,
}: {
  title: string
  count: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {title}
          {count > 0 && <Badge variant="secondary">{count}</Badge>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
      {label}
    </div>
  )
}

function Todo() {
  const { t } = useTranslation('todo')
  const { orgSlug } = Route.useParams()
  const { fmtEur, fmtDate } = useFormatters()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const data = useConvexQuery(
    api.todo.getTodo,
    org ? { orgId: org._id } : 'skip',
  )
  // Overdue entries reuse the exact Prévisionnel-tab definition (pending EUR
  // entries past their date), so both surfaces always agree.
  const upcoming = useConvexQuery(
    api.forecasts.getUpcomingEntries,
    org ? { orgId: org._id } : 'skip',
  )
  const overdue = upcoming?.entries.filter((e) => e.overdue)

  const createTask = useConvexMutation(api.todo.createTask)
  const setTaskDone = useConvexMutation(api.todo.setTaskDone)
  const removeTask = useConvexMutation(api.todo.removeTask)
  const [newTitle, setNewTitle] = useState('')

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!org || !newTitle.trim()) return
    try {
      await createTask({ orgId: org._id, title: newTitle })
      setNewTitle('')
    } catch {
      toast.error(t('tasks.failed'))
    }
  }

  async function handleToggle(taskId: Id<'todos'>, done: boolean) {
    try {
      await setTaskDone({ taskId, done })
    } catch {
      toast.error(t('tasks.failed'))
    }
  }

  async function handleRemove(taskId: Id<'todos'>) {
    try {
      await removeTask({ taskId })
    } catch {
      toast.error(t('tasks.failed'))
    }
  }

  if (!data) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      </main>
    )
  }

  const openTasks = data.tasks.filter((task) => task.status === 'open')

  return (
    <main className="flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      {/* Degraded bank connections — same banner as the Cash overview
          (renders nothing when everything is healthy). */}
      {org && <ConnectionsBanner orgId={org._id} orgSlug={orgSlug} />}

      <TodoSection title={t('tasks.title')} count={openTasks.length}>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder={t('tasks.placeholder')}
            maxLength={200}
          />
          <Button type="submit" disabled={!org || !newTitle.trim()}>
            {t('tasks.add')}
          </Button>
        </form>
        {data.tasks.length === 0 ? (
          <EmptyHint label={t('tasks.empty')} />
        ) : (
          <div className="divide-y rounded-lg border">
            {data.tasks.map((task) => (
              <div
                key={task._id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Checkbox
                  checked={task.status === 'done'}
                  onCheckedChange={(checked) =>
                    handleToggle(task._id, checked === true)
                  }
                  aria-label={t('tasks.markDone')}
                />
                <span
                  className={`flex-1 text-sm ${
                    task.status === 'done'
                      ? 'text-muted-foreground line-through'
                      : ''
                  }`}
                >
                  {task.title}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('tasks.delete')}
                  onClick={() => handleRemove(task._id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </TodoSection>

      <TodoSection
        title={t('unmatched.title')}
        count={data.unmatchedCount}
        action={
          data.unmatchedCount > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/app/$orgSlug/cash"
                params={{ orgSlug }}
                search={{ tab: 'transactions' }}
              >
                {t('unmatched.cta')}
              </Link>
            </Button>
          )
        }
      >
        {data.unmatchedCount === 0 ? (
          <EmptyHint label={t('unmatched.empty')} />
        ) : (
          <div className="divide-y rounded-lg border">
            {data.unmatchedPreview.map((tx) => (
              <div
                key={tx._id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {tx.counterparty ?? tx.rawLabel}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {fmtDate(tx.transactionDate)}
                    {tx.accountLabel && <> · {tx.accountLabel}</>}
                  </span>
                </span>
                <span
                  className={`tabular-nums ${directionTone(tx.direction)}`}
                >
                  {tx.direction === 'out' ? '−' : '+'}
                  {fmtEur(tx.amount)}
                </span>
              </div>
            ))}
            {data.unmatchedCount > data.unmatchedPreview.length && (
              <div className="text-muted-foreground px-4 py-2.5 text-xs">
                {t('unmatched.more', {
                  count: data.unmatchedCount - data.unmatchedPreview.length,
                })}
              </div>
            )}
          </div>
        )}
      </TodoSection>

      <TodoSection
        title={t('forecast.title')}
        count={overdue?.length ?? 0}
        action={
          overdue &&
          overdue.length > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/app/$orgSlug/cash"
                params={{ orgSlug }}
                search={{ tab: 'previsionnel' }}
              >
                {t('forecast.cta')}
              </Link>
            </Button>
          )
        }
      >
        {!overdue || overdue.length === 0 ? (
          <EmptyHint label={t('forecast.empty')} />
        ) : (
          <div className="divide-y rounded-lg border">
            {overdue.map((entry) => (
              <div
                key={entry._id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{entry.label}</span>
                  <span className="text-destructive text-xs">
                    {fmtDate(entry.date)}
                  </span>
                </span>
                <span
                  className={`tabular-nums ${directionTone(entry.direction)}`}
                >
                  {entry.direction === 'out' ? '−' : '+'}
                  {fmtEur(entry.amountCents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </TodoSection>

      <TodoSection
        title={t('reports.title')}
        count={data.missingReports.length}
      >
        {data.missingReports.length === 0 ? (
          <EmptyHint label={t('reports.empty')} />
        ) : (
          <>
            <div className="divide-y rounded-lg border">
              {data.missingReports.map((row) => (
                <div
                  key={row.companyId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <Link
                    to="/app/$orgSlug/participations/$companyId"
                    params={{ orgSlug, companyId: row.companyId }}
                    className="font-medium hover:underline"
                  >
                    {row.companyName}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {t('reports.lastReport', {
                      date: fmtDate(row.lastReportAt),
                    })}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{t('reports.hint')}</p>
          </>
        )}
      </TodoSection>
    </main>
  )
}
