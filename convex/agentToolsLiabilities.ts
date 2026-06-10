/**
 * Outils agent du passif (equityPositions / intercompanyLoans), scopés à
 * l'org du thread (pattern convex/agentTools.ts). Lecture via
 * `getLiabilitiesForOrg` (soldes C/C dérivés des transactions) ; créations
 * alignées sur les mutations publiques de convex/liabilities.ts.
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { getLiabilitiesForOrg } from './liabilities'
import { parseScope, readMembership } from './lib/agentScope'
import { equityPositionType } from './schema'

const EQUITY_TYPES = [
  'capital_social',
  'prime_emission',
  'augmentation_capital',
  'report_a_nouveau',
] as const

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function parseISODate(iso: string, code: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new ConvexError(code)
  return ms
}

// ─── Internal queries / mutations (re-check membership) ─────────────────────

export const listLiabilitiesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const { equityPositions, loans } = await getLiabilitiesForOrg(ctx, orgId)
    return {
      equityPositions: equityPositions.map((position) => ({
        _id: position._id,
        type: position.type,
        holderName: position.holderName,
        amountCents: position.amountCents,
        effectiveDateISO: toISODate(position.effectiveDate),
        allocatedTransactions: position.transactions.length,
      })),
      loans: loans.map((loan) => ({
        _id: loan._id,
        counterpartyName: loan.counterpartyName,
        side: loan.side,
        balanceCents: loan.balanceCents,
        interestRateBps: loan.interestRateBps ?? 0,
        isBlocked: loan.isBlocked,
        allocatedTransactions: loan.transactions.length,
      })),
    }
  },
})

export const createEquityPositionInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    type: equityPositionType,
    amountCents: v.number(),
    holderLabel: v.optional(v.string()),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      throw new ConvexError('invalid_amount')
    }
    const id = await ctx.db.insert('equityPositions', {
      orgId: args.orgId,
      holderLabel: args.holderLabel?.trim() || undefined,
      type: args.type,
      amountCents: args.amountCents,
      shares: args.shares,
      effectiveDate: args.effectiveDate,
    })
    return { _id: id }
  },
})

export const createIntercompanyLoanInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    role: v.union(v.literal('creditor'), v.literal('debtor')),
    counterpartyOrgSlug: v.string(),
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)

    const counterparty = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.counterpartyOrgSlug))
      .unique()
    if (!counterparty) throw new ConvexError('counterparty_not_found')
    if (counterparty._id === args.orgId) throw new ConvexError('same_org')

    if (args.interestRateBps != null && args.interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }

    // L'org du thread est toujours l'une des deux parties (même règle
    // « not_a_party » que la mutation publique, garantie par construction).
    const fromOrgId = args.role === 'creditor' ? args.orgId : counterparty._id
    const toOrgId = args.role === 'creditor' ? counterparty._id : args.orgId

    const id = await ctx.db.insert('intercompanyLoans', {
      fromOrgId,
      toOrgId,
      interestRateBps: args.interestRateBps,
      isBlocked: args.isBlocked,
      openedDate: args.openedDate,
    })
    return { _id: id }
  },
})

// ─── Tools exposés à l'agent ────────────────────────────────────────────────

const listLiabilities = createTool({
  description:
    'List the liabilities of the current org: equity positions (issued ' +
    'capital) and intercompany current accounts (C/C). Loan balances are ' +
    'DERIVED from allocated transactions (positive = receivable, negative ' +
    '= debt). Use this to find target ids for ' +
    'allocateTransactionToLiability. Amounts in CENTS EUR, rates in basis ' +
    'points.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsLiabilities.listLiabilitiesInternal,
      { orgId, actorUserId: userId },
    )
  },
})

const createEquityPosition = createTool({
  description:
    'Create an equity position issued by the current org (capital social, ' +
    'prime d’émission, augmentation de capital, report à nouveau). ' +
    'amountCents in CENTS EUR (10 000 € → 1000000). holderLabel is a free ' +
    'label for the holder (optional). effectiveDateISO is "YYYY-MM-DD". ' +
    'Confirm with the user before calling.',
  inputSchema: z.object({
    type: z.enum(EQUITY_TYPES),
    amountCents: z.number().int().positive().describe('cents EUR'),
    holderLabel: z.string().optional().describe('Holder name (free label)'),
    shares: z.number().int().positive().optional(),
    effectiveDateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsLiabilities.createEquityPositionInternal,
      {
        orgId,
        actorUserId: userId,
        type: input.type,
        amountCents: input.amountCents,
        holderLabel: input.holderLabel,
        shares: input.shares,
        effectiveDate: parseISODate(
          input.effectiveDateISO,
          'invalid_effective_date',
        ),
      },
    )
  },
})

const createIntercompanyLoan = createTool({
  description:
    'Create an intercompany current account (C/C) between the current org ' +
    'and another org of the group, identified by its slug (e.g. "calte", ' +
    '"albo"). role is the position of the CURRENT org: "creditor" (it lends) ' +
    'or "debtor" (it borrows). interestRateBps in basis points (11% → 1100), ' +
    'omit for 0. The balance is derived later from allocated transactions. ' +
    'Confirm with the user before calling.',
  inputSchema: z.object({
    role: z.enum(['creditor', 'debtor']),
    counterpartyOrgSlug: z.string().describe('Slug of the other org'),
    interestRateBps: z.number().int().min(0).optional(),
    isBlocked: z.boolean().optional().describe('Blocked C/C, default false'),
    openedDateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsLiabilities.createIntercompanyLoanInternal,
      {
        orgId,
        actorUserId: userId,
        role: input.role,
        counterpartyOrgSlug: input.counterpartyOrgSlug,
        interestRateBps: input.interestRateBps,
        isBlocked: input.isBlocked ?? false,
        openedDate: parseISODate(input.openedDateISO, 'invalid_opened_date'),
      },
    )
  },
})

export const liabilityTools = {
  listLiabilities,
  createEquityPosition,
  createIntercompanyLoan,
}
