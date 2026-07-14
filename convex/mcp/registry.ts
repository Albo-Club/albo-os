/**
 * Read-only tool registry for the MCP server (convex/mcp/server.ts).
 *
 * Each tool is a thin wrapper over the same internal queries the AI agent
 * tools use (convex/agentTools*.ts) — membership is re-verified inside every
 * internal via `readMembership`, the registry only resolves the org slug and
 * forwards `{orgId, actorUserId}`.
 *
 * Schemas are declared here in zod v4 (the agent tools use `zod/v3` inline
 * schemas, which `z.toJSONSchema()` cannot consume). Keep the two in sync
 * when an internal's arguments change.
 */

import { ConvexError } from 'convex/values'
import { z } from 'zod'

import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

export type McpTool = {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  /** Runs the tool. `args` are already validated against `inputSchema`. */
  run: (
    ctx: ActionCtx,
    actorUserId: Id<'users'>,
    args: unknown,
  ) => Promise<unknown>
}

/** Keeps `run` typed against the tool's own schema. */
function defineTool<TShape extends z.ZodRawShape>(def: {
  name: string
  description: string
  schema: TShape
  run: (
    ctx: ActionCtx,
    actorUserId: Id<'users'>,
    args: z.infer<z.ZodObject<TShape>>,
  ) => Promise<unknown>
}): McpTool {
  const inputSchema = z.object(def.schema)
  return {
    name: def.name,
    description: def.description,
    inputSchema,
    run: (ctx, actorUserId, args) =>
      def.run(ctx, actorUserId, args as z.infer<z.ZodObject<TShape>>),
  }
}

const orgSlug = z
  .string()
  .describe(
    'Organization slug (one investment vehicle = one organization). ' +
      'Use the listOrgs tool to discover the organizations you can access.',
  )

async function orgIdFor(
  ctx: ActionCtx,
  actorUserId: Id<'users'>,
  slug: string,
): Promise<Id<'organizations'>> {
  return await ctx.runQuery(internal.mcp.queries.resolveOrg, {
    slug: slug.trim().toLowerCase(),
    actorUserId,
  })
}

function parseISODate(value: string): number {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new ConvexError('invalid_iso_date')
  return ms
}

const limitArg = z.number().int().min(1).max(50).optional()

export const mcpTools: Array<McpTool> = [
  defineTool({
    name: 'listOrgs',
    description:
      'List the organizations (investment vehicles) the authenticated user ' +
      'belongs to, with their slug. Call this first to know which `org` ' +
      'values the other tools accept.',
    schema: {},
    run: async (ctx, actorUserId) =>
      await ctx.runQuery(internal.mcp.queries.listOrgsForUser, {
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listCompanies',
    description:
      'List companies in an org: group entities (kind "group_*", the legal ' +
      'entities of the vehicle) and portfolio companies (invested targets).',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentTools.listCompaniesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listDeals',
    description:
      'List investments (deals) in an org with investor, target, instrument ' +
      'and status. Amounts in CENTS EUR, rates in BASIS POINTS.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentTools.listDealsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listBankAccounts',
    description:
      'List bank accounts of an org with their balance. Amounts in CENTS EUR.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentTools.listBankAccountsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listTransactions',
    description:
      'List the bank transactions matched to a deal. Use listDeals first if ' +
      'you do not know the deal id. Amounts in CENTS EUR.',
    schema: { org: orgSlug, dealId: z.string() },
    run: async (ctx, actorUserId, { org, dealId }) =>
      await ctx.runQuery(internal.agentTools.listTransactionsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dealId: dealId as Id<'deals'>,
      }),
  }),
  defineTool({
    name: 'getDashboardSummary',
    description:
      'Portfolio overview of an org: deal counts, committed/deployed ' +
      'amounts, bank balances. Amounts in CENTS EUR.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentTools.getDashboardSummaryInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listCompanyDocuments',
    description:
      'List the documents attached to a company. Use listCompanies first if ' +
      'you do not know the company id.',
    schema: { org: orgSlug, companyId: z.string() },
    run: async (ctx, actorUserId, { org, companyId }) =>
      await ctx.runQuery(internal.agentTools.listCompanyDocumentsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        companyId: companyId as Id<'companies'>,
      }),
  }),
  defineTool({
    name: 'listUnmatchedTransactions',
    description:
      'List bank transactions awaiting reconciliation (pointage queue), most ' +
      'recent first. Optional text search on label/counterparty. Amounts in ' +
      'CENTS EUR.',
    schema: { org: orgSlug, search: z.string().optional(), limit: limitArg },
    run: async (ctx, actorUserId, { org, search, limit }) =>
      await ctx.runQuery(internal.agentToolsPointage.listUnmatchedInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        search,
        limit,
      }),
  }),
  defineTool({
    name: 'searchTransactions',
    description:
      'Search bank transactions of an org by text, reconciliation status ' +
      'and/or direction, with totals over the scanned set. Amounts in CENTS ' +
      'EUR.',
    schema: {
      org: orgSlug,
      search: z.string().optional(),
      matchStatus: z
        .enum([
          'unmatched',
          'matched',
          'ignored',
          'charge',
          'tax',
          'product',
          'internal_transfer',
        ])
        .optional(),
      direction: z.enum(['in', 'out']).optional(),
      limit: limitArg,
    },
    run: async (ctx, actorUserId, { org, search, matchStatus, direction, limit }) =>
      await ctx.runQuery(
        internal.agentToolsPointage.searchTransactionsInternal,
        {
          orgId: await orgIdFor(ctx, actorUserId, org),
          actorUserId,
          search,
          matchStatus,
          direction,
          limit,
        },
      ),
  }),
  defineTool({
    name: 'suggestMatches',
    description:
      'Suggest reconciliation candidates (deal, category…) for unmatched ' +
      'transactions, based on past decisions and similarity. Target a single ' +
      'transaction with transactionId, or the most recent unmatched ones.',
    schema: {
      org: orgSlug,
      transactionId: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    run: async (ctx, actorUserId, { org, transactionId, limit }) =>
      await ctx.runQuery(internal.agentToolsPointage.suggestMatchesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        transactionId: transactionId as Id<'transactions'> | undefined,
        limit,
      }),
  }),
  defineTool({
    name: 'getVatPosition',
    description:
      'Current VAT position of an org (deductible vs collected) derived from ' +
      'reconciled transactions. Amounts in CENTS EUR.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentToolsPointage.getVatPositionInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listLiabilities',
    description:
      'Liabilities of an org: equity positions (capital, who holds what) and ' +
      'intercompany loans with balances derived from transactions. Amounts ' +
      'in CENTS EUR, rates in BASIS POINTS.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(
        internal.agentToolsLiabilities.listLiabilitiesInternal,
        {
          orgId: await orgIdFor(ctx, actorUserId, org),
          actorUserId,
        },
      ),
  }),
  defineTool({
    name: 'listForecastRules',
    description:
      'List the cash-flow forecast rules of an org (recurring or one-shot ' +
      'expected movements). Amounts in CENTS EUR.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentToolsForecasts.listRulesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listForecastEntries',
    description:
      'List the expanded forecast entries of an org, optionally filtered by ' +
      'date range (ISO "YYYY-MM-DD") and status. Amounts in CENTS EUR.',
    schema: {
      org: orgSlug,
      dateFromISO: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
      dateToISO: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
      status: z.enum(['pending', 'realized', 'cancelled']).optional(),
      limit: limitArg,
    },
    run: async (ctx, actorUserId, { org, dateFromISO, dateToISO, status, limit }) =>
      await ctx.runQuery(internal.agentToolsForecasts.listEntriesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dateFrom: dateFromISO !== undefined ? parseISODate(dateFromISO) : undefined,
        dateTo: dateToISO !== undefined ? parseISODate(dateToISO) : undefined,
        status,
        limit,
      }),
  }),
  defineTool({
    name: 'getForecastBalance',
    description:
      'Projected month-by-month cash balance of an org over a horizon, ' +
      'same semantics as the app (available EUR accounts, current-month ' +
      'pending flows consumed by realized ones, overdue entries rolled ' +
      'into the current month). minConfidence "confirmed" = committed ' +
      'scenario only; otherwise planned flows are included. Amounts in ' +
      'CENTS EUR.',
    schema: {
      org: orgSlug,
      horizonMonths: z.number().int().min(1).max(36),
      minConfidence: z.enum(['confirmed', 'expected', 'probable']).optional(),
    },
    run: async (ctx, actorUserId, { org, horizonMonths, minConfidence }) =>
      await ctx.runQuery(
        internal.agentToolsForecasts.getForecastBalanceInternal,
        {
          orgId: await orgIdFor(ctx, actorUserId, org),
          actorUserId,
          horizonMonths,
          minConfidence,
        },
      ),
  }),
  defineTool({
    name: 'listValuations',
    description:
      'List the valuation history of a deal (fair value over time), most ' +
      'recent first. Use listDeals first if you do not know the deal id. ' +
      'Amounts in CENTS EUR.',
    schema: { org: orgSlug, dealId: z.string() },
    run: async (ctx, actorUserId, { org, dealId }) =>
      await ctx.runQuery(internal.valuations.listInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dealId: dealId as Id<'deals'>,
      }),
  }),
  defineTool({
    name: 'listKpiSnapshots',
    description:
      'List the KPI snapshots of a portfolio company (revenue, EBITDA…), ' +
      'optionally filtered by metric type. Use listCompanies first if you do ' +
      'not know the company id. Amounts in CENTS EUR.',
    schema: {
      org: orgSlug,
      companyId: z.string(),
      metricType: z.string().optional(),
    },
    run: async (ctx, actorUserId, { org, companyId, metricType }) =>
      await ctx.runQuery(internal.kpis.listInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        companyId: companyId as Id<'companies'>,
        metricType,
      }),
  }),
  defineTool({
    name: 'listDealProjections',
    description:
      'List the business-plan projections of a deal (projected metrics per ' +
      'year). Use listDeals first if you do not know the deal id. Amounts in ' +
      'CENTS EUR.',
    schema: { org: orgSlug, dealId: z.string() },
    run: async (ctx, actorUserId, { org, dealId }) =>
      await ctx.runQuery(internal.projections.listInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dealId: dealId as Id<'deals'>,
      }),
  }),
]
