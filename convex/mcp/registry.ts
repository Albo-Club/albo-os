/**
 * Tool registry for the MCP server (convex/mcp/server.ts).
 *
 * Each tool is a thin wrapper over the same internals the AI agent tools use
 * (convex/agentTools*.ts) — membership is re-verified inside every internal
 * via `readMembership`, the registry only resolves the org slug and forwards
 * `{orgId, actorUserId}`.
 *
 * Most tools read. The four write tools at the bottom (createCompany,
 * updateCompany, createDeal, updateDeal) exist so an external client can fill
 * an entity from a free-form sentence without going through the in-app chat.
 * They write STRAIGHT to the DB: the chat agent's `needsApproval` round-trip
 * has no equivalent here, so the human checkpoint is the MCP client's own
 * confirmation — which is why every tool carries `annotations.readOnlyHint`.
 * Lookalike rows are reported back, never blocked (convex/lib/duplicates.ts).
 *
 * Schemas are declared here in zod v4 (the agent tools use `zod/v3` inline
 * schemas, which `z.toJSONSchema()` cannot consume). Keep the two in sync
 * when an internal's arguments change.
 */

import { ConvexError } from 'convex/values'
import { z } from 'zod'

import { internal } from '../_generated/api'
import { isTreasuryPlacement } from '../lib/instrumentMapping'
import { FUND_TYPES, INSTRUMENTS, ROUND_TYPES } from '../lib/instruments'
import { SECTOR_SLUGS } from '../lib/sectors'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * MCP tool annotations (spec 2025-06-18). `readOnlyHint` is what tells a
 * client the call mutates state, so it can ask the user before running it.
 */
export type McpToolAnnotations = {
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
}

export type McpTool = {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  annotations: McpToolAnnotations
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
  /** Set on the tools that mutate the DB — drives the annotations below. */
  write?: true
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
    // Writes only create or patch — nothing here ever deletes a row.
    annotations: def.write
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      : { readOnlyHint: true },
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

/** `undefined` stays `undefined` — an omitted field must not be patched. */
function optionalISODate(value: string | undefined): number | undefined {
  return value === undefined ? undefined : parseISODate(value)
}

const limitArg = z.number().int().min(1).max(50).optional()

// ─── Write helpers ──────────────────────────────────────────────────────────

/**
 * Deep link to a row in the app, so the user can check and correct what was
 * just written. Null when SITE_URL is unset (local/dev) — the write itself
 * still succeeds.
 */
function appUrl(slug: string, path: string): string | null {
  const base = process.env.SITE_URL
  return base ? `${base.replace(/\/+$/, '')}/app/${slug}/${path}` : null
}

function companyUrl(slug: string, companyId: string): string | null {
  return appUrl(slug, `participations/${companyId}`)
}

/** Treasury placements live on their own page, not the deal sheet. */
function dealUrl(
  slug: string,
  dealId: string,
  instrumentKind: string,
): string | null {
  const page = isTreasuryPlacement(instrumentKind) ? 'placements' : 'deals'
  return appUrl(slug, `${page}/${dealId}`)
}

const centsArg = (what: string) =>
  z.number().int().optional().describe(`${what} — CENTS EUR (50 000 € → 5000000)`)

const bpsArg = (what: string) =>
  z.number().int().optional().describe(`${what} — BASIS POINTS (11 % → 1100)`)

const isoDateArg = (what: string) =>
  z.string().optional().describe(`${what} — ISO date "YYYY-MM-DD"`)

/** Financial/lifecycle fields shared by createDeal and updateDeal. */
const dealValueSchema = {
  name: z
    .string()
    .optional()
    .describe('Custom deal label; omit to let the app derive it'),
  committedAmount: centsArg('Amount committed'),
  paidAmount: centsArg('Amount actually paid in'),
  sharesAcquired: z.number().optional().describe('Number of shares acquired'),
  pricePerShare: centsArg('Price per share'),
  roundType: z.enum(ROUND_TYPES).optional(),
  roundSize: centsArg('Total size of the round'),
  preMoneyValuation: centsArg('Pre-money valuation'),
  postMoneyValuation: centsArg('Post-money valuation'),
  entryValuation: centsArg('Valuation at entry'),
  ownershipPct: bpsArg('Ownership stake acquired'),
  valuationCap: centsArg('Valuation cap (SAFE / BSA AIR / convertible)'),
  discount: bpsArg('Conversion discount'),
  interestRate: bpsArg('Interest rate'),
  principalAmount: centsArg('Principal (bond, loan, current account)'),
  maturityDateISO: isoDateArg('Maturity date'),
  signedDateISO: isoDateArg('Signature date'),
  closingDateISO: isoDateArg('Closing date'),
  exitedDateISO: isoDateArg('Exit date'),
  exitProceeds: centsArg('Proceeds received on exit'),
  fundType: z.enum(FUND_TYPES).optional().describe('Fund LP commitments only'),
  vintageYear: z.number().int().optional().describe('Fund LP commitments only'),
  managementCompany: z
    .string()
    .optional()
    .describe('Fund LP commitments only — the management company'),
  notes: z.string().optional(),
}

/** Maps the ISO date args of `dealValueSchema` onto the internal's ms epochs. */
function dealValueArgs(args: {
  maturityDateISO?: string
  signedDateISO?: string
  closingDateISO?: string
  exitedDateISO?: string
}) {
  const {
    maturityDateISO,
    signedDateISO,
    closingDateISO,
    exitedDateISO,
    ...rest
  } = args
  return {
    ...rest,
    maturityDate: optionalISODate(maturityDateISO),
    signedDate: optionalISODate(signedDateISO),
    closingDate: optionalISODate(closingDateISO),
    exitedDate: optionalISODate(exitedDateISO),
  }
}

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
    name: 'getCompany',
    description:
      'Full profile of one company: legal identity (siren, legal form, ' +
      'country), sector, pitch and summary, share count, sponsor and ' +
      'portfolio group, target KPI keys, notes and people. Use listCompanies ' +
      'first if you do not know the company id.',
    schema: { org: orgSlug, companyId: z.string() },
    run: async (ctx, actorUserId, { org, companyId }) =>
      await ctx.runQuery(internal.agentTools.getCompanyInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        companyId: companyId as Id<'companies'>,
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
    name: 'listCompanyReports',
    description:
      'List the investor reports of a portfolio company (updates received by ' +
      'email and analysed by the pipeline), most recent period first. ' +
      'Returns the headline and period of each report, not its content — ' +
      'call getCompanyReport for that. Use listCompanies first if you do not ' +
      'know the company id.',
    schema: { org: orgSlug, companyId: z.string(), limit: limitArg },
    run: async (ctx, actorUserId, { org, companyId, limit }) =>
      await ctx.runQuery(internal.companyReports.listInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        companyId: companyId as Id<'companies'>,
        limit,
      }),
  }),
  defineTool({
    name: 'getCompanyReport',
    description:
      'Content of one investor report: headline, key highlights and the ' +
      'extracted metrics. Each metric carries its OWN unit — EUR_cents ' +
      '(divide by 100 for euros), bps (divide by 100 for percent), count or ' +
      'months — so read the unit field before stating a figure. Use ' +
      'listCompanyReports first to get a report id.',
    schema: { org: orgSlug, reportId: z.string() },
    run: async (ctx, actorUserId, { org, reportId }) =>
      await ctx.runQuery(internal.companyReports.getInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        reportId: reportId as Id<'companyReports'>,
      }),
  }),
  defineTool({
    name: 'getCompanyIntelligence',
    description:
      'The AI synthesis of a portfolio company, computed from its reports: ' +
      'executive summary, health score (1-10 with good/bad points), top ' +
      'insights and alerts. Returns null when no synthesis exists yet. ' +
      'latestReportId points at the report it was last refreshed from.',
    schema: { org: orgSlug, companyId: z.string() },
    run: async (ctx, actorUserId, { org, companyId }) =>
      await ctx.runQuery(internal.intelligence.getByCompanyInternal, {
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

  // ─── Write tools ──────────────────────────────────────────────────────────

  defineTool({
    name: 'createCompany',
    description:
      'Create a PORTFOLIO company (an invested target) in an org. Group ' +
      'entities of the vehicle (kind "group_*") are not created here — they ' +
      'are set up in the app. Fill every field you can infer from what the ' +
      'user told you; omit the rest rather than guessing. Amounts of shares ' +
      'are counts, not money. Returns the new company, a link to its page in ' +
      'the app, and `possibleDuplicates`: companies of the org that share the ' +
      'domain or the name — the creation is NOT blocked, report them to the ' +
      'user so they can decide to merge or rename. A SIREN already used by ' +
      'another company of the org is refused (error "siren_already_used").',
    schema: {
      org: orgSlug,
      name: z.string().min(1).describe('Commercial name, e.g. "Sezame"'),
      sector: z
        .enum(SECTOR_SLUGS)
        .optional()
        .describe('The market the company SELLS TO, never its legal vehicle'),
      domain: z.string().optional().describe('Website, e.g. "sezame.fr"'),
      countryCode: z.string().optional().describe('ISO-2, e.g. "FR"'),
      legalName: z.string().optional().describe('e.g. "Sezame SAS"'),
      siren: z.string().optional().describe('9 digits, French companies only'),
      legalForm: z.string().optional().describe('e.g. "SAS"'),
      totalShares: z.number().optional().describe('Total share count'),
      notes: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentTools.createCompanyInternal,
        { orgId, actorUserId, ...fields },
      )
      return {
        _id: created._id,
        name: created.name,
        url: companyUrl(org, created._id),
        possibleDuplicates: created.similar.map((match) => ({
          ...match,
          url: companyUrl(org, match._id),
        })),
      }
    },
  }),
  defineTool({
    name: 'updateCompany',
    description:
      'Complete or correct a company of an org. Only pass the fields to ' +
      'change — anything omitted is left untouched. Use listCompanies or ' +
      'getCompany first to get the id and to see what is already filled. ' +
      'Passing an empty string as `siren` clears it.',
    schema: {
      org: orgSlug,
      companyId: z.string(),
      name: z.string().min(1).optional(),
      sector: z
        .enum(SECTOR_SLUGS)
        .optional()
        .describe('The market the company SELLS TO, never its legal vehicle'),
      domain: z.string().optional(),
      countryCode: z.string().optional().describe('ISO-2, e.g. "FR"'),
      legalName: z.string().optional(),
      siren: z.string().optional().describe('9 digits, or "" to clear'),
      legalForm: z.string().optional(),
      totalShares: z.number().optional(),
      notes: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, companyId, ...patch }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const updated = await ctx.runMutation(
        internal.agentTools.updateCompanyInternal,
        { orgId, actorUserId, companyId: companyId as Id<'companies'>, ...patch },
      )
      return { _id: updated._id, url: companyUrl(org, updated._id) }
    },
  }),
  defineTool({
    name: 'createDeal',
    description:
      'Record an investment (deal) in an org. The investor MUST be a group ' +
      'entity of the vehicle (kind "group_*", e.g. Albo Club or CALTE) and ' +
      'the target a portfolio company — use listCompanies to resolve both ' +
      'ids, and createCompany first when the target does not exist yet. ' +
      'Amounts in CENTS EUR, rates in BASIS POINTS, dates as ISO ' +
      '"YYYY-MM-DD". Fill every field you can infer; omit the rest rather ' +
      'than guessing. Returns the deal, a link to its page in the app, and ' +
      '`possibleDuplicates`: existing deals between the same investor and ' +
      'the same target. That is a WARNING, not an error — a follow-on round ' +
      'is a legitimate second deal — so report them and let the user judge.',
    schema: {
      org: orgSlug,
      investorCompanyId: z
        .string()
        .describe('Group entity of the org doing the investing'),
      targetCompanyId: z.string().describe('The company invested in'),
      instrumentKind: z.enum(INSTRUMENTS),
      viaSpvCompanyId: z
        .string()
        .optional()
        .describe('SPV the investment goes through, when there is one'),
      status: z
        .enum(['pending', 'active', 'fully_exited', 'written_off'])
        .optional()
        .describe('Defaults to "active"; "pending" = signed but not wired'),
      ...dealValueSchema,
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, investorCompanyId, targetCompanyId, viaSpvCompanyId, ...fields },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const { instrumentKind, status, ...values } = fields
      const created = await ctx.runMutation(
        internal.agentTools.createDealInternal,
        {
          orgId,
          actorUserId,
          investorCompanyId: investorCompanyId as Id<'companies'>,
          targetCompanyId: targetCompanyId as Id<'companies'>,
          viaSpvCompanyId: viaSpvCompanyId as Id<'companies'> | undefined,
          instrumentKind,
          status,
          ...dealValueArgs(values),
        },
      )
      return {
        _id: created._id,
        url: dealUrl(org, created._id, instrumentKind),
        possibleDuplicates: created.similar.map((match) => ({
          ...match,
          url: dealUrl(org, match._id, match.instrumentKind),
        })),
      }
    },
  }),
  defineTool({
    name: 'updateDeal',
    description:
      'Complete or correct a deal of an org. Only pass the fields to change ' +
      '— anything omitted is left untouched. Use listDeals first to get the ' +
      'id. Amounts in CENTS EUR, rates in BASIS POINTS, dates as ISO ' +
      '"YYYY-MM-DD". To record an exit, set status plus exitedDateISO and ' +
      'exitProceeds.',
    schema: {
      org: orgSlug,
      dealId: z.string(),
      instrumentKind: z.enum(INSTRUMENTS).optional(),
      viaSpvCompanyId: z.string().optional(),
      status: z.enum(['active', 'fully_exited', 'written_off']).optional(),
      ...dealValueSchema,
    },
    write: true,
    run: async (ctx, actorUserId, { org, dealId, viaSpvCompanyId, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const { instrumentKind, status, ...values } = fields
      const updated = await ctx.runMutation(
        internal.agentTools.updateDealInternal,
        {
          orgId,
          actorUserId,
          dealId: dealId as Id<'deals'>,
          viaSpvCompanyId: viaSpvCompanyId as Id<'companies'> | undefined,
          instrumentKind,
          status,
          ...dealValueArgs(values),
        },
      )
      return {
        _id: updated._id,
        url: dealUrl(org, updated._id, updated.instrumentKind),
      }
    },
  }),
]
