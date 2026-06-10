/**
 * Outils agent du prévisionnel de cash (forecastRules / forecastEntries),
 * scopés à l'org du thread (pattern convex/agentTools.ts). Réutilisent les
 * cœurs partagés de convex/forecasts.ts (`insertRule`, `expandRulesForOrgs`,
 * `computeForecastBalanceForOrgs`).
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import {
  assertValidHorizon,
  computeForecastBalanceForOrgs,
  expandRulesForOrgs,
  insertRule,
} from './forecasts'
import { parseScope, readMembership } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

// L'agent ne déclenche jamais une expansion au-delà de 24 mois (la mutation
// publique monte à 120) — garde-fou contre une expansion massive silencieuse.
const AGENT_EXPAND_MAX_MONTHS = 24
const ENTRIES_LIMIT_MAX = 100
const ENTRIES_LIMIT_DEFAULT = 50

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function parseISODate(iso: string, code: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new ConvexError(code)
  return ms
}

// ─── Internal queries / mutations (re-check membership) ─────────────────────

export const listRulesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rules = await ctx.db
      .query('forecastRules')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(50)
    return rules.map((rule) => ({
      _id: rule._id,
      label: rule.label,
      amountCents: rule.amountCents,
      direction: rule.direction,
      category: rule.category ?? null,
      frequency: rule.frequency,
      interval: rule.interval,
      anchorDay: rule.anchorDay,
      startDateISO: toISODate(rule.startDate),
      endDateISO: rule.endDate ? toISODate(rule.endDate) : null,
      active: rule.active,
    }))
  },
})

export const createRuleInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    label: v.string(),
    amountCents: v.number(),
    direction: v.union(v.literal('in'), v.literal('out')),
    category: v.optional(v.string()),
    frequency: v.union(
      v.literal('weekly'),
      v.literal('monthly'),
      v.literal('quarterly'),
      v.literal('yearly'),
    ),
    interval: v.optional(v.number()),
    anchorDay: v.number(),
    startDate: v.number(),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, { actorUserId, ...args }) => {
    await readMembership(ctx, args.orgId, actorUserId)
    const id = await insertRule(ctx, args)
    return { _id: id }
  },
})

export const listEntriesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('realized'),
        v.literal('cancelled'),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, actorUserId, dateFrom, dateTo, status, limit }) => {
    await readMembership(ctx, orgId, actorUserId)
    const take = Math.min(
      Math.max(limit ?? ENTRIES_LIMIT_DEFAULT, 1),
      ENTRIES_LIMIT_MAX,
    )
    const rows = await ctx.db
      .query('forecastEntries')
      .withIndex('by_org_and_date', (q) => {
        const base = q.eq('orgId', orgId)
        const from = dateFrom != null ? base.gte('date', dateFrom) : base
        return dateTo != null ? from.lte('date', dateTo) : from
      })
      .take(take * 2) // marge pour le filtre status ci-dessous
    const filtered = status ? rows.filter((e) => e.status === status) : rows
    return filtered.slice(0, take).map((entry) => ({
      _id: entry._id,
      dateISO: toISODate(entry.date),
      amountCents: entry.amountCents,
      direction: entry.direction,
      confidence: entry.confidence,
      status: entry.status,
      label: entry.label,
      category: entry.category ?? null,
      derivedFromRule: entry.ruleId != null,
    }))
  },
})

export const getForecastBalanceInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    horizonMonths: v.number(),
    minConfidence: v.optional(
      v.union(
        v.literal('confirmed'),
        v.literal('expected'),
        v.literal('probable'),
      ),
    ),
  },
  handler: async (ctx, { orgId, actorUserId, horizonMonths, minConfidence }) => {
    await readMembership(ctx, orgId, actorUserId)
    assertValidHorizon(horizonMonths)
    return await computeForecastBalanceForOrgs(
      ctx,
      [orgId],
      horizonMonths,
      minConfidence,
    )
  },
})

export const expandRulesInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    horizonMonths: v.number(),
  },
  handler: async (ctx, { orgId, actorUserId, horizonMonths }) => {
    await readMembership(ctx, orgId, actorUserId)
    assertValidHorizon(horizonMonths)
    if (horizonMonths > AGENT_EXPAND_MAX_MONTHS) {
      throw new ConvexError('horizon_too_large_for_agent')
    }
    return await expandRulesForOrgs(ctx, [orgId], horizonMonths)
  },
})

export const markEntryRealizedInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    entryId: v.id('forecastEntries'),
    transactionId: v.id('transactions'),
  },
  handler: async (ctx, { orgId, actorUserId, entryId, transactionId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry || entry.orgId !== orgId) throw new ConvexError('not_found')

    // Mêmes garde-fous que forecasts.ts:markEntryRealized : la transaction
    // doit être de la même org ; on ne touche jamais à la transaction.
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx || tx.orgId !== entry.orgId) {
      throw new ConvexError('transaction_wrong_org')
    }

    await ctx.db.patch('forecastEntries', entry._id, {
      status: 'realized',
      realizedTransactionId: transactionId,
    })
    return { _id: entryId, status: 'realized' as const }
  },
})

// ─── Tools exposés à l'agent ────────────────────────────────────────────────

const listForecastRules = createTool({
  description:
    'List the recurring cash-flow forecast rules of the current org (rents, ' +
    'salaries, loan payments…). Amounts in CENTS EUR.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentToolsForecasts.listRulesInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const createForecastRule = createTool({
  description:
    'Create a recurring cash-flow forecast rule (e.g. monthly rent). ' +
    'amountCents in CENTS EUR, positive. direction "in" (income) or "out" ' +
    '(expense). anchorDay: day of month (1-31) or day of week (1-7 for ' +
    'weekly). Creating a rule does NOT generate entries: propose to call ' +
    'expandForecastRules afterwards. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    label: z.string().min(1).describe('e.g. "Loyer SCI Chapelle"'),
    amountCents: z.number().int().positive().describe('cents EUR'),
    direction: z.enum(['in', 'out']),
    category: z.string().optional(),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    interval: z.number().int().min(1).optional().describe('default 1'),
    anchorDay: z.number().int().min(1).max(31),
    startDateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    endDateISO: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.createRuleInternal,
      {
        orgId,
        actorUserId: userId,
        label: input.label,
        amountCents: input.amountCents,
        direction: input.direction,
        category: input.category,
        frequency: input.frequency,
        interval: input.interval,
        anchorDay: input.anchorDay,
        startDate: parseISODate(input.startDateISO, 'invalid_start_date'),
        endDate: input.endDateISO
          ? parseISODate(input.endDateISO, 'invalid_end_date')
          : undefined,
      },
    )
  },
})

const listForecastEntries = createTool({
  description:
    'List forecast entries (dated expected cash flows) of the current org, ' +
    'optionally filtered by date range (ISO "YYYY-MM-DD") and status ' +
    '(pending / realized / cancelled). Returns at most 100 rows.',
  inputSchema: z.object({
    fromISO: z.string().optional(),
    toISO: z.string().optional(),
    status: z.enum(['pending', 'realized', 'cancelled']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentToolsForecasts.listEntriesInternal, {
      orgId,
      actorUserId: userId,
      dateFrom: input.fromISO
        ? parseISODate(input.fromISO, 'invalid_from_date')
        : undefined,
      dateTo: input.toISO
        ? parseISODate(input.toISO, 'invalid_to_date')
        : undefined,
      status: input.status,
      limit: input.limit,
    })
  },
})

const expandForecastRules = createTool({
  description:
    'Generate/refresh the dated forecast entries from the active rules of ' +
    'the current org over the given horizon (months, max 24). Idempotent: ' +
    'manually overridden / realized / cancelled entries are never ' +
    'rewritten. Call this after creating or updating a rule.',
  needsApproval: true,
  inputSchema: z.object({
    horizonMonths: z.number().int().min(1).max(24),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.expandRulesInternal,
      { orgId, actorUserId: userId, horizonMonths: input.horizonMonths },
    )
  },
})

const getForecastBalance = createTool({
  description:
    'Projected monthly cash balance of the current org: starting balance = ' +
    'sum of real EUR bank account balances, then pending forecast entries ' +
    'month by month over the horizon. minConfidence "confirmed" = committed ' +
    'flows only, "expected" = committed + expected, omit for all. Amounts ' +
    'in CENTS EUR.',
  inputSchema: z.object({
    horizonMonths: z.number().int().min(1).max(120),
    minConfidence: z.enum(['confirmed', 'expected']).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsForecasts.getForecastBalanceInternal,
      {
        orgId,
        actorUserId: userId,
        horizonMonths: input.horizonMonths,
        minConfidence: input.minConfidence,
      },
    )
  },
})

const markForecastEntryRealized = createTool({
  description:
    'Mark a forecast entry as realized by linking it to a real bank ' +
    'transaction of the same org (find ids via listForecastEntries and ' +
    'listUnmatchedTransactions / listTransactions). Does NOT touch the ' +
    'transaction itself. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    entryId: z.string(),
    transactionId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.markEntryRealizedInternal,
      {
        orgId,
        actorUserId: userId,
        entryId: input.entryId as Id<'forecastEntries'>,
        transactionId: input.transactionId as Id<'transactions'>,
      },
    )
  },
})

export const forecastTools = {
  listForecastRules,
  createForecastRule,
  listForecastEntries,
  expandForecastRules,
  getForecastBalance,
  markForecastEntryRealized,
}
