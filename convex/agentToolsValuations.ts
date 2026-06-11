/**
 * Agent tools for deal valuations, scoped to the thread's org
 * (convex/agentTools.ts pattern). The internals live in
 * convex/valuations.ts (listInternal / createInternal).
 */

import { ConvexError } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { parseScope } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

const listValuations = createTool({
  description:
    'List the valuation history of a deal (fair value over time), most ' +
    'recent first. Use listDeals first if you do not know the deal id. ' +
    'Amounts in CENTS EUR.',
  inputSchema: z.object({
    dealId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.valuations.listInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
    })
  },
})

const createValuation = createTool({
  description:
    'Record a new valuation (fair value) for a deal. fairValueCents in ' +
    'CENTS EUR (1 200 000 € → 120000000), asOfISO is the valuation date ' +
    '"YYYY-MM-DD". valuationMethod e.g. "last_round", "mark_to_market", ' +
    '"reported_nav". Confirm with the user before calling.',
  inputSchema: z.object({
    dealId: z.string(),
    asOfISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    fairValueCents: z.number().int().positive().describe('cents EUR'),
    valuationMethod: z.string().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const asOf = Date.parse(input.asOfISO)
    if (Number.isNaN(asOf)) throw new ConvexError('invalid_as_of_date')
    return await ctx.runMutation(internal.valuations.createInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
      asOf,
      fairValue: input.fairValueCents,
      valuationMethod: input.valuationMethod,
      source: input.source,
      notes: input.notes,
    })
  },
})

export const valuationTools = {
  listValuations,
  createValuation,
}
