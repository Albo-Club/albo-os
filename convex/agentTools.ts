/**
 * Outils DB de l'agent chat, scopés à l'org du thread.
 *
 * La scope key du thread est `${orgId}:${userId}` (cf. chat.ts). L'action de
 * streaming n'a pas d'identité auth → chaque outil re-vérifie l'appartenance
 * via `actorUserId` passé aux internalQuery/internalMutation (readMembership).
 *
 * Montants : cents EUR (50 000 € → 5000000). Taux : bps (11 % → 1100).
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { parseScope, readMembership } from './lib/agentScope'
import { buildSearchText } from './lib/searchText'
import { INSTRUMENTS, instrumentValidator } from './lib/instruments'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

function companyName(c: Doc<'companies'> | null) {
  return c?.name ?? null
}

// ─── Internal queries / mutations (re-check membership) ─────────────────────

export const listCompaniesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return rows
      .filter((c) => !c.archivedAt)
      .map((c) => ({ _id: c._id, name: c.name, kind: c.kind }))
  },
})

export const listDealsInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return await Promise.all(
      rows.map(async (d) => ({
        _id: d._id,
        investor: companyName(await ctx.db.get("companies", d.investorCompanyId)),
        target: companyName(await ctx.db.get("companies", d.targetCompanyId)),
        viaSpv: d.viaSpvCompanyId
          ? companyName(await ctx.db.get("companies", d.viaSpvCompanyId))
          : null,
        instrumentKind: d.instrumentKind,
        committedAmount: d.committedAmount ?? null,
        paidAmount: d.paidAmount ?? null,
        status: d.status,
        signedDate: d.signedDate ?? null,
      })),
    )
  },
})

export const createCompanyInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    name: v.string(),
    sector: v.optional(v.string()),
    domain: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, name, sector, domain, countryCode }) => {
    await readMembership(ctx, orgId, actorUserId)
    const trimmed = name.trim()
    if (!trimmed) throw new ConvexError('invalid_name')
    // L'agent ne crée que des sociétés portfolio (jamais d'entités groupe).
    const id = await ctx.db.insert('companies', {
      orgId,
      name: trimmed,
      kind: 'portfolio',
      sector,
      domain,
      countryCode,
    })
    return { _id: id, name: trimmed }
  },
})

async function assertSameOrg(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  code: string,
) {
  const c = await ctx.db.get("companies", companyId)
  if (!c || c.orgId !== orgId) throw new ConvexError(code)
}

export const createDealInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    investorCompanyId: v.id('companies'),
    targetCompanyId: v.id('companies'),
    instrumentKind: instrumentValidator,
    viaSpvCompanyId: v.optional(v.id('companies')),
    committedAmount: v.optional(v.number()),
    paidAmount: v.optional(v.number()),
    interestRate: v.optional(v.number()),
    signedDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    await assertSameOrg(
      ctx,
      args.orgId,
      args.targetCompanyId,
      'target_wrong_org',
    )
    if (args.viaSpvCompanyId) {
      await assertSameOrg(ctx, args.orgId, args.viaSpvCompanyId, 'spv_wrong_org')
    }
    // L'investisseur doit être une entité du groupe (pas une portfolio).
    const investor = await ctx.db.get("companies", args.investorCompanyId)
    if (!investor || investor.orgId !== args.orgId) {
      throw new ConvexError('investor_wrong_org')
    }
    if (!investor.kind.startsWith('group_')) {
      throw new ConvexError('investor_must_be_group_entity')
    }
    const { actorUserId, ...rest } = args
    const id = await ctx.db.insert('deals', {
      ...rest,
      currency: 'EUR',
      status: 'active',
    })
    return { _id: id }
  },
})

export const listBankAccountsInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = await ctx.db
      .query('bankAccounts')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return rows
      .filter((a) => !a.archivedAt)
      .map((a) => ({ _id: a._id, label: a.label, bankName: a.bankName }))
  },
})

export const createBankAccountInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    ownerCompanyId: v.id('companies'),
    bankName: v.string(),
    label: v.string(),
    currency: v.optional(v.string()),
    accountKind: v.optional(v.string()),
    iban: v.optional(v.string()),
    currentBalance: v.optional(v.number()),
    balanceAsOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    // Le propriétaire d'un compte est toujours une entité du groupe.
    const owner = await ctx.db.get("companies", args.ownerCompanyId)
    if (!owner || owner.orgId !== args.orgId) {
      throw new ConvexError('owner_wrong_org')
    }
    if (!owner.kind.startsWith('group_')) {
      throw new ConvexError('owner_must_be_group_entity')
    }
    const id = await ctx.db.insert('bankAccounts', {
      orgId: args.orgId,
      ownerCompanyId: args.ownerCompanyId,
      bankName: args.bankName.trim(),
      label: args.label.trim(),
      currency: args.currency ?? 'EUR',
      accountKind: args.accountKind,
      iban: args.iban,
      currentBalance: args.currentBalance,
      balanceAsOf: args.balanceAsOf,
    })
    return { _id: id, label: args.label.trim() }
  },
})

export const listTransactionsInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
  },
  handler: async (ctx, { orgId, actorUserId, dealId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect()
    return rows
      .filter((t) => t.orgId === orgId)
      .map((t) => ({
        _id: t._id,
        direction: t.direction,
        amount: t.amount,
        transactionDate: t.transactionDate,
        rawLabel: t.rawLabel,
      }))
  },
})

export const createTransactionInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    bankAccountId: v.id('bankAccounts'),
    dealId: v.optional(v.id('deals')),
    direction: v.union(v.literal('in'), v.literal('out')),
    amount: v.number(),
    transactionDate: v.number(),
    rawLabel: v.string(),
    counterparty: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    if (!Number.isInteger(args.amount) || args.amount <= 0) {
      throw new ConvexError('invalid_amount')
    }
    const account = await ctx.db.get("bankAccounts", args.bankAccountId)
    if (!account || account.orgId !== args.orgId) {
      throw new ConvexError('account_wrong_org')
    }
    if (args.dealId) {
      const deal = await ctx.db.get("deals", args.dealId)
      if (!deal || deal.orgId !== args.orgId) {
        throw new ConvexError('deal_wrong_org')
      }
    }
    // Pointage : matched ⟺ dealId présent ; `reconciled` suit (miroir dérivé).
    const id = await ctx.db.insert('transactions', {
      orgId: args.orgId,
      bankAccountId: args.bankAccountId,
      dealId: args.dealId,
      matchStatus: args.dealId ? 'matched' : 'unmatched',
      direction: args.direction,
      amount: args.amount,
      transactionDate: args.transactionDate,
      rawLabel: args.rawLabel.trim(),
      counterparty: args.counterparty,
      searchText: buildSearchText(args.rawLabel.trim(), args.counterparty),
      source: 'manual',
      reconciled: args.dealId !== undefined,
      reconciledBy: args.dealId ? args.actorUserId : undefined,
      reconciledAt: args.dealId ? Date.now() : undefined,
    })
    return { _id: id }
  },
})

export const updateDealInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
    committedAmount: v.optional(v.number()),
    paidAmount: v.optional(v.number()),
    notes: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('partially_exited'),
        v.literal('fully_exited'),
        v.literal('written_off'),
      ),
    ),
  },
  handler: async (ctx, { orgId, actorUserId, dealId, ...patch }) => {
    await readMembership(ctx, orgId, actorUserId)
    const deal = await ctx.db.get("deals", dealId)
    if (!deal || deal.orgId !== orgId) throw new ConvexError('not_found')
    await ctx.db.patch("deals", dealId, patch)
    return { _id: dealId }
  },
})

// ─── Tools exposés à l'agent ────────────────────────────────────────────────

const listCompanies = createTool({
  description:
    'List companies in the current org (group entities + portfolio). Use ' +
    'this to find the investor company id (a group entity like CALTE or ' +
    'Albo Club) or to check whether a portfolio company already exists ' +
    'before creating a deal.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listCompaniesInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const listDeals = createTool({
  description:
    'List investments (deals) in the current org, with investor/target ' +
    'company names.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listDealsInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const createCompany = createTool({
  description:
    'Create a PORTFOLIO company (an invested startup/fund/asset). Never use ' +
    'this for group entities (CALTE, Albo Club, SCIs… already exist). Call ' +
    'listCompanies first to avoid duplicates. Returns the new company id.',
  inputSchema: z.object({
    name: z.string().min(1).describe('Company name, e.g. "Sezame"'),
    sector: z.string().optional(),
    domain: z.string().optional().describe('Website domain, e.g. sezame.io'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.agentTools.createCompanyInternal, {
      orgId,
      actorUserId: userId,
      name: input.name,
      sector: input.sector,
      domain: input.domain,
    })
  },
})

const createDeal = createTool({
  description:
    'Create an investment (deal) in the current org. The investor MUST be a ' +
    'group entity (CALTE, Albo Club, an SCI, a SPV…) — find its id via ' +
    'listCompanies. The target is the invested company — create it with ' +
    'createCompany first if needed. Amounts are in CENTS EUR (50 000 € → ' +
    '5000000). Rates in basis points (11% → 1100). signedDate is an ISO date ' +
    '"YYYY-MM-DD". For an SPV investment, pass viaSpvCompanyId. Confirm the ' +
    'details with the user before calling this.',
  inputSchema: z.object({
    investorCompanyId: z.string().describe('Group entity id (CALTE, Albo…)'),
    targetCompanyId: z.string().describe('Invested company id'),
    instrumentKind: z.enum(INSTRUMENTS),
    viaSpvCompanyId: z.string().optional().describe('SPV entity id, if via SPV'),
    committedAmount: z.number().int().optional().describe('cents EUR'),
    paidAmount: z.number().int().optional().describe('cents EUR'),
    interestRate: z.number().int().optional().describe('basis points'),
    signedDateISO: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const signedDate = input.signedDateISO
      ? Date.parse(input.signedDateISO)
      : undefined
    if (signedDate !== undefined && Number.isNaN(signedDate)) {
      throw new ConvexError('invalid_signed_date')
    }
    return await ctx.runMutation(internal.agentTools.createDealInternal, {
      orgId,
      actorUserId: userId,
      investorCompanyId: input.investorCompanyId as Id<'companies'>,
      targetCompanyId: input.targetCompanyId as Id<'companies'>,
      instrumentKind: input.instrumentKind,
      viaSpvCompanyId: input.viaSpvCompanyId
        ? (input.viaSpvCompanyId as Id<'companies'>)
        : undefined,
      committedAmount: input.committedAmount,
      paidAmount: input.paidAmount,
      interestRate: input.interestRate,
      signedDate,
      notes: input.notes,
    })
  },
})

const updateDeal = createTool({
  description:
    'Update an existing deal by id (amounts in cents, status, notes). Use ' +
    'listDeals first if you do not know the id. Confirm before calling.',
  inputSchema: z.object({
    dealId: z.string(),
    committedAmount: z.number().int().optional(),
    paidAmount: z.number().int().optional(),
    status: z
      .enum(['active', 'partially_exited', 'fully_exited', 'written_off'])
      .optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.agentTools.updateDealInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
      committedAmount: input.committedAmount,
      paidAmount: input.paidAmount,
      status: input.status,
      notes: input.notes,
    })
  },
})

const listBankAccounts = createTool({
  description:
    'List bank accounts in the current org (label + bank name). Use this to ' +
    'find the bankAccountId before creating a transaction, or to check ' +
    'whether an account already exists before creating one.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listBankAccountsInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const createBankAccount = createTool({
  description:
    'Create a bank account in the current org. The owner MUST be a group ' +
    'entity (CALTE, Albo Club, an SCI…) — find its id via listCompanies, ' +
    'never a portfolio company. Call listBankAccounts first to avoid ' +
    'duplicates. currentBalanceCents is the last known balance in CENTS EUR ' +
    '(12 000 € → 1200000); it is a manual field, not derived from ' +
    'transactions. balanceAsOfISO is the date that balance was observed ' +
    '("YYYY-MM-DD"). Returns the new account id.',
  inputSchema: z.object({
    ownerCompanyId: z.string().describe('Group entity id (CALTE, Albo…)'),
    bankName: z.string().min(1).describe('Bank name, e.g. "Qonto"'),
    label: z.string().min(1).describe('Account label, e.g. "Qonto CALTE"'),
    currency: z.string().optional().describe('ISO currency, defaults to EUR'),
    accountKind: z
      .string()
      .optional()
      .describe('checking, cto, dat, savings…'),
    iban: z.string().optional(),
    currentBalanceCents: z.number().int().optional().describe('cents EUR'),
    balanceAsOfISO: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const balanceAsOf = input.balanceAsOfISO
      ? Date.parse(input.balanceAsOfISO)
      : undefined
    if (balanceAsOf !== undefined && Number.isNaN(balanceAsOf)) {
      throw new ConvexError('invalid_balance_date')
    }
    return await ctx.runMutation(internal.agentTools.createBankAccountInternal, {
      orgId,
      actorUserId: userId,
      ownerCompanyId: input.ownerCompanyId as Id<'companies'>,
      bankName: input.bankName,
      label: input.label,
      currency: input.currency,
      accountKind: input.accountKind,
      iban: input.iban,
      currentBalance: input.currentBalanceCents,
      balanceAsOf,
    })
  },
})

const listTransactions = createTool({
  description:
    'List transactions linked to a given deal (by deal id). Use listDeals ' +
    'first if you do not know the deal id.',
  inputSchema: z.object({
    dealId: z.string().describe('Deal id'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listTransactionsInternal, {
      orgId,
      actorUserId: userId,
      dealId: input.dealId as Id<'deals'>,
    })
  },
})

const createTransaction = createTool({
  description:
    'Record a bank transaction, optionally linked to a deal. amount is in ' +
    'CENTS EUR (50 000 € → 5000000) and always positive. direction is "in" ' +
    '(money received) or "out" (money paid). Provide the bankAccountId ' +
    '(listBankAccounts, or createBankAccount first if none exists) and the ' +
    'dealId to link it. dateISO is "YYYY-MM-DD". Confirm with the user before ' +
    'calling this.',
  inputSchema: z.object({
    bankAccountId: z.string().describe('Bank account id'),
    dealId: z.string().optional().describe('Deal id to link the transaction'),
    direction: z.enum(['in', 'out']),
    amount: z.number().int().positive().describe('cents EUR, positive'),
    dateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    rawLabel: z.string().min(1).describe('Transaction label'),
    counterparty: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const transactionDate = Date.parse(input.dateISO)
    if (Number.isNaN(transactionDate)) {
      throw new ConvexError('invalid_transaction_date')
    }
    return await ctx.runMutation(internal.agentTools.createTransactionInternal, {
      orgId,
      actorUserId: userId,
      bankAccountId: input.bankAccountId as Id<'bankAccounts'>,
      dealId: input.dealId ? (input.dealId as Id<'deals'>) : undefined,
      direction: input.direction,
      amount: input.amount,
      transactionDate,
      rawLabel: input.rawLabel,
      counterparty: input.counterparty,
    })
  },
})

export const dealTools = {
  listCompanies,
  listDeals,
  createCompany,
  createDeal,
  updateDeal,
  listBankAccounts,
  createBankAccount,
  listTransactions,
  createTransaction,
}
