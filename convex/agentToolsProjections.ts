/**
 * Outils agent du business plan (dealProjections) et des KPIs portfolio
 * (kpiSnapshots), scopés à l'org du thread (pattern convex/agentTools.ts).
 * C'est le canal de saisie AI-first du Lot 2 : coller un BP ou un reporting
 * dans le chat → l'agent structure les lignes/métriques.
 */

import { ConvexError } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { parseScope } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

function parseISODate(iso: string, code: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new ConvexError(code)
  return ms
}

const listDealProjections = createTool({
  description:
    'List the business plan lines of a deal: version "initial" (BP at ' +
    'closing, frozen) and "revised" (latest update). The ACTUALS are the ' +
    'transactions matched to the deal (listTransactions), never stored ' +
    'here. Amounts in CENTS EUR.',
  inputSchema: z.object({
    dealId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.projections.listInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
    })
  },
})

const setDealProjections = createTool({
  description:
    'REPLACE all business plan lines of one version ("initial" or ' +
    '"revised") of a deal. Use when the user provides a BP (e.g. pasted ' +
    'royalty schedule): one line per period with periodISO "YYYY-MM-DD" ' +
    '(period start), amountCents (positive, CENTS EUR) and direction "in" ' +
    '(expected returns) or "out" (expected deployment). This OVERWRITES the ' +
    'existing lines of that version — restate the full table and get user ' +
    'confirmation first. "initial" should be written once at closing; ' +
    'updates go to "revised".',
  inputSchema: z.object({
    dealId: z.string(),
    version: z.enum(['initial', 'revised']),
    lines: z
      .array(
        z.object({
          periodISO: z.string().describe('Period start, "YYYY-MM-DD"'),
          amountCents: z.number().int().positive(),
          direction: z.enum(['in', 'out']),
          notes: z.string().optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.projections.replaceVersionInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
      version: input.version,
      lines: input.lines.map((line) => ({
        period: parseISODate(line.periodISO, 'invalid_period'),
        amountCents: line.amountCents,
        direction: line.direction,
        notes: line.notes,
      })),
    })
  },
})

const listKpiSnapshots = createTool({
  description:
    'List the KPI history of a company (ARR, MRR, GMV, cash, headcount, ' +
    'and for funds: nav, tvpi, dpi…), most recent first. Optional ' +
    'metricType filter (lowercase).',
  inputSchema: z.object({
    companyId: z.string(),
    metricType: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.kpis.listInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
      metricType: input.metricType,
    })
  },
})

const createKpiSnapshot = createTool({
  description:
    'Record one KPI value for a company over a period (from a reporting / ' +
    'investor update the user shares). metricType lowercase ("arr", "mrr", ' +
    '"gmv", "cash", "headcount", "nav", "tvpi", "dpi"…). Monetary values in ' +
    'CENTS EUR with unit "EUR_cents"; ratios like tvpi/dpi in basis points ' +
    'with unit "bps" (1.45x → 14500); counts with unit "users"/"FTE". ' +
    'periodStartISO/periodEndISO "YYYY-MM-DD". source = where it comes from ' +
    '(e.g. "investor update Q1 2026"). Confirm with the user before calling.',
  inputSchema: z.object({
    companyId: z.string(),
    metricType: z.string().min(1),
    periodStartISO: z.string(),
    periodEndISO: z.string(),
    value: z.number(),
    unit: z.string().optional(),
    source: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.kpis.createInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
      metricType: input.metricType,
      periodStart: parseISODate(input.periodStartISO, 'invalid_start_date'),
      periodEnd: parseISODate(input.periodEndISO, 'invalid_end_date'),
      value: input.value,
      unit: input.unit,
      source: input.source,
    })
  },
})

export const projectionTools = {
  listDealProjections,
  setDealProjections,
  listKpiSnapshots,
  createKpiSnapshot,
}
