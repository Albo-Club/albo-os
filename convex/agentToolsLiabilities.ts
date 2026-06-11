/**
 * Agent tools for liabilities (equityPositions / intercompanyLoans), scoped
 * to the thread's org (convex/agentTools.ts pattern). Reads go through
 * `getLiabilitiesForOrg` (C/C balances derived from transactions); creations
 * are aligned with the public mutations in convex/liabilities.ts.
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { getLiabilitiesForOrg } from './liabilities'
import { applyDeallocate } from './lib/pointage'
import { parseScope, readMembership } from './lib/agentScope'
import { equityPositionType } from './schema'
import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

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

    // The thread's org is always one of the two parties (same
    // "not_a_party" rule as the public mutation, guaranteed by construction).
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

// ─── Tools exposed to the agent ─────────────────────────────────────────────

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
    "prime d'émission, augmentation de capital, report à nouveau). " +
    'amountCents in CENTS EUR (10 000 € → 1000000). holderLabel is a free ' +
    'label for the holder (optional). effectiveDateISO is "YYYY-MM-DD". ' +
    'The user approves via in-app buttons.',
  needsApproval: true,
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
    'The user approves via in-app buttons.',
  needsApproval: true,
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

async function getOrgTransaction(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  transactionId: Id<'transactions'>,
) {
  const tx = await ctx.db.get('transactions', transactionId)
  if (!tx || tx.orgId !== orgId) throw new ConvexError('not_found')
  return tx
}

export const updateEquityPositionInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    positionId: v.id('equityPositions'),
    holderLabel: v.optional(v.string()),
    type: equityPositionType,
    amountCents: v.number(),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, { orgId, actorUserId, positionId, ...patch }) => {
    await readMembership(ctx, orgId, actorUserId)
    const position = await ctx.db.get('equityPositions', positionId)
    if (!position || position.orgId !== orgId) throw new ConvexError('not_found')
    if (patch.amountCents <= 0) throw new ConvexError('invalid_amount')

    await ctx.db.patch('equityPositions', position._id, {
      holderLabel: patch.holderLabel?.trim() || undefined,
      type: patch.type,
      amountCents: patch.amountCents,
      shares: patch.shares,
      effectiveDate: patch.effectiveDate,
    })
    return { _id: positionId }
  },
})

export const updateIntercompanyLoanInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    loanId: v.id('intercompanyLoans'),
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, { orgId, actorUserId, loanId, interestRateBps, isBlocked, openedDate }) => {
    await readMembership(ctx, orgId, actorUserId)
    const loan = await ctx.db.get('intercompanyLoans', loanId)
    if (!loan) throw new ConvexError('not_found')
    // Verify the actor's org is a party to this loan.
    if (loan.fromOrgId !== orgId && loan.toOrgId !== orgId) {
      throw new ConvexError('not_a_party')
    }
    if (interestRateBps != null && interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }
    await ctx.db.patch('intercompanyLoans', loan._id, {
      interestRateBps,
      isBlocked,
      openedDate,
    })
    return { _id: loanId }
  },
})

export const deallocateTransactionInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.id('transactions'),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const tx = await getOrgTransaction(ctx, orgId, transactionId)
    await applyDeallocate(ctx, tx)
    return { _id: transactionId, matchStatus: 'unmatched' as const }
  },
})

// ─── Additional tools ────────────────────────────────────────────────────────

const updateEquityPosition = createTool({
  description:
    'Update an equity position of the current org: type, amountCents, ' +
    'holderLabel, shares, effectiveDate. All non-optional fields must be ' +
    'provided (the dialog pre-fills with current values). amountCents in ' +
    'CENTS EUR (positive integer). effectiveDateISO is "YYYY-MM-DD". ' +
    'Use listLiabilities to find the positionId. The user approves via ' +
    'in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    positionId: z.string().describe('equityPositions id'),
    type: z.enum(EQUITY_TYPES),
    amountCents: z.number().int().positive().describe('cents EUR'),
    holderLabel: z.string().optional().describe('Holder name (free label)'),
    shares: z.number().int().positive().optional(),
    effectiveDateISO: z.string().describe('"YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const effectiveDate = Date.parse(input.effectiveDateISO)
    if (Number.isNaN(effectiveDate)) throw new ConvexError('invalid_effective_date')
    return await ctx.runMutation(
      internal.agentToolsLiabilities.updateEquityPositionInternal,
      {
        orgId,
        actorUserId: userId,
        positionId: input.positionId as Id<'equityPositions'>,
        type: input.type,
        amountCents: input.amountCents,
        holderLabel: input.holderLabel,
        shares: input.shares,
        effectiveDate,
      },
    )
  },
})

const updateIntercompanyLoan = createTool({
  description:
    'Update an intercompany current account (C/C): interest rate, blocked ' +
    'status, and opened date. The creditor/debtor parties are NOT editable ' +
    '— to change counterparty, delete and recreate. interestRateBps in ' +
    'basis points (0 = non-interest-bearing; omit to clear). isBlocked and ' +
    'openedDateISO ("YYYY-MM-DD") are required. Use listLiabilities to find ' +
    'the loanId. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    loanId: z.string().describe('intercompanyLoans id'),
    interestRateBps: z.number().int().min(0).optional(),
    isBlocked: z.boolean(),
    openedDateISO: z.string().describe('"YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const openedDate = Date.parse(input.openedDateISO)
    if (Number.isNaN(openedDate)) throw new ConvexError('invalid_opened_date')
    return await ctx.runMutation(
      internal.agentToolsLiabilities.updateIntercompanyLoanInternal,
      {
        orgId,
        actorUserId: userId,
        loanId: input.loanId as Id<'intercompanyLoans'>,
        interestRateBps: input.interestRateBps,
        isBlocked: input.isBlocked,
        openedDate,
      },
    )
  },
})

const deallocateTransaction = createTool({
  description:
    'Detach a transaction from its liability allocation (equity position or ' +
    'intercompany loan): returns it to "unmatched" status. This is the ' +
    'liability-side symmetric of unpointTransaction. Only works on ' +
    'transactions allocated to a liability — for deal-matched transactions, ' +
    'use unpointTransaction. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    transactionId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsLiabilities.deallocateTransactionInternal,
      {
        orgId,
        actorUserId: userId,
        transactionId: input.transactionId as Id<'transactions'>,
      },
    )
  },
})

export const liabilityTools = {
  listLiabilities,
  createEquityPosition,
  createIntercompanyLoan,
  updateEquityPosition,
  updateIntercompanyLoan,
  deallocateTransaction,
}
