/**
 * Agent tools for the capital operations of a portfolio company, scoped to
 * the thread's org (convex/agentTools.ts pattern). The internals live in
 * convex/capitalEvents.ts (listInternal / createInternal / confirmInternal).
 * The MCP server exposes the same reads and the same write
 * (convex/mcp/registry.ts) — both facades together, by decision.
 */

import { ConvexError } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { parseScope } from './lib/agentScope'
import { CAPITAL_EVENT_KINDS } from './lib/capitalPosition'
import { ROUND_TYPES } from './lib/instruments'
import type { Id } from './_generated/dataModel'

const listCapitalEvents = createTool({
  description:
    'List the operations on the share capital of a portfolio company after ' +
    'our entry (rounds, BSA exercises, conversions, secondaries), oldest ' +
    'first, with their status: null = confirmed, "proposed" = read from a ' +
    'legal document and waiting for a human click. Our own entry round is ' +
    'NOT a row: it lives on the deal (getDeal). Use listCompanies first if ' +
    'you do not know the company id. Amounts in CENTS EUR.',
  inputSchema: z.object({ companyId: z.string() }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.capitalEvents.listInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
    })
  },
})

const addCapitalEvent = createTool({
  description:
    'Record a CONFIRMED operation on the share capital of a portfolio ' +
    'company: the next round, a BSA exercise, a conversion, a secondary, a ' +
    'capital reduction. Never our own entry round (that is the deal). ' +
    'pricePerShareCents in CENTS EUR (80 € → 8000), totalSharesAfter = ' +
    'shares outstanding after the operation; the post-money is derived. ' +
    'The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    companyId: z.string(),
    asOfISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    kind: z.enum(CAPITAL_EVENT_KINDS),
    pricePerShareCents: z.number().int().positive(),
    sharesIssued: z.number().int().nonnegative().optional(),
    totalSharesAfter: z.number().int().positive(),
    roundSizeCents: z.number().int().nonnegative().optional(),
    roundType: z.enum(ROUND_TYPES).optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const asOf = Date.parse(input.asOfISO)
    if (Number.isNaN(asOf)) throw new ConvexError('invalid_as_of_date')
    return await ctx.runMutation(internal.capitalEvents.createInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
      asOf,
      kind: input.kind,
      pricePerShare: input.pricePerShareCents,
      sharesIssued: input.sharesIssued,
      totalSharesAfter: input.totalSharesAfter,
      roundSize: input.roundSizeCents,
      roundType: input.roundType,
      notes: input.notes,
    })
  },
})

const confirmCapitalEvent = createTool({
  description:
    'Confirm a PROPOSED capital operation (status "proposed" in ' +
    'listCapitalEvents) so it counts in the company valuation. The user ' +
    'approves via in-app buttons. Refusing stays a gesture on the sheet.',
  needsApproval: true,
  inputSchema: z.object({ eventId: z.string() }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.capitalEvents.confirmInternal, {
      orgId,
      actorUserId: userId,
      eventId: input.eventId as Id<'capitalEvents'>,
    })
  },
})

export const capitalTools = {
  listCapitalEvents,
  addCapitalEvent,
  confirmCapitalEvent,
}
