import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { listSilentCompanies } from './lib/reportFreshness'
import { attributeActuals } from './lib/amortization'
import { loanSchedule } from './loans'

import type { Doc, Id } from './_generated/dataModel'

/** How many unmatched transactions the tab previews (the full queue lives on
 * the Cash → Transactions tab). */
const UNMATCHED_PREVIEW = 5

/** How many overdue loan instalments the tab previews. */
const OVERDUE_INSTALMENT_PREVIEW = 5

/** Done tasks stay visible this long, then drop from the list (kept in DB). */
const DONE_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000

/** A property's value is considered stale past this (SPEC § 6.8). */
const STALE_VALUATION_MS = 18 * 30 * 24 * 60 * 60 * 1000

/**
 * Months since year 0, UTC — a total order over calendar months, so « the
 * month before » never has to worry about December.
 */
function monthIndex(ms: number): number {
  const d = new Date(ms)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * Aggregated feed of the « To do » tab. Only the signals with no existing
 * public query live here: the degraded bank connections reuse
 * `powens.listConnections` and the overdue forecast entries reuse
 * `forecasts.getUpcomingEntries` (filtered on `overdue`) client-side.
 */
export const getTodo = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const now = Date.now()

    // ── Transactions to reconcile ─────────────────────────────────────────
    // Same exhaustive read as transactions.listUnmatched (the queue must
    // stay exact — it IS the actionable count), previewed to a few rows.
    const unmatched = await ctx.db
      .query('transactions')
      .withIndex('by_org_matchStatus', (q) =>
        q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
      )
      .collect()
    unmatched.sort((a, b) => b.transactionDate - a.transactionDate)
    const accounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const accountsById = new Map(accounts.map((a) => [a._id, a]))
    const unmatchedPreview = unmatched
      .slice(0, UNMATCHED_PREVIEW)
      .map((tx) => {
        const account = accountsById.get(tx.bankAccountId)
        return {
          _id: tx._id,
          direction: tx.direction,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          accountLabel: account
            ? (account.displayName ?? account.label)
            : null,
        }
      })

    // ── Silent portfolio companies ────────────────────────────────────────
    // Same detection as the badge on the participations list — one source
    // (lib/reportFreshness.ts), so the two surfaces never disagree.
    const missingReports = await listSilentCompanies(ctx, orgId, now)

    // ── Loan instalments due with nothing matched ─────────────────────────
    // A DERIVED signal, never stored (SPEC D19): the schedule is recomputed
    // and compared with what actually went out. An instalment whose calendar
    // period holds no matched outflow is a matching gap to close — the app
    // says WHICH instalment, and the human goes and matches it in the queue.
    // Nothing is proposed, nothing is pre-selected.
    const activeLoans = await ctx.db
      .query('loans')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'active'),
      )
      .collect()
    const overdueInstalments: Array<{
      loanId: Id<'loans'>
      label: string
      lenderName: string
      date: number
      amountCents: number
    }> = []
    for (const loan of activeLoans) {
      // Through the single shared reader (rate steps + amendments), so the
      // signal never names an instalment the loan sheet does not show.
      const schedule = await loanSchedule(ctx, loan, { horizonDate: now })
      if (schedule.length === 0) continue

      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_org_allocation_target', (q) =>
          q.eq('orgId', orgId).eq('allocation.targetId', loan._id as string),
        )
        .collect()
      const actuals = attributeActuals(
        schedule,
        txs
          .filter((tx) => tx.allocation?.kind === 'loan')
          .map((tx) => ({
            transactionDate: tx.transactionDate,
            amountCents: tx.direction === 'out' ? tx.amount : -tx.amount,
          })),
      )
      schedule.forEach((row, index) => {
        // Only what is already DUE, and only what actually costs something:
        // a totally deferred instalment moves no cash to look for.
        if (row.date > now) return
        const dueCents = row.paymentCents + row.insuranceCents
        if (dueCents <= 0) return
        if (actuals[index] != null) return
        overdueInstalments.push({
          loanId: loan._id,
          label: loan.label,
          lenderName: loan.lenderName,
          date: row.date,
          amountCents: dueCents,
        })
      })
    }
    // Most recent first, and bounded: the tab is a preview, the exhaustive
    // reading lives on the loan sheet.
    overdueInstalments.sort((a, b) => b.date - a.date)
    const overdueInstalmentsPreview = overdueInstalments.slice(
      0,
      OVERDUE_INSTALMENT_PREVIEW,
    )

    // ── Properties whose value has gone stale ─────────────────────────────
    // A DERIVED signal, like the one above (SPEC D19, § 6.8): a property
    // nobody has revalued in eighteen months carries a latent gain and a
    // yield computed against a figure that has stopped meaning anything.
    // Sold properties are out — their value is the sale price, and it is not
    // going to move.
    const heldProperties = await ctx.db
      .query('properties')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'held'),
      )
      .collect()
    const staleValuations: Array<{
      propertyId: Id<'properties'>
      name: string
      address: string
      lastValuationAt: number | null
    }> = []
    for (const property of heldProperties) {
      const last = await ctx.db
        .query('propertyValuations')
        .withIndex('by_property_asof', (q) =>
          q.eq('propertyId', property._id),
        )
        .order('desc')
        .first()
      // Never valued counts as stale: it is the same missing answer to « what
      // is it worth », and the one the user can act on straight away.
      if (last && now - last.asOf <= STALE_VALUATION_MS) continue
      staleValuations.push({
        propertyId: property._id,
        name: property.name,
        address: property.address,
        lastValuationAt: last?.asOf ?? null,
      })
    }
    // Oldest first — the one that has waited longest is the one to do.
    staleValuations.sort(
      (a, b) => (a.lastValuationAt ?? 0) - (b.lastValuationAt ?? 0),
    )

    // ── Properties whose rent stopped arriving ────────────────────────────
    // A DERIVED signal like the two above (SPEC D19, § 6.8), and the only way
    // to build it: there is no « expected rent » anywhere to compare against,
    // because a lease is out of scope (D24). So the property's OWN history is
    // the expectation — a rent that landed every month and then did not.
    //
    // Two deliberate limits, both preferable to a signal that cries wolf:
    // - The CURRENT month is never judged. A rent due on the 5th is not late
    //   on the 2nd, and judging it would fire this signal every month start.
    //   The window is the last COMPLETE month, against the three before it.
    // - A property that has never been let says nothing. Silence is only
    //   readable against a habit, and there is no habit to break.
    const missingRents: Array<{
      propertyId: Id<'properties'>
      name: string
      address: string
      lastRentAt: number
    }> = []
    for (const property of heldProperties) {
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_org_allocation_target', (q) =>
          q
            .eq('orgId', orgId)
            .eq('allocation.targetId', property._id as string),
        )
        .collect()
      const rents = txs.filter(
        (tx) =>
          tx.allocation?.kind === 'property' &&
          tx.allocation.category === 'loyer' &&
          tx.direction === 'in',
      )
      if (rents.length === 0) continue
      const months = new Set(rents.map((tx) => monthIndex(tx.transactionDate)))
      const lastComplete = monthIndex(now) - 1
      const habit =
        months.has(lastComplete - 1) &&
        months.has(lastComplete - 2) &&
        months.has(lastComplete - 3)
      if (!habit || months.has(lastComplete)) continue
      missingRents.push({
        propertyId: property._id,
        name: property.name,
        address: property.address,
        lastRentAt: Math.max(...rents.map((tx) => tx.transactionDate)),
      })
    }
    // Longest silence first.
    missingRents.sort((a, b) => a.lastRentAt - b.lastRentAt)

    // ── Manual tasks ──────────────────────────────────────────────────────
    // Done tasks older than DONE_VISIBLE_MS are hidden (not deleted). Within
    // a status group the UI keeps this order: due date first, then newest.
    const allTasks = await ctx.db
      .query('todos')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const tasks = allTasks.filter(
      (task) =>
        task.status !== 'done' ||
        now - (task.doneAt ?? task.createdAt) <= DONE_VISIBLE_MS,
    )
    tasks.sort((a, b) => {
      const dueA = a.dueDate ?? Number.POSITIVE_INFINITY
      const dueB = b.dueDate ?? Number.POSITIVE_INFINITY
      return dueA !== dueB ? dueA - dueB : b.createdAt - a.createdAt
    })
    const assigneeNames = new Map<Id<'users'>, string>()
    const companyNames = new Map<Id<'companies'>, string>()
    for (const task of tasks) {
      if (task.assigneeUserId && !assigneeNames.has(task.assigneeUserId)) {
        const u = await ctx.db.get('users', task.assigneeUserId)
        assigneeNames.set(task.assigneeUserId, u?.name ?? u?.email ?? '?')
      }
      if (task.companyId && !companyNames.has(task.companyId)) {
        const c = await ctx.db.get('companies', task.companyId)
        if (c) companyNames.set(task.companyId, c.name)
      }
    }

    return {
      unmatchedCount: unmatched.length,
      unmatchedPreview,
      missingReports,
      overdueInstalmentsCount: overdueInstalments.length,
      overdueInstalments: overdueInstalmentsPreview,
      staleValuations,
      missingRents,
      tasks: tasks.map((task: Doc<'todos'>) => ({
        _id: task._id,
        title: task.title,
        status: task.status,
        createdAt: task.createdAt,
        doneAt: task.doneAt ?? null,
        dueDate: task.dueDate ?? null,
        assignee: task.assigneeUserId
          ? {
              userId: task.assigneeUserId,
              name: assigneeNames.get(task.assigneeUserId) ?? '?',
            }
          : null,
        company:
          task.companyId && companyNames.has(task.companyId)
            ? {
                _id: task.companyId,
                name: companyNames.get(task.companyId) as string,
              }
            : null,
      })),
    }
  },
})

export const createTask = mutation({
  args: {
    orgId: v.id('organizations'),
    title: v.string(),
    dueDate: v.optional(v.number()),
    assigneeUserId: v.optional(v.id('users')),
    companyId: v.optional(v.id('companies')),
  },
  handler: async (
    ctx,
    { orgId, title, dueDate, assigneeUserId, companyId },
  ) => {
    const { user } = await requireOrgMember(ctx, orgId)
    const trimmed = title.trim()
    if (!trimmed) throw new ConvexError('invalid_title')
    if (assigneeUserId) {
      const membership = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', assigneeUserId),
        )
        .unique()
      if (!membership) throw new ConvexError('assignee_not_member')
    }
    if (companyId) {
      const company = await ctx.db.get('companies', companyId)
      if (!company || company.orgId !== orgId)
        throw new ConvexError('company_not_in_org')
    }
    return ctx.db.insert('todos', {
      orgId,
      title: trimmed,
      status: 'open',
      createdBy: user._id,
      createdAt: Date.now(),
      dueDate,
      assigneeUserId,
      companyId,
    })
  },
})

export const setTaskStatus = mutation({
  args: {
    taskId: v.id('todos'),
    status: v.union(
      v.literal('open'),
      v.literal('in_progress'),
      v.literal('done'),
    ),
  },
  handler: async (ctx, { taskId, status }) => {
    const task = await ctx.db.get('todos', taskId)
    if (!task) throw new ConvexError('not_found')
    await requireOrgMember(ctx, task.orgId)
    await ctx.db.patch('todos', taskId, {
      status,
      doneAt: status === 'done' ? Date.now() : undefined,
    })
  },
})

export const removeTask = mutation({
  args: { taskId: v.id('todos') },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get('todos', taskId)
    if (!task) throw new ConvexError('not_found')
    await requireOrgMember(ctx, task.orgId)
    await ctx.db.delete('todos', taskId)
  },
})
