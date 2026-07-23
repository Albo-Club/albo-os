import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { directionTone } from '~/lib/moneyTone'
import { dateInputToMs } from '~/lib/parse'
import { ConnectionsBanner } from '~/components/cash/BankConnectionsHealth'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

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

type TaskStatus = 'open' | 'in_progress' | 'done'

/** Clicking the status indicator cycles through the three states. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}

const STATUS_ORDER: ReadonlyArray<TaskStatus> = ['open', 'in_progress', 'done']

/** Cura-style tri-state indicator: empty circle → warning ring → green check. */
function StatusIndicator({ status }: { status: TaskStatus }) {
  if (status === 'done') {
    return (
      <span className="bg-positive flex size-4 items-center justify-center rounded-full text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="border-warning flex size-4 items-center justify-center rounded-full border-2">
        <span className="bg-warning size-1.5 rounded-full" />
      </span>
    )
  }
  return (
    <span className="border-muted-foreground/40 block size-4 rounded-full border-2" />
  )
}

/** Sentinel for the « none » entries of the composer selects (shadcn Select
 * forbids an empty item value). */
const NONE = 'none'

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
  const setTaskStatus = useConvexMutation(api.todo.setTaskStatus)
  const removeTask = useConvexMutation(api.todo.removeTask)

  // ── Task composer ───────────────────────────────────────────────────────
  const [composerOpen, setComposerOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCompanyId, setNewCompanyId] = useState(NONE)
  const [newAssigneeId, setNewAssigneeId] = useState(NONE)
  const [newDueDate, setNewDueDate] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  // Composer-only data (portfolio companies + org members), fetched lazily.
  const companies = useConvexQuery(
    api.companies.list,
    org && composerOpen ? { orgId: org._id, kind: 'portfolio' } : 'skip',
  )
  const members = useConvexQuery(
    api.organizations.listMembers,
    org && composerOpen ? { orgId: org._id } : 'skip',
  )

  useEffect(() => {
    if (composerOpen) titleRef.current?.focus()
  }, [composerOpen])

  // « T » opens the composer, like Cura — ignored while typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 't' && event.key !== 'T') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      setComposerOpen(true)
      titleRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!org || !newTitle.trim()) return
    try {
      await createTask({
        orgId: org._id,
        title: newTitle,
        dueDate: dateInputToMs(newDueDate) ?? undefined,
        assigneeUserId:
          newAssigneeId === NONE ? undefined : (newAssigneeId as Id<'users'>),
        companyId:
          newCompanyId === NONE ? undefined : (newCompanyId as Id<'companies'>),
      })
      setNewTitle('')
      setNewCompanyId(NONE)
      setNewAssigneeId(NONE)
      setNewDueDate('')
      titleRef.current?.focus()
    } catch {
      toast.error(t('tasks.failed'))
    }
  }

  async function handleSetStatus(taskId: Id<'todos'>, status: TaskStatus) {
    try {
      await setTaskStatus({ taskId, status })
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

  const actionableCount = data.tasks.filter(
    (task) => task.status !== 'done',
  ).length
  const now = Date.now()

  return (
    <main className="flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      {/* Degraded bank connections — same banner as the Cash overview
          (renders nothing when everything is healthy). */}
      {org && <ConnectionsBanner orgId={org._id} orgSlug={orgSlug} />}

      <TodoSection
        title={t('tasks.title')}
        count={actionableCount}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setComposerOpen(true)}
          >
            <Plus className="size-4" />
            {t('tasks.new')}
            <kbd className="bg-muted text-muted-foreground rounded border px-1 font-mono text-[10px]">
              T
            </kbd>
          </Button>
        }
      >
        {composerOpen && (
          <form
            onSubmit={handleAdd}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setComposerOpen(false)
            }}
            className="space-y-2 rounded-lg border p-3"
          >
            <Input
              ref={titleRef}
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={t('tasks.placeholder')}
              maxLength={200}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={newCompanyId} onValueChange={setNewCompanyId}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder={t('tasks.company')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('tasks.noCompany')}</SelectItem>
                  {companies?.map((company) => (
                    <SelectItem key={company._id} value={company._id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={newAssigneeId} onValueChange={setNewAssigneeId}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder={t('tasks.assignee')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('tasks.noAssignee')}</SelectItem>
                  {members?.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name ?? member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={newDueDate}
                onChange={(event) => setNewDueDate(event.target.value)}
                className="h-8 w-40"
                aria-label={t('tasks.dueDate')}
              />
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setComposerOpen(false)}
                >
                  {t('tasks.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={!newTitle.trim()}>
                  {t('tasks.add')}
                </Button>
              </div>
            </div>
          </form>
        )}
        {data.tasks.length === 0 && !composerOpen ? (
          <EmptyHint label={t('tasks.empty')} />
        ) : (
          STATUS_ORDER.map((status) => {
            const group = data.tasks.filter((task) => task.status === status)
            if (group.length === 0) return null
            return (
              <div key={status} className="space-y-1.5">
                <h3 className="flex items-center gap-1.5 text-xs font-medium">
                  {t(`tasks.groups.${status}`)}
                  <span className="text-muted-foreground">{group.length}</span>
                </h3>
                <div className="divide-y rounded-lg border">
                  {group.map((task) => {
                    const done = task.status === 'done'
                    const isLate =
                      !done && task.dueDate != null && task.dueDate < now
                    return (
                      <div
                        key={task._id}
                        className="group flex items-center gap-3 px-4 py-2.5"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            handleSetStatus(task._id, NEXT_STATUS[task.status])
                          }
                          aria-label={t('tasks.cycleStatus')}
                          className="shrink-0 rounded-full transition-opacity hover:opacity-70"
                        >
                          <StatusIndicator status={task.status} />
                        </button>
                        {task.company && (
                          <Link
                            to="/app/$orgSlug/participations/$companyId"
                            params={{ orgSlug, companyId: task.company._id }}
                            className="shrink-0"
                          >
                            <Badge
                              variant="outline"
                              className="text-muted-foreground hover:text-foreground font-normal"
                            >
                              {task.company.name}
                            </Badge>
                          </Link>
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            done ? 'text-muted-foreground line-through' : ''
                          }`}
                        >
                          {task.title}
                        </span>
                        {task.assignee && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {task.assignee.name}
                          </span>
                        )}
                        {task.dueDate != null && (
                          <span
                            className={`shrink-0 text-xs tabular-nums ${
                              isLate
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {fmtDate(task.dueDate)}
                          </span>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('tasks.delete')}
                          onClick={() => handleRemove(task._id)}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
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
