/**
 * Auto-enrichment of a portfolio company's pitch fields from its website.
 *
 * When a portfolio company gets a `domain` (at creation, via the edit dialog
 * or the inline Identity field), a background action fetches the site's
 * homepage, strips it to text and asks the LLM (same model as the chat agent,
 * cf. convex/agent.ts:getModel) for two French fields:
 *   - `oneLiner`: the short table pitch (3-8 words),
 *   - `summary`: the 2-3 sentence description shown under the fiche header.
 *
 * Semantics — ADDITIVE ONLY, mirror of migrations/alboOneLinerImport: a field
 * is written only while still `undefined` on the company, so any hand-entered
 * (or previously generated then edited) value is never overwritten. Re-saving
 * the same domain is therefore a safe no-op once both fields exist.
 *
 * Fire-and-forget: scheduled with `ctx.scheduler.runAfter(0, …)` from
 * `companies.create`, `companies.update` (domain set) and the agent tool
 * `agentTools.createCompanyInternal`. Every failure (site unreachable,
 * non-HTML answer, LLM error, missing OPENROUTER_API_KEY) is logged and
 * swallowed — the fields simply stay empty and can be filled by hand.
 */
import { generateObject, generateText } from 'ai'
import { z } from 'zod/v3'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { getModel } from './agent'
import { htmlToText } from './lib/reportLinks'

// Homepage text passed to the LLM (title + meta description + body text).
const MAX_SITE_TEXT = 8_000

export const getTarget = internalQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) return null
    return {
      name: company.name,
      kind: company.kind,
      domain: company.domain ?? null,
      hasOneLiner: company.oneLiner !== undefined,
      hasSummary: company.summary !== undefined,
    }
  },
})

export const applyEnrichment = internalMutation({
  args: {
    companyId: v.id('companies'),
    oneLiner: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, oneLiner, summary }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) return null
    // Additive: re-checked at write time (a hand edit may have landed while
    // the action was fetching the site).
    const patch: { oneLiner?: string; summary?: string } = {}
    if (oneLiner?.trim() && company.oneLiner === undefined)
      patch.oneLiner = oneLiner.trim()
    if (summary?.trim() && company.summary === undefined)
      patch.summary = summary.trim()
    if (Object.keys(patch).length > 0)
      await ctx.db.patch('companies', companyId, patch)
    return null
  },
})

/**
 * Fetch the homepage and reduce it to LLM-ready text. Returns null when the
 * site is unreachable or does not answer with HTML.
 */
async function fetchSiteText(domain: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(`https://${domain}`, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlboOS/1.0)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    const html = await res.text()
    // Keep the strongest self-description signals ahead of the body text.
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
    const metaDescription =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(
        html,
      )?.[1] ??
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(
        html,
      )?.[1] ??
      ''
    const text = [title, metaDescription, htmlToText(html)]
      .filter(Boolean)
      .join('\n')
    return text.slice(0, MAX_SITE_TEXT)
  } catch {
    return null
  }
}

const enrichmentSchema = z.object({
  oneLiner: z
    .string()
    .describe('Pitch ultra-court en français, 3 à 8 mots, sans point final'),
  summary: z
    .string()
    .describe('Résumé factuel en français, 2 à 3 phrases, 30 à 50 mots'),
})

const SYSTEM_PROMPT = `Tu rédiges les fiches d'un outil interne de suivi de participations (family office).
À partir du texte du site web d'une société, produis deux champs en FRANÇAIS :
- "oneLiner" : pitch ultra-court (3 à 8 mots, sans point final, style annuaire), ex. « Marketplace de produits électroniques reconditionnés ».
- "summary" : résumé factuel de 2 à 3 phrases (30 à 50 mots) commençant par le nom de la société : ce qu'elle fait, pour qui, et son angle distinctif (techno, modèle économique).
Interdits : superlatifs et langage marketing (« leader », « révolutionnaire »), chiffres de levée de fonds, contenu non déductible du texte fourni.`

export const enrich = internalAction({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const target: {
      name: string
      kind: string
      domain: string | null
      hasOneLiner: boolean
      hasSummary: boolean
    } | null = await ctx.runQuery(internal.companyEnrichment.getTarget, {
      companyId,
    })
    // A pitch is meaningless for group/legal entities — portfolio only.
    if (!target || target.kind !== 'portfolio') return null
    if (!target.domain || (target.hasOneLiner && target.hasSummary))
      return null

    const siteText = await fetchSiteText(target.domain)
    if (!siteText) {
      console.warn(
        `[companyEnrichment] site unreachable for ${target.name} (${target.domain}) — skipped`,
      )
      return null
    }

    const prompt = `SOCIÉTÉ : ${target.name}\nSITE (${target.domain}) :\n${siteText}`
    let fields: { oneLiner: string; summary: string }
    try {
      const { object } = await generateObject({
        model: getModel(),
        schema: enrichmentSchema,
        system: SYSTEM_PROMPT,
        prompt,
      })
      fields = object
    } catch (err) {
      // Mirror of reportIdentify: some models reject structured output —
      // retry as free text and parse the JSON by hand.
      console.warn(
        '[companyEnrichment] generateObject failed, falling back to generateText:',
        err instanceof Error ? err.message : String(err),
      )
      try {
        const { text } = await generateText({
          model: getModel(),
          system: `${SYSTEM_PROMPT}\n\nRéponds UNIQUEMENT avec un JSON valide {"oneLiner": "...", "summary": "..."}, sans markdown.`,
          prompt,
        })
        const jsonMatch = /\{[\s\S]*\}/.exec(text)
        if (!jsonMatch) throw new Error('no JSON in fallback answer')
        fields = enrichmentSchema.parse(JSON.parse(jsonMatch[0]))
      } catch (fallbackErr) {
        console.warn(
          `[companyEnrichment] LLM failed for ${target.name} — fields left empty:`,
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr),
        )
        return null
      }
    }

    await ctx.runMutation(internal.companyEnrichment.applyEnrichment, {
      companyId,
      oneLiner: fields.oneLiner,
      summary: fields.summary,
    })
    return null
  },
})
