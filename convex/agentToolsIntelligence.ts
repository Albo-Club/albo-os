/**
 * Agent tool for the company-intelligence agent: web search.
 * Unlike the deal/forecast tools, this needs no org/user scope — it's a pure
 * external lookup — so it does not call parseScope.
 */

import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'
import { internal } from './_generated/api'

const webSearch = createTool({
  description:
    'Recherche web pour enrichir l\'analyse d\'une company (marché, ' +
    'concurrents, actualités). Renvoie un résumé des meilleurs résultats.',
  inputSchema: z.object({
    query: z.string().describe('Requête de recherche'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    return await ctx.runAction(internal.intelligence.linkupSearch, {
      query: input.query,
    })
  },
})

export const intelligenceTools = { webSearch }
