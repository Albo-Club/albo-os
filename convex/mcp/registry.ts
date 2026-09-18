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
import {
  getProductDoc,
  productDocs,
  searchProductDocs,
} from '../lib/productDocs'
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
  z
    .number()
    .int()
    .optional()
    .describe(`${what} — CENTS EUR (50 000 € → 5000000)`)

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
  // The two tools below take no `org`, like listOrgs: they read the product
  // documentation (docs/produit, bundled at install by
  // scripts/gen-product-docs.mjs), a build-time constant identical for every
  // org. orgAwareSchema (server.ts) tolerates the missing property.
  defineTool({
    name: 'searchProductDocs',
    description:
      'Keyword search in the PRODUCT DOCUMENTATION of Albo OS — how the app ' +
      'itself works (features, workflows, rules, what a screen does). Use ' +
      'it for "how do I…" questions about the app; NOT for the content of ' +
      "the org's own documents, which is searchDocuments. Accents are " +
      'optional. Returns pages ranked by relevance with the nearest ' +
      'heading and an excerpt; read the full page with getProductDoc.',
    schema: {
      query: z.string().describe('Keywords, French or English'),
      limit: z.number().int().min(1).max(20).optional(),
    },
    run: (_ctx, _actorUserId, { query, limit }) =>
      Promise.resolve({ results: searchProductDocs(query, limit) }),
  }),
  defineTool({
    name: 'getProductDoc',
    description:
      'Read one page of the product documentation of Albo OS in full ' +
      '(markdown, in French), by slug — slugs come from searchProductDocs. ' +
      'An unknown slug returns the list of available ones.',
    schema: { slug: z.string().describe('Page slug, e.g. "08-pointage"') },
    run: (_ctx, _actorUserId, { slug }) => {
      const doc = getProductDoc(slug)
      return Promise.resolve(
        doc
          ? { slug: doc.slug, title: doc.title, markdown: doc.markdown }
          : {
              error: 'unknown_slug',
              availableSlugs: productDocs.map((page) => page.slug),
            },
      )
    },
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
      'List investments (deals) in an org with investor, target, instrument, ' +
      'status, realized figures and ownershipPct (the stake recorded on the ' +
      'deal). Amounts in CENTS EUR, rates in BASIS POINTS. Use getDeal for ' +
      'the full sheet of one deal — it is also where the stake in a group ' +
      'subsidiary is read from the subsidiary cap table.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentTools.listDealsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'getDeal',
    description:
      'Full sheet of one deal: every instrument field (shares, price per ' +
      'share, round type and pre/post-money, interest rate, maturity, ' +
      'principal, valuation cap and discount, SPV stake, fund terms, ' +
      'warrants, real-estate and placement fields…), names of investor / ' +
      'target / SPV, realized figures, and `ownership`: the stake the org ' +
      'holds through this deal in BASIS POINTS, with its source — the ' +
      'subsidiary cap table ("cap_table"), the stake recorded on the deal ' +
      '("deal"), or the ratio of shares acquired to the company share ' +
      'count ("share_ratio"). Use listDeals first if you do not know the ' +
      'deal id. Amounts in CENTS EUR, dates in ms epoch.',
    schema: { org: orgSlug, dealId: z.string() },
    run: async (ctx, actorUserId, { org, dealId }) =>
      await ctx.runQuery(internal.agentTools.getDealInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dealId: dealId as Id<'deals'>,
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
      'List the documents attached to a company: legal paperwork (pacte ' +
      "d'actionnaires, statuts, bulletin de souscription, PV d'assemblée, " +
      'term sheet, attestation), business plans, annual accounts and ' +
      'reportings. Metadata only — call getDocumentText to read one, or ' +
      'searchDocuments to find a passage across the whole org. `ocrState` ' +
      'says whether the file was read: only "extracted" has a text. Use ' +
      'listCompanies first if you do not know the company id.',
    schema: { org: orgSlug, companyId: z.string() },
    run: async (ctx, actorUserId, { org, companyId }) =>
      await ctx.runQuery(internal.agentTools.listCompanyDocumentsInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        companyId: companyId as Id<'companies'>,
      }),
  }),
  defineTool({
    name: 'searchDocuments',
    description:
      "Semantic search across the org's documents (pactes d'actionnaires, " +
      "statuts, bulletins de souscription, PV d'assemblée, term sheets, " +
      'comptes annuels, business plans) and investor reports. Finds ' +
      'passages by MEANING, not keywords — query in natural language, ' +
      'French or English, e.g. "clause de liquidité du pacte Sezame" or ' +
      '"droit de préemption". Optionally restrict to one company with ' +
      'companyId (from listCompanies). Returns scored excerpts with the ' +
      'title of the source document — cite it when answering, and call ' +
      'getDocumentText when an excerpt is not enough.',
    schema: {
      org: orgSlug,
      query: z.string().describe('Natural-language search query'),
      companyId: z.string().optional().describe('Restrict to one company'),
      limit: z.number().int().min(1).max(30).optional(),
    },
    run: async (ctx, actorUserId, { org, query, companyId, limit }) =>
      await ctx.runAction(internal.vectorize.searchInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        query,
        companyId: companyId as Id<'companies'> | undefined,
        limit,
      }),
  }),
  defineTool({
    name: 'getDocumentText',
    description:
      'Read the full text extracted from one document (pacte, statuts, ' +
      'bulletin de souscription, PV, comptes annuels, BP…). Use ' +
      'listCompanyDocuments or searchDocuments first to get a document id. ' +
      'The text comes in windows of 40 000 characters: when `nextOffset` is ' +
      'not null, call again with `offset: nextOffset` for the rest. `text` ' +
      'is null when the file was never read (see `ocrState`/`ocrDetail`), ' +
      'and `truncated: true` means the file was cut at extraction time — ' +
      'its tail was never stored.',
    schema: {
      org: orgSlug,
      documentId: z.string(),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Character offset to read from — the previous nextOffset'),
    },
    run: async (ctx, actorUserId, { org, documentId, offset }) =>
      await ctx.runQuery(internal.agentTools.getDocumentTextInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        documentId: documentId as Id<'documents'>,
        offset,
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
      'latestReportId points at the report it was last refreshed from; ' +
      'scoreEvolution gives the previous score (null on a first score).',
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
    run: async (
      ctx,
      actorUserId,
      { org, search, matchStatus, direction, limit },
    ) =>
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
      'Liabilities of an org: equity positions (capital, who holds what and ' +
      'their ownershipBps share — the cap table of the org) and ' +
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
    name: 'listLoans',
    description:
      'Bank loans of an org with the CAPITAL OUTSTANDING of each. The ' +
      'outstanding is DERIVED from the computed amortization schedule, never ' +
      'stored — except on a revolving credit, whose principalCents IS the ' +
      'drawn amount. Amounts in CENTS EUR, rates in BASIS POINTS ' +
      '(185 = 1.85 %).',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentToolsDebt.listLoansInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'listGuarantees',
    description:
      'Securities of an org, read from any of the three sides they link: the ' +
      'loan they cover, the asset they bite on, the guarantor who commits. ' +
      'An unquantified guarantee (an unlimited caution) is excluded from the ' +
      'pledged total and counted apart — never report it as 0.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentToolsDebt.listGuaranteesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
  }),
  defineTool({
    name: 'getLoanSchedule',
    description:
      'Amortization schedule of one loan, windowed around today: date, ' +
      'instalment, capital, interest, insurance, outstanding after payment, ' +
      'and the ACTUAL amount debited in that instalment period. The plan is ' +
      'the source of the outstanding; the actual is a control — a divergence ' +
      'means an incomplete matching or an unrecorded event, not a bug. On a ' +
      'variable-rate loan, instalments past the last actual revision are ' +
      'flagged `projected`: the rate is unknown, not predicted. Find ids via ' +
      'listLoans.',
    schema: {
      org: orgSlug,
      loanId: z.string().describe('Loan id from listLoans'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Instalments to return around today (default 12, max 60)'),
    },
    run: async (ctx, actorUserId, { org, loanId, limit }) =>
      await ctx.runQuery(internal.agentToolsDebt.getLoanScheduleInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        loanId: loanId as Id<'loans'>,
        limit,
      }),
  }),
  defineTool({
    name: 'getPledgesOnDeal',
    description:
      'What a placement secures in total, and how much room is left: its ' +
      'current value, the total pledged on it, and the available margin. The ' +
      'list includes the pledges benefiting ANOTHER group company or an ' +
      'outside borrower — leaving those out is exactly how the margin gets ' +
      'overstated. The margin is deliberately pessimistic: a pledged amount ' +
      'is worth its deed amount until the release, whatever is left of the ' +
      'debt. A negative margin is information, not an error.',
    schema: {
      org: orgSlug,
      dealId: z.string().describe('Deal id of the pledged placement'),
    },
    run: async (ctx, actorUserId, { org, dealId }) =>
      await ctx.runQuery(internal.agentToolsDebt.getPledgesOnDealInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dealId: dealId as Id<'deals'>,
      }),
  }),
  defineTool({
    name: 'listProperties',
    description:
      'Real-estate properties of an org with their COST PRICE line item by ' +
      'line item and the source of each (an entered amount OR the matched ' +
      'flows — never both added together), the last known value, the latent ' +
      'gain and the net yield. All derived on every read. Amounts in CENTS ' +
      'EUR, TAX-INCLUSIVE.',
    schema: { org: orgSlug },
    run: async (ctx, actorUserId, { org }) =>
      await ctx.runQuery(internal.agentToolsDebt.listPropertiesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
      }),
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
    run: async (
      ctx,
      actorUserId,
      { org, dateFromISO, dateToISO, status, limit },
    ) =>
      await ctx.runQuery(internal.agentToolsForecasts.listEntriesInternal, {
        orgId: await orgIdFor(ctx, actorUserId, org),
        actorUserId,
        dateFrom:
          dateFromISO !== undefined ? parseISODate(dateFromISO) : undefined,
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
      incorporationDateISO: isoDateArg('Incorporation date'),
      notes: z.string().optional(),
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, companyId, incorporationDateISO, ...patch },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const updated = await ctx.runMutation(
        internal.agentTools.updateCompanyInternal,
        {
          orgId,
          actorUserId,
          companyId: companyId as Id<'companies'>,
          incorporationDate: optionalISODate(incorporationDateISO),
          ...patch,
        },
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
        .enum(['pending', 'active', 'fully_exited', 'written_off', 'cancelled'])
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
      'exitProceeds. "cancelled" = deal called off after the funds were wired ' +
      'and refunded (neither an exit nor a write-off). To record a conversion ' +
      '(BSA AIR or convertible turning into shares), change instrumentKind on ' +
      'the SAME deal — never create a second one — and pass convertedAtISO; ' +
      'the app then shows the before/after of the deal.',
    schema: {
      org: orgSlug,
      dealId: z.string(),
      instrumentKind: z.enum(INSTRUMENTS).optional(),
      convertedAtISO: isoDateArg(
        'Date of the conversion — only with a new instrumentKind',
      ),
      viaSpvCompanyId: z.string().optional(),
      status: z
        .enum(['active', 'fully_exited', 'written_off', 'cancelled'])
        .optional(),
      ...dealValueSchema,
      spvOwnershipPct: bpsArg('Stake held in the SPV — spv_share deals only'),
      attioDealId: z
        .string()
        .optional()
        .describe('Attio deal record id (the CRM bridge); "" clears it'),
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, dealId, viaSpvCompanyId, ...fields },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const { instrumentKind, convertedAtISO, status, ...values } = fields
      const updated = await ctx.runMutation(
        internal.agentTools.updateDealInternal,
        {
          orgId,
          actorUserId,
          dealId: dealId as Id<'deals'>,
          viaSpvCompanyId: viaSpvCompanyId as Id<'companies'> | undefined,
          instrumentKind,
          convertedAt: optionalISODate(convertedAtISO),
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
  defineTool({
    name: 'createLoan',
    description:
      'Create a BANK loan for an org. Enter the TERMS OF THE CONTRACT only — ' +
      'never the capital outstanding, which is computed from them. ' +
      'amortizationKind drives everything: "constant_annuity" (fixed ' +
      'instalment), "constant_capital" (fixed capital slice), "bullet" (in ' +
      'fine: interest only then the whole capital at the end), "revolving" ' +
      '(lombard: no schedule, and principalCents is then the CURRENT DRAWN ' +
      'AMOUNT). durationMonths is the TOTAL duration, deferral included, and ' +
      'is required except on a revolving. Amounts in CENTS EUR, rates in ' +
      'BASIS POINTS. Dates are "YYYY-MM-DD".',
    schema: {
      org: orgSlug,
      label: z.string().min(1).describe('e.g. "Prêt Palatine 2021"'),
      lenderName: z.string().min(1).describe('e.g. "Banque Palatine"'),
      principalCents: z.number().int().positive().describe('cents EUR'),
      signedDate: z.string().describe('ISO date "YYYY-MM-DD"'),
      firstPaymentDate: z.string().describe('ISO date of the 1st instalment'),
      durationMonths: z.number().int().positive().optional(),
      amortizationKind: z.enum([
        'constant_annuity',
        'constant_capital',
        'bullet',
        'revolving',
      ]),
      creditLimitCents: z.number().int().positive().optional(),
      rateBps: z.number().int().min(0).describe('basis points at signature'),
      rateKind: z.enum(['fixed', 'variable']),
      insuranceMonthlyCents: z.number().int().min(0).optional(),
      paymentFrequency: z.enum(['monthly', 'quarterly']),
      deferralMonths: z.number().int().min(0).optional(),
      deferralKind: z.enum(['partial', 'total']).optional(),
      notes: z.string().optional(),
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, signedDate, firstPaymentDate, ...fields },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.createLoanInternal,
        {
          orgId,
          actorUserId,
          ...fields,
          signedDate: parseISODate(signedDate),
          firstPaymentDate: parseISODate(firstPaymentDate),
        },
      )
      return { _id: created._id, url: appUrl(org, 'passif') }
    },
  }),
  defineTool({
    name: 'createProperty',
    description:
      'Create a real-estate property held by an org. The three cost line ' +
      'items start as ENTERED amounts — nothing is matched to a brand-new ' +
      'property, so reading them from the flows would give zero. Rents, ' +
      'charges, yield and latent gain are NEVER entered: they come from ' +
      'matched transactions and valuations. usage "marchand_de_biens" means ' +
      'held for resale. Amounts in CENTS EUR, all TAX-INCLUSIVE.',
    schema: {
      org: orgSlug,
      name: z.string().min(1).describe('e.g. "18 rue de la Chapelle"'),
      address: z.string(),
      propertyType: z.enum([
        'appartement',
        'maison',
        'immeuble',
        'local_commercial',
        'terrain',
      ]),
      usage: z.enum([
        'locatif_nu',
        'locatif_meuble',
        'colocation',
        'saisonnier',
        'commercial',
        'marchand_de_biens',
        'residence_secondaire',
      ]),
      surfaceSqm: z.number().positive().optional(),
      acquiredDate: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
      acquisitionCents: z.number().int().min(0).optional(),
      acquisitionFeesCents: z.number().int().min(0).optional(),
      worksCents: z.number().int().min(0).optional(),
      notes: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, acquiredDate, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.createPropertyInternal,
        {
          orgId,
          actorUserId,
          ...fields,
          acquiredDate: optionalISODate(acquiredDate),
        },
      )
      return { _id: created._id, url: appUrl(org, 'immobilier') }
    },
  }),
  defineTool({
    name: 'addPropertyValuation',
    description:
      'Add a dated valuation to a property. There is NO automatic estimate — ' +
      'the value is the one the user knows, and `source` is a free label ' +
      '("estimation agence", "notaire"). One valuation per date: the same ' +
      'date replaces. Amounts in CENTS EUR. Find ids via listProperties.',
    schema: {
      org: orgSlug,
      propertyId: z.string().describe('Property id from listProperties'),
      asOf: z.string().describe('ISO date "YYYY-MM-DD"'),
      valueCents: z.number().int().min(0).describe('cents EUR'),
      source: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, propertyId, asOf, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.addPropertyValuationInternal,
        {
          orgId,
          actorUserId,
          propertyId: propertyId as Id<'properties'>,
          asOf: parseISODate(asOf),
          ...fields,
        },
      )
      return { _id: created._id, url: appUrl(org, 'immobilier') }
    },
  }),
  defineTool({
    name: 'createGuarantee',
    description:
      'Attach a security to a bank loan of the org. THREE independent pieces ' +
      'of information (never confuse them): the FORM (nantissement, ' +
      'hypotheque, ppd, caution, garantie_organisme), the SUBJECT it bites ' +
      'on (exactly one of subjectDealId for a placement, subjectPropertyId ' +
      'for a property, subjectCompanyId for shares, or subjectLabel for ' +
      'something that is not ours), and the GUARANTOR (pledgorOrgId for a ' +
      'group company, or pledgorLabel for anyone else — a personal caution ' +
      'is a LABEL, never a person record). Leave pledgedAmountCents EMPTY ' +
      'when the deed does not quantify it (an unlimited caution): it is then ' +
      'excluded from the pledged total, and a zero would lie. Find ids via ' +
      'listLoans, listDeals, listProperties, listCompanies, listOrgs.',
    schema: {
      org: orgSlug,
      loanId: z.string().describe('Loan id from listLoans'),
      form: z.enum([
        'nantissement',
        'hypotheque',
        'ppd',
        'caution',
        'garantie_organisme',
      ]),
      subjectDealId: z.string().optional().describe('A placement (listDeals)'),
      subjectPropertyId: z
        .string()
        .optional()
        .describe('A property (listProperties)'),
      subjectCompanyId: z
        .string()
        .optional()
        .describe('Shares (listCompanies)'),
      subjectLabel: z
        .string()
        .optional()
        .describe('Something not ours, e.g. "Saccef"'),
      pledgorOrgId: z.string().optional().describe('Group org id (listOrgs)'),
      pledgorLabel: z
        .string()
        .optional()
        .describe('Outside guarantor, e.g. "Clément Alteresco"'),
      rank: z.number().int().min(1).optional().describe('1 = first rank'),
      pledgedAmountCents: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Amount ON THE DEED. Omit when not quantified'),
      actDate: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
      notes: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, loanId, actDate, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.createGuaranteeInternal,
        {
          orgId,
          actorUserId,
          loanId: loanId as Id<'loans'>,
          ...fields,
          subjectDealId: fields.subjectDealId as Id<'deals'> | undefined,
          subjectPropertyId: fields.subjectPropertyId as
            | Id<'properties'>
            | undefined,
          subjectCompanyId: fields.subjectCompanyId as
            | Id<'companies'>
            | undefined,
          pledgorOrgId: fields.pledgorOrgId as Id<'organizations'> | undefined,
          actDate: actDate ? parseISODate(actDate) : undefined,
        },
      )
      return { _id: created._id, url: appUrl(org, 'passif') }
    },
  }),
  defineTool({
    name: 'releaseGuarantee',
    description:
      'Record a MAINLEVÉE on a guarantee: it stops counting towards the ' +
      'pledged total, and the row STAYS as history. This is not a deletion — ' +
      'deleting a guarantee entered by mistake is a UI gesture. Find ids via ' +
      'listGuarantees.',
    schema: {
      org: orgSlug,
      guaranteeId: z.string().describe('Guarantee id from listGuarantees'),
      releasedAt: z.string().describe('Mainlevée date "YYYY-MM-DD"'),
    },
    write: true,
    run: async (ctx, actorUserId, { org, guaranteeId, releasedAt }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      await ctx.runMutation(internal.agentToolsDebt.releaseGuaranteeInternal, {
        orgId,
        actorUserId,
        guaranteeId: guaranteeId as Id<'guarantees'>,
        releasedAt: parseISODate(releasedAt),
      })
      return { guaranteeId, url: appUrl(org, 'passif') }
    },
  }),
  defineTool({
    name: 'addLoanRate',
    description:
      'Add a dated step to a VARIABLE-rate loan: a revision that happened ' +
      '(kind "actual") or a steering assumption (kind "forecast"). The ' +
      'distinction is not cosmetic — instalments past the last "actual" step ' +
      'are flagged as projected, because the app does not pretend to know a ' +
      'future rate. Refused on a fixed-rate loan. One step per date: the ' +
      'same date replaces. Rates in BASIS POINTS (396 = 3,96 %).',
    schema: {
      org: orgSlug,
      loanId: z.string().describe('Loan id from listLoans'),
      fromDate: z.string().describe('Effective date "YYYY-MM-DD"'),
      rateBps: z.number().int().min(0).describe('basis points'),
      kind: z.enum(['actual', 'forecast']),
      notes: z.string().optional(),
    },
    write: true,
    run: async (ctx, actorUserId, { org, loanId, fromDate, ...fields }) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.addLoanRateInternal,
        {
          orgId,
          actorUserId,
          loanId: loanId as Id<'loans'>,
          fromDate: parseISODate(fromDate),
          ...fields,
        },
      )
      return { ...created, url: appUrl(org, 'passif') }
    },
  }),
  defineTool({
    name: 'addLoanAmendment',
    description:
      'Record a dated AMENDMENT to a loan (a renegotiation). It KEEPS the ' +
      'history: instalments already run do not move, and the new terms apply ' +
      'to the capital that remains from the effective date. Do NOT use this ' +
      'to fix a typo — that is a correction, and it is a UI gesture. Only ' +
      'pass the fields that actually change; the rest carries over. Set ' +
      'outstandingCents ONLY if the lender restated the capital, otherwise ' +
      'the app derives it. Refused on a revolving and before the first ' +
      'instalment.',
    schema: {
      org: orgSlug,
      loanId: z.string().describe('Loan id from listLoans'),
      effectiveDate: z.string().describe('ISO date "YYYY-MM-DD"'),
      rateBps: z.number().int().min(0).optional().describe('basis points'),
      durationMonths: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Duration REMAINING from the effective date'),
      insuranceMonthlyCents: z.number().int().min(0).optional(),
      outstandingCents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Only if the lender restated it'),
      notes: z.string().optional(),
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, loanId, effectiveDate, ...fields },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.agentToolsDebt.addLoanAmendmentInternal,
        {
          orgId,
          actorUserId,
          loanId: loanId as Id<'loans'>,
          effectiveDate: parseISODate(effectiveDate),
          ...fields,
        },
      )
      return { ...created, url: appUrl(org, 'passif') }
    },
  }),
  defineTool({
    name: 'createValuation',
    description:
      'Record a dated valuation (fair value) for a DEAL — the counterpart of ' +
      'addPropertyValuation for real estate. One valuation per date: the ' +
      'same date replaces. valuationMethod is a free label ("last_round", ' +
      '"mark_to_market", "reported_nav"). Amounts in CENTS EUR. Find ids via ' +
      'listDeals, history via listValuations.',
    schema: {
      org: orgSlug,
      dealId: z.string().describe('Deal id from listDeals'),
      asOf: z.string().describe('ISO date "YYYY-MM-DD"'),
      fairValueCents: z.number().int().positive().describe('cents EUR'),
      valuationMethod: z.string().optional(),
      source: z.string().optional(),
      notes: z.string().optional(),
    },
    write: true,
    run: async (
      ctx,
      actorUserId,
      { org, dealId, asOf, fairValueCents, ...fields },
    ) => {
      const orgId = await orgIdFor(ctx, actorUserId, org)
      const created = await ctx.runMutation(
        internal.valuations.createInternal,
        {
          orgId,
          actorUserId,
          dealId: dealId as Id<'deals'>,
          asOf: parseISODate(asOf),
          fairValue: fairValueCents,
          ...fields,
        },
      )
      return { _id: created._id, url: appUrl(org, 'participations') }
    },
  }),
]
