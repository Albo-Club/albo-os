/**
 * Agent tool for semantic search over the org's documents & reports,
 * scoped to the thread's org (convex/agentTools.ts pattern). The backend
 * lives in convex/vectorize.ts (searchInternal → @convex-dev/rag).
 */

import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { parseScope } from './lib/agentScope'
import type { Id } from './_generated/dataModel'

const searchDocuments = createTool({
  description:
    'Semantic search over the org\'s documents (pactes, term sheets, BP, ' +
    'legal, reportings) and investor reports. Finds passages by MEANING, ' +
    'not keywords — query in natural language (French or English), e.g. ' +
    '"clause de liquidité du pacte Sezame" or "difficultés de recrutement". ' +
    'Optionally restrict to one company with companyId (from listCompanies). ' +
    'Returns scored excerpts with their source document title — cite the ' +
    'source when answering.',
  inputSchema: z.object({
    query: z.string().describe('Natural-language search query'),
    companyId: z.string().optional().describe('Restrict to one company'),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runAction(internal.vectorize.searchInternal, {
      orgId,
      actorUserId: userId,
      query: input.query,
      companyId: input.companyId as Id<'companies'> | undefined,
      limit: input.limit,
    })
  },
})

export const documentTools = {
  searchDocuments,
}
