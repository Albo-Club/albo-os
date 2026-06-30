/**
 * Cerveau 3 — company intelligence (synthesis).
 *
 * Reuses the @convex-dev/agent setup: a dedicated agent (analyst persona +
 * webSearch tool) runs an agentic loop, then we persist the JSON synthesis to
 * `companyIntelligence`. Mirrors Albo's company-intelligence edge function,
 * but on the Convex Agent + OpenRouter instead of a hand-rolled Claude loop.
 *
 * Web search = Linkup (LINKUP_API_KEY), same provider as Albo's deployed code.
 */

import { Agent, createThread, stepCountIs } from '@convex-dev/agent'
import { ConvexError, v } from 'convex/values'
import { components, internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server'
import { getModel } from './agent'
import { intelligenceTools } from './agentToolsIntelligence'
import { INTELLIGENCE_SYSTEM_PROMPT } from './lib/reportPrompts'
import { requireOrgMember } from './lib/auth'
import type { Id } from './_generated/dataModel'

const MAX_REPORTS = 5
const MAX_RAW_PER_REPORT = 3000

export const intelligenceAgent = new Agent(components.agent, {
  name: 'company-intelligence',
  languageModel: getModel(),
  instructions: INTELLIGENCE_SYSTEM_PROMPT,
  tools: intelligenceTools,
  stopWhen: stepCountIs(15),
})

// ─── Web search tool backend (Linkup) ────────────────────────────────────────

export const linkupSearch = internalAction({
  args: { query: v.string() },
  handler: async (_ctx, { query: searchQuery }): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY
    if (!apiKey) return 'Recherche web indisponible (LINKUP_API_KEY manquante).'

    try {
      const res = await fetch('https://api.linkup.so/v1/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: searchQuery,
          depth: 'deep',
          outputType: 'searchResults',
          maxResults: 5,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return `Recherche échouée: HTTP ${res.status}`
      const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
      const results = data.results ?? []
      return (
        results
          .map(
            (r) =>
              `${r.name ?? r.title ?? 'Source'}: ${String(r.content ?? '').slice(0, 400)}`,
          )
          .join('\n\n') || 'Aucun résultat trouvé.'
      )
    } catch (err) {
      return `Erreur recherche: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

// ─── Context builder ─────────────────────────────────────────────────────────

export const getContext = internalQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }): Promise<string> => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) return ''

    const parts: Array<string> = [`## Entreprise: ${company.name}`]
    if (company.domain) parts.push(`Domaine: ${company.domain}`)
    if (company.sector) parts.push(`Secteur: ${company.sector}`)
    if (company.notes) parts.push(`Notes: ${company.notes}`)

    const reports = await ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(MAX_REPORTS)

    if (reports.length > 0) {
      parts.push('\n## Reports investisseur (récents)')
      for (const r of reports) {
        parts.push(`\n### ${r.reportPeriod ?? r.title ?? 'Report'}`)
        if (r.headline) parts.push(`Titre: ${r.headline}`)
        if (r.keyHighlights?.length) parts.push(`Points clés: ${r.keyHighlights.join(' | ')}`)
        if (r.metrics) parts.push(`Métriques: ${JSON.stringify(r.metrics)}`)
        if (r.rawContent) parts.push(`Contenu:\n${r.rawContent.slice(0, MAX_RAW_PER_REPORT)}`)
      }
    }

    return parts.join('\n')
  },
})

// ─── Persistence ─────────────────────────────────────────────────────────────

export const upsertIntelligence = internalMutation({
  args: {
    companyId: v.id('companies'),
    orgId: v.id('organizations'),
    status: v.optional(
      v.union(
        v.literal('processing'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('no_data'),
      ),
    ),
    analysis: v.optional(v.any()),
    latestReportId: v.optional(v.id('companyReports')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', args.companyId))
      .unique()

    const patch: Record<string, unknown> = {}
    if (args.status !== undefined) patch.aiAnalysisStatus = args.status
    if (args.analysis !== undefined) {
      patch.aiAnalysis = args.analysis
      patch.aiAnalysisUpdatedAt = Date.now()
    }
    if (args.latestReportId !== undefined) patch.latestReportId = args.latestReportId

    if (existing) {
      await ctx.db.patch("companyIntelligence", existing._id, patch)
      return existing._id
    }
    return await ctx.db.insert('companyIntelligence', {
      orgId: args.orgId,
      companyId: args.companyId,
      ...patch,
    })
  },
})

/** Public read of a company's AI synthesis (CompanyIntelligenceCard). */
export const getByCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    const intel = await ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .unique()
    if (!intel) return null

    return {
      aiAnalysis: intel.aiAnalysis ?? null,
      aiAnalysisStatus: intel.aiAnalysisStatus ?? null,
      aiAnalysisUpdatedAt: intel.aiAnalysisUpdatedAt ?? null,
    }
  },
})

// ─── Runner ──────────────────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  const block = text.match(/```json\s*([\s\S]*?)```/)
  const candidate = block ? block[1] : text
  const cleaned = candidate.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('no JSON in intelligence response')
  }
}

export const runAnalysis = internalAction({
  args: {
    companyId: v.id('companies'),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, { companyId, orgId }) => {
    await ctx.runMutation(internal.intelligence.upsertIntelligence, {
      companyId,
      orgId,
      status: 'processing',
    })

    try {
      const context = await ctx.runQuery(internal.intelligence.getContext, { companyId })
      if (!context) {
        await ctx.runMutation(internal.intelligence.upsertIntelligence, {
          companyId,
          orgId,
          status: 'no_data',
        })
        return
      }

      const threadId = await createThread(ctx, components.agent, {
        userId: `${orgId}:system`,
        title: `Intelligence — ${companyId}`,
      })

      const result = await intelligenceAgent.generateText(
        ctx,
        { threadId },
        {
          prompt: `Analyse cette portfolio company. Fais 2-3 recherches web pour compléter le contexte, puis produis le JSON.\n\n${context}`,
        },
      )

      const analysis = extractJson(result.text)
      await ctx.runMutation(internal.intelligence.upsertIntelligence, {
        companyId,
        orgId,
        status: 'completed',
        analysis,
      })
    } catch (err) {
      console.error(
        `[intelligence] analysis failed for ${companyId}:`,
        err instanceof Error ? err.message : String(err),
      )
      await ctx.runMutation(internal.intelligence.upsertIntelligence, {
        companyId,
        orgId,
        status: 'error',
      })
    }
  },
})

// Re-exported for type-narrowing convenience in the pipeline.
export type IntelligenceCompanyId = Id<'companies'>
