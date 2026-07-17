import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

import type { Doc, Id } from './_generated/dataModel'

/** How many unmatched transactions the tab previews (the full queue lives on
 * the Cash → Transactions tab). */
const UNMATCHED_PREVIEW = 5

/** A portfolio company is « silent » past 3 months without a received report.
 * Measured on the RECEPTION date (email date), not the covered period: a
 * quarterly reporter would otherwise look stale right after reporting. */
const REPORT_SILENCE_MS = 90 * 24 * 60 * 60 * 1000

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
    // Scope: non-archived portfolio companies target of at least one live
    // deal (an exited position would nag forever) that have reported at
    // least once (a company that never emails reports is not a to-do).
    const liveTargets = new Set<Id<'companies'>>()
    for (const status of ['active', 'partially_exited'] as const) {
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org_status', (q) =>
          q.eq('orgId', orgId).eq('status', status),
        )
        .collect()
      for (const deal of deals) liveTargets.add(deal.targetCompanyId)
    }
    const portfolio = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', 'portfolio'),
      )
      .collect()
    const missingReports: Array<{
      companyId: Id<'companies'>
      companyName: string
      lastReportAt: number
    }> = []
    for (const company of portfolio) {
      if (company.archivedAt || !liveTargets.has(company._id)) continue
      const reports = await ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', company._id))
        .collect()
      if (reports.length === 0) continue
      const lastReportAt = reports.reduce(
        (max, r) => Math.max(max, r.emailDate ?? r._creationTime),
        0,
      )
      if (now - lastReportAt > REPORT_SILENCE_MS) {
        missingReports.push({
          companyId: company._id,
          companyName: company.name,
          lastReportAt,
        })
      }
    }
    missingReports.sort((a, b) => a.lastReportAt - b.lastReportAt)

    // ── Manual tasks ──────────────────────────────────────────────────────
    const tasks = await ctx.db
      .query('todos')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    tasks.sort((a, b) =>
      a.status === b.status
        ? b.createdAt - a.createdAt
        : a.status === 'open'
          ? -1
          : 1,
    )

    return {
      unmatchedCount: unmatched.length,
      unmatchedPreview,
      missingReports,
      tasks: tasks.map((task: Doc<'todos'>) => ({
        _id: task._id,
        title: task.title,
        status: task.status,
        createdAt: task.createdAt,
        doneAt: task.doneAt ?? null,
      })),
    }
  },
})

export const createTask = mutation({
  args: { orgId: v.id('organizations'), title: v.string() },
  handler: async (ctx, { orgId, title }) => {
    const { user } = await requireOrgMember(ctx, orgId)
    const trimmed = title.trim()
    if (!trimmed) throw new ConvexError('invalid_title')
    return ctx.db.insert('todos', {
      orgId,
      title: trimmed,
      status: 'open',
      createdBy: user._id,
      createdAt: Date.now(),
    })
  },
})

export const setTaskDone = mutation({
  args: { taskId: v.id('todos'), done: v.boolean() },
  handler: async (ctx, { taskId, done }) => {
    const task = await ctx.db.get('todos', taskId)
    if (!task) throw new ConvexError('not_found')
    await requireOrgMember(ctx, task.orgId)
    await ctx.db.patch('todos', taskId, {
      status: done ? 'done' : 'open',
      doneAt: done ? Date.now() : undefined,
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
