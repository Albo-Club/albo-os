/**
 * Agent tools for the cash-flow forecast (forecastRules / forecastEntries),
 * scoped to the thread's org (convex/agentTools.ts pattern). They reuse the
 * shared cores from convex/forecasts.ts (`insertRule`, `expandRulesForOrgs`,
 * `computeForecastGridForOrg`, `applyMarkEntryRealized`).
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import {
  applyMarkEntryRealized,
  assertValidHorizon,
  computeForecastGridForOrg,
  expandRulesForOrgs,
  insertRule,
} from './forecasts'
import { parseScope, readMembership } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

// The agent never triggers an expansion beyond 24 months (the public
// mutation goes up to 120) — guardrail against a silent massive expansion.
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
      .take(take * 2) // headroom for the status filter below
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

    // Same consumption semantics as the UI (forecasts.getForecastGrid):
    // current-month pending flows are consumed by the realized ones per
    // (direction, category) cell, overdue entries roll into the current
    // month, scope = available EUR accounts. `historyMonths: 0` — no
    // history needed, the current month's realized flows are still read.
    const grid = await computeForecastGridForOrg(ctx, orgId, 0, horizonMonths)
    // The grid splits pending flows committed vs planned (expected AND
    // probable): "confirmed" maps to the committed-only scenario, anything
    // else to the with-planned scenario.
    const committedOnly = minConfidence === 'confirmed'
    const balanceByMonth = new Map(
      grid.projection.map((point) => [
        point.monthKey,
        committedOnly ? point.committedBalanceCents : point.plannedBalanceCents,
      ]),
    )
    const months = grid.months.map((key) => {
      let inflowCents = 0
      let outflowCents = 0
      for (const row of grid.rows) {
        const cell = row.byMonth[key]
        if (!cell) continue
        const pending =
          cell.committedCents + (committedOnly ? 0 : cell.plannedCents)
        if (row.direction === 'in') inflowCents += pending
        else outflowCents += pending
      }
      return {
        monthKey: key,
        // Pending flows still to come (current month: AFTER consumption).
        inflowCents,
        outflowCents,
        netCents: inflowCents - outflowCents,
        projectedBalanceCents: balanceByMonth.get(key) ?? 0,
      }
    })

    return {
      startingBalanceCents: grid.startingBalanceCents,
      currency: 'EUR',
      currentMonthKey: grid.currentMonthKey,
      ignoredNonEurAccounts: grid.ignoredNonEurAccounts,
      ignoredNonEurEntries: grid.ignoredNonEurEntries,
      months,
    }
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
    mode: v.optional(
      v.union(v.literal('close'), v.literal('keepRemainder')),
    ),
  },
  handler: async (ctx, { orgId, actorUserId, entryId, transactionId, mode }) => {
    await readMembership(ctx, orgId, actorUserId)
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry || entry.orgId !== orgId) throw new ConvexError('not_found')

    // Shared core (forecasts.ts): same-org guardrail, never touches the
    // transaction itself; `keepRemainder` splits off a pending one-shot
    // entry carrying the unpaid balance.
    await applyMarkEntryRealized(ctx, entry, transactionId, mode ?? 'close')
    return { _id: entryId, status: 'realized' as const }
  },
})

// ─── Tools exposed to the agent─────────────────────────────────────────────

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
    'Projected monthly cash balance of the current org, same semantics as ' +
    'the Cash page: starting balance = available EUR accounts (active, ' +
    'non-pledged), current-month pending flows are consumed by the flows ' +
    'already realized in the same category, overdue entries roll into the ' +
    'current month. inflow/outflow are the pending flows still to come. ' +
    'minConfidence "confirmed" = committed scenario only; omit (or ' +
    '"expected") to include planned flows. Amounts in CENTS EUR.',
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
    'transaction itself. When the transaction amount differs from the ' +
    'forecast amount, mode picks the explicit decision: "close" (default) ' +
    'realizes with the gap; "keepRemainder" (partial payment, transaction ' +
    'amount strictly below the forecast) realizes the paid part and keeps ' +
    'the balance as a new pending one-off entry. The user approves via ' +
    'in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    entryId: z.string(),
    transactionId: z.string(),
    mode: z.enum(['close', 'keepRemainder']).optional(),
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
        mode: input.mode,
      },
    )
  },
})

// ─── New internal mutations / tools ─────────────────────────────────────────

export const updateRuleInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    ruleId: v.id('forecastRules'),
    label: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    direction: v.optional(
      v.union(v.literal('in'), v.literal('out')),
    ),
    category: v.optional(v.string()),
    frequency: v.optional(
      v.union(
        v.literal('weekly'),
        v.literal('monthly'),
        v.literal('quarterly'),
        v.literal('yearly'),
      ),
    ),
    interval: v.optional(v.number()),
    anchorDay: v.optional(v.number()),
    startDateISO: v.optional(v.string()),
    endDateISO: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, actorUserId, ruleId, startDateISO, endDateISO, ...rest }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rule = await ctx.db.get('forecastRules', ruleId)
    if (!rule || rule.orgId !== orgId) throw new ConvexError('not_found')

    const patch: Record<string, unknown> = {}
    // Collect only defined fields.
    if (rest.label !== undefined) patch.label = rest.label
    if (rest.amountCents !== undefined) patch.amountCents = rest.amountCents
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.category !== undefined) patch.category = rest.category
    if (rest.frequency !== undefined) patch.frequency = rest.frequency
    if (rest.interval !== undefined) patch.interval = rest.interval
    if (rest.anchorDay !== undefined) patch.anchorDay = rest.anchorDay
    if (rest.active !== undefined) patch.active = rest.active
    if (startDateISO !== undefined) {
      patch.startDate = parseISODate(startDateISO, 'invalid_start_date')
    }
    if (endDateISO !== undefined) {
      patch.endDate = parseISODate(endDateISO, 'invalid_end_date')
    }

    // Validate merged state (amountCents must be positive integer).
    if (patch.amountCents !== undefined) {
      if (!Number.isInteger(patch.amountCents) || (patch.amountCents as number) <= 0) {
        throw new ConvexError('invalid_amount')
      }
    }

    await ctx.db.patch('forecastRules', ruleId, patch)
    return { _id: ruleId }
  },
})

export const deleteRuleInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    ruleId: v.id('forecastRules'),
  },
  handler: async (ctx, { orgId, actorUserId, ruleId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rule = await ctx.db.get('forecastRules', ruleId)
    if (!rule || rule.orgId !== orgId) throw new ConvexError('not_found')

    // Delete only pending, non-overridden derived entries (same logic as
    // forecasts:deleteRule). Realized/cancelled/overridden entries are
    // historical — preserve them.
    const entries = await ctx.db
      .query('forecastEntries')
      .withIndex('by_rule', (q) => q.eq('ruleId', ruleId))
      .collect()
    let entriesRemoved = 0
    for (const entry of entries) {
      if (entry.status === 'pending' && !entry.overridden) {
        await ctx.db.delete('forecastEntries', entry._id)
        entriesRemoved += 1
      }
    }
    await ctx.db.delete('forecastRules', ruleId)
    return { entriesRemoved }
  },
})

export const createManualEntryInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dateISO: v.string(),
    amountCents: v.number(),
    direction: v.union(v.literal('in'), v.literal('out')),
    confidence: v.union(
      v.literal('confirmed'),
      v.literal('expected'),
      v.literal('probable'),
    ),
    label: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, dateISO, ...rest }) => {
    await readMembership(ctx, orgId, actorUserId)
    if (!Number.isInteger(rest.amountCents) || rest.amountCents <= 0) {
      throw new ConvexError('invalid_amount')
    }
    const date = parseISODate(dateISO, 'invalid_date')
    const id = await ctx.db.insert('forecastEntries', {
      orgId,
      date,
      amountCents: rest.amountCents,
      direction: rest.direction,
      confidence: rest.confidence,
      status: 'pending',
      label: rest.label,
      category: rest.category,
      overridden: false,
      currency: 'EUR',
    })
    return { _id: id }
  },
})

export const updateEntryInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    entryId: v.id('forecastEntries'),
    dateISO: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    direction: v.optional(v.union(v.literal('in'), v.literal('out'))),
    confidence: v.optional(
      v.union(
        v.literal('confirmed'),
        v.literal('expected'),
        v.literal('probable'),
      ),
    ),
    label: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, entryId, dateISO, ...rest }) => {
    await readMembership(ctx, orgId, actorUserId)
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry || entry.orgId !== orgId) throw new ConvexError('not_found')
    if (
      rest.amountCents !== undefined &&
      (!Number.isInteger(rest.amountCents) || rest.amountCents <= 0)
    ) {
      throw new ConvexError('invalid_amount')
    }

    const patch: Record<string, unknown> = {}
    if (dateISO !== undefined) patch.date = parseISODate(dateISO, 'invalid_date')
    if (rest.amountCents !== undefined) patch.amountCents = rest.amountCents
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.confidence !== undefined) patch.confidence = rest.confidence
    if (rest.label !== undefined) patch.label = rest.label
    if (rest.category !== undefined) patch.category = rest.category
    // A derived entry edited manually becomes protected from re-expansion.
    if (entry.ruleId) patch.overridden = true

    await ctx.db.patch('forecastEntries', entry._id, patch)
    return { _id: entryId }
  },
})

export const cancelEntryInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    entryId: v.id('forecastEntries'),
  },
  handler: async (ctx, { orgId, actorUserId, entryId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const entry = await ctx.db.get('forecastEntries', entryId)
    if (!entry || entry.orgId !== orgId) throw new ConvexError('not_found')
    await ctx.db.patch('forecastEntries', entry._id, { status: 'cancelled' })
    return { _id: entryId, status: 'cancelled' as const }
  },
})

// ─── Exposed tools ───────────────────────────────────────────────────────────

const updateForecastRule = createTool({
  description:
    'Update fields of an existing forecast rule (label, amount, direction, ' +
    'category, frequency, interval, anchorDay, startDate, endDate, active). ' +
    'Only pass fields to change. IMPORTANT: updateRule does NOT regenerate ' +
    'already-expanded entries — call expandForecastRules afterwards to ' +
    'resync non-protected (pending, not overridden) occurrences with the ' +
    'new values. Realized/cancelled/manually-overridden entries are never ' +
    'affected. amountCents in CENTS EUR, dates as "YYYY-MM-DD". The user ' +
    'approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    ruleId: z.string(),
    label: z.string().min(1).optional(),
    amountCents: z.number().int().positive().optional().describe('cents EUR'),
    direction: z.enum(['in', 'out']).optional(),
    category: z.string().optional(),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
    interval: z.number().int().min(1).optional(),
    anchorDay: z.number().int().min(1).max(31).optional(),
    startDateISO: z.string().optional().describe('"YYYY-MM-DD"'),
    endDateISO: z.string().optional().describe('"YYYY-MM-DD"'),
    active: z.boolean().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.updateRuleInternal,
      {
        orgId,
        actorUserId: userId,
        ruleId: input.ruleId as Id<'forecastRules'>,
        label: input.label,
        amountCents: input.amountCents,
        direction: input.direction,
        category: input.category,
        frequency: input.frequency,
        interval: input.interval,
        anchorDay: input.anchorDay,
        startDateISO: input.startDateISO,
        endDateISO: input.endDateISO,
        active: input.active,
      },
    )
  },
})

const deleteForecastRule = createTool({
  description:
    'Delete a forecast rule and its pending, non-overridden derived entries. ' +
    'Realized, cancelled, or manually-overridden entries are preserved as ' +
    'history. This is one of the few delete operations available to the ' +
    'agent (rules are projections, not financial records). Use ' +
    'listForecastRules to find the ruleId. The user approves via in-app ' +
    'buttons.',
  needsApproval: true,
  inputSchema: z.object({
    ruleId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.deleteRuleInternal,
      {
        orgId,
        actorUserId: userId,
        ruleId: input.ruleId as Id<'forecastRules'>,
      },
    )
  },
})

const createManualForecastEntry = createTool({
  description:
    'Create a one-off (manual) forecast entry for a specific date, not ' +
    'linked to any rule. Use for exceptional cash flows (one-time tax ' +
    'payment, asset sale, etc.). amountCents in CENTS EUR (positive). ' +
    'confidence: "confirmed" (committed), "expected", or "probable". ' +
    'dateISO is "YYYY-MM-DD". The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    dateISO: z.string().describe('"YYYY-MM-DD"'),
    amountCents: z.number().int().positive().describe('cents EUR'),
    direction: z.enum(['in', 'out']),
    confidence: z.enum(['confirmed', 'expected', 'probable']),
    label: z.string().min(1),
    category: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.createManualEntryInternal,
      {
        orgId,
        actorUserId: userId,
        dateISO: input.dateISO,
        amountCents: input.amountCents,
        direction: input.direction,
        confidence: input.confidence,
        label: input.label,
        category: input.category,
      },
    )
  },
})

const updateForecastEntry = createTool({
  description:
    'Edit a forecast entry (date, amount, direction, confidence, label, ' +
    'category). If the entry was derived from a rule, it becomes ' +
    '"overridden" — expandForecastRules will no longer touch it. Only ' +
    'pass fields to change. amountCents in CENTS EUR, dateISO "YYYY-MM-DD". ' +
    'Use listForecastEntries to find the entryId. The user approves via ' +
    'in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    entryId: z.string(),
    dateISO: z.string().optional().describe('"YYYY-MM-DD"'),
    amountCents: z.number().int().positive().optional().describe('cents EUR'),
    direction: z.enum(['in', 'out']).optional(),
    confidence: z.enum(['confirmed', 'expected', 'probable']).optional(),
    label: z.string().min(1).optional(),
    category: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.updateEntryInternal,
      {
        orgId,
        actorUserId: userId,
        entryId: input.entryId as Id<'forecastEntries'>,
        dateISO: input.dateISO,
        amountCents: input.amountCents,
        direction: input.direction,
        confidence: input.confidence,
        label: input.label,
        category: input.category,
      },
    )
  },
})

const cancelForecastEntry = createTool({
  description:
    'Cancel a forecast entry: it will no longer count in the projected ' +
    'balance (status → "cancelled"). Idempotent if already cancelled. Use ' +
    'listForecastEntries to find the entryId. The user approves via in-app ' +
    'buttons.',
  needsApproval: true,
  inputSchema: z.object({
    entryId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsForecasts.cancelEntryInternal,
      {
        orgId,
        actorUserId: userId,
        entryId: input.entryId as Id<'forecastEntries'>,
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
  updateForecastRule,
  deleteForecastRule,
  createManualForecastEntry,
  updateForecastEntry,
  cancelForecastEntry,
}
