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
import { resolveScope } from './lib/scope'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const INSTRUMENTS = [
  'share',
  'bsa',
  'bsa_air',
  'safe',
  'oc',
  'os',
  'convertible_note',
  'cca',
  'royalty',
  'fund_lp',
  'spv_share',
  'secondary',
  'real_estate_direct',
  'scpi',
  'cto',
  'dat',
  'crypto',
] as const

const instrumentValidator = v.union(
  v.literal('share'),
  v.literal('bsa'),
  v.literal('bsa_air'),
  v.literal('safe'),
  v.literal('oc'),
  v.literal('os'),
  v.literal('convertible_note'),
  v.literal('cca'),
  v.literal('royalty'),
  v.literal('fund_lp'),
  v.literal('spv_share'),
  v.literal('secondary'),
  v.literal('real_estate_direct'),
  v.literal('scpi'),
  v.literal('cto'),
  v.literal('dat'),
  v.literal('crypto'),
)

const scopeValidator = v.union(v.literal('albo'), v.literal('calte'))

function parseScope(scope: string | undefined | null): {
  orgId: Id<'organizations'>
  userId: Id<'users'>
} {
  if (!scope) throw new ConvexError('agent_tools_missing_scope')
  const idx = scope.indexOf(':')
  if (idx <= 0) throw new ConvexError('agent_tools_invalid_scope')
  return {
    orgId: scope.slice(0, idx) as Id<'organizations'>,
    userId: scope.slice(idx + 1) as Id<'users'>,
  }
}

async function readMembership(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
): Promise<Doc<'organizationMembers'>> {
  const member = await ctx.db
    .query('organizationMembers')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', userId),
    )
    .unique()
  if (!member) throw new ConvexError('agent_tools_forbidden')
  return member
}

function companyName(c: Doc<'companies'> | null) {
  return c?.name ?? null
}

// ─── Internal queries / mutations (re-check membership) ─────────────────────

export const listCompaniesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    scope: v.optional(scopeValidator),
  },
  handler: async (ctx, { orgId, actorUserId, scope }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = scope
      ? await ctx.db
          .query('companies')
          .withIndex('by_org_scope', (q) =>
            q.eq('orgId', orgId).eq('holdingScope', scope),
          )
          .collect()
      : await ctx.db
          .query('companies')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .collect()
    return rows
      .filter((c) => !c.archivedAt)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        kind: c.kind,
        holdingScope: c.holdingScope ?? null,
      }))
  },
})

export const listDealsInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    scope: v.optional(scopeValidator),
  },
  handler: async (ctx, { orgId, actorUserId, scope }) => {
    await readMembership(ctx, orgId, actorUserId)
    const rows = scope
      ? await ctx.db
          .query('deals')
          .withIndex('by_org_scope', (q) =>
            q.eq('orgId', orgId).eq('holdingScope', scope),
          )
          .collect()
      : await ctx.db
          .query('deals')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .collect()
    return await Promise.all(
      rows.map(async (d) => ({
        _id: d._id,
        investor: companyName(await ctx.db.get(d.investorCompanyId)),
        target: companyName(await ctx.db.get(d.targetCompanyId)),
        viaSpv: d.viaSpvCompanyId
          ? companyName(await ctx.db.get(d.viaSpvCompanyId))
          : null,
        instrumentKind: d.instrumentKind,
        holdingScope: d.holdingScope,
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
  const c = await ctx.db.get(companyId)
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
    const holdingScope = await resolveScope(ctx, args.investorCompanyId)
    const { actorUserId, ...rest } = args
    const id = await ctx.db.insert('deals', {
      ...rest,
      holdingScope,
      currency: 'EUR',
      status: 'active',
    })
    return { _id: id, holdingScope }
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
    const deal = await ctx.db.get(dealId)
    if (!deal || deal.orgId !== orgId) throw new ConvexError('not_found')
    await ctx.db.patch(dealId, patch)
    return { _id: dealId }
  },
})

// ─── Tools exposés à l'agent ────────────────────────────────────────────────

const listCompanies = createTool({
  description:
    'List companies in the current org (group entities + portfolio). ' +
    'Optionally filter by scope ("albo" or "calte"). Use this to find the ' +
    'investor company id (a group entity like CALTE or Albo Club) or to ' +
    'check whether a portfolio company already exists before creating a deal.',
  inputSchema: z.object({
    scope: z.enum(['albo', 'calte']).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listCompaniesInternal, {
      orgId,
      actorUserId: userId,
      scope: input.scope,
    })
  },
})

const listDeals = createTool({
  description:
    'List investments (deals) in the current org, with investor/target ' +
    'company names. Optionally filter by scope ("albo" or "calte").',
  inputSchema: z.object({
    scope: z.enum(['albo', 'calte']).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentTools.listDealsInternal, {
      orgId,
      actorUserId: userId,
      scope: input.scope,
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
    'Create an investment (deal). The investor MUST be a group entity ' +
    '(holdingScope albo/calte) — find its id via listCompanies. The target ' +
    'is the invested company — create it with createCompany first if needed. ' +
    'Amounts are in CENTS EUR (50 000 € → 5000000). Rates in basis points ' +
    '(11% → 1100). signedDate is an ISO date "YYYY-MM-DD". For an SPV ' +
    'investment, pass viaSpvCompanyId (the SPV is a group entity). The deal ' +
    "scope is derived from the investor automatically. Confirm the details " +
    'with the user before calling this.',
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

export const dealTools = {
  listCompanies,
  listDeals,
  createCompany,
  createDeal,
  updateDeal,
}
