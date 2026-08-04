/**
 * Agent tools for investor reports and the AI synthesis, scoped to the
 * thread's org (convex/agentTools.ts pattern). The internals live in
 * convex/companyReports.ts (listInternal / getInternal) and
 * convex/intelligence.ts (getByCompanyInternal).
 *
 * Read-only: reports are produced by the email ingestion pipeline
 * (convex/reportInbox.ts), never written by the agent.
 */

import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { parseScope } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

const listCompanyReports = createTool({
  description:
    'List the investor reports of a portfolio company (updates received by ' +
    'email and analysed by the pipeline), most recent period first. Returns ' +
    'the headline and period of each report, not its content — call ' +
    'getCompanyReport for that. Use listCompanies first if you do not know ' +
    'the company id.',
  inputSchema: z.object({
    companyId: z.string(),
    limit: z.number().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.companyReports.listInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
      limit: input.limit,
    })
  },
})

const getCompanyReport = createTool({
  description:
    'Content of one investor report: headline, key highlights and the ' +
    'extracted metrics. Each metric carries its OWN unit — EUR_cents (divide ' +
    'by 100 for euros), bps (divide by 100 for percent), count or months — ' +
    'so read the unit field before stating a figure. Use ' +
    'listCompanyReports first to get a report id.',
  inputSchema: z.object({
    reportId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.companyReports.getInternal, {
      orgId,
      actorUserId: userId,
      reportId: input.reportId as Id<'companyReports'>,
    })
  },
})

const getCompanyIntelligence = createTool({
  description:
    'The AI synthesis of a portfolio company, computed from its reports: ' +
    'executive summary, health score (1-10 with good/bad points), top ' +
    'insights and alerts. Returns null when no synthesis exists yet. ' +
    'latestReportId points at the report it was last refreshed from.',
  inputSchema: z.object({
    companyId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.intelligence.getByCompanyInternal, {
      orgId,
      actorUserId: userId,
      companyId: input.companyId as Id<'companies'>,
    })
  },
})

const listSilentCompanies = createTool({
  description:
    'List the portfolio companies that have gone silent: no investor report ' +
    'received for longer than the organisation threshold (4 months by ' +
    'default). Only covers companies held through a live deal. Returns the ' +
    'date of the last report received (null when the company never ' +
    'reported — the silence is then counted from the first disbursement), ' +
    'the most recent period covered, and the date the silence runs from, ' +
    'longest silence first.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.companyReports.silentInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

export const reportTools = {
  listCompanyReports,
  getCompanyReport,
  getCompanyIntelligence,
  listSilentCompanies,
}
