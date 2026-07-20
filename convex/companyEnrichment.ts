/**
 * Auto-enrichment of a portfolio company's pitch fields (`oneLiner` + `summary`).
 * Two sources share one LLM helper (`generatePitch`):
 *   - website (`enrich`): the default — reads the company's `domain` homepage,
 *     ADDITIVE (fills only empty fields). See below.
 *   - VASCO (`enrichFromVasco`): for Parallel SPVs, which have no usable website
 *     — reads the entity's cached investor communications and OVERWRITES the
 *     pitch with the operation's description. See the VASCO section at the end.
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
import { normalizeDomain } from './lib/domain'
import { applyPitchToDomainGroup, pickCanonicalPitch } from './lib/pitch'
import { htmlToText } from './lib/reportLinks'

// Homepage text passed to the LLM (title + meta description + body text).
const MAX_SITE_TEXT = 8_000

export const getTarget = internalQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) return null
    const domain = company.domain ?? null
    // Domain group = every non-archived entity of the org sharing the domain
    // (just this company when it has no domain). Same-domain entities must end
    // up with the SAME pitch (cf. convex/lib/pitch.ts).
    let group = [company]
    if (domain) {
      const all = await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', company.orgId))
        .collect()
      group = all.filter((c) => c.archivedAt == null && c.domain === domain)
    }
    const needsFill = group.some(
      (c) => c.oneLiner === undefined || c.summary === undefined,
    )
    const canonical = pickCanonicalPitch(group)
    return {
      name: company.name,
      kind: company.kind,
      domain,
      needsFill,
      canonicalOneLiner: canonical?.oneLiner ?? null,
      canonicalSummary: canonical?.summary ?? null,
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
    const fields: { oneLiner?: string; summary?: string } = {}
    if (oneLiner?.trim()) fields.oneLiner = oneLiner.trim()
    if (summary?.trim()) fields.summary = summary.trim()
    if (Object.keys(fields).length === 0) return null
    // Additive fill. With a domain, fill every same-domain sibling that's
    // still empty, so the group converges to one text; without a domain, just
    // this company. Never overwrites a hand-entered value.
    if (company.domain) {
      await applyPitchToDomainGroup(ctx, company.orgId, company.domain, fields, 'fill')
    } else {
      const patch: { oneLiner?: string; summary?: string } = {}
      if (fields.oneLiner && company.oneLiner === undefined)
        patch.oneLiner = fields.oneLiner
      if (fields.summary && company.summary === undefined)
        patch.summary = fields.summary
      if (Object.keys(patch).length > 0)
        await ctx.db.patch('companies', companyId, patch)
    }
    return null
  },
})

/**
 * Fetch the homepage and reduce it to LLM-ready text. Returns null when the
 * site is unreachable or does not answer with HTML.
 */
async function fetchSiteText(domain: string): Promise<string | null> {
  // Defensive: a stored domain may still be a markdown link or full URL
  // (legacy imports) — reduce it to a bare hostname before building the URL.
  const host = normalizeDomain(domain)
  if (!host) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(`https://${host}`, {
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

// Parallel SPVs have no usable website — their pitch is derived from the VASCO
// investor communications instead. Describe the operation AS PITCHED (timeless),
// never its current status/progress (Benjamin wants « le résumé de l'opération
// qu'on nous a vendue », not the latest update).
const VASCO_PITCH_PROMPT = `Tu rédiges la fiche d'une opération d'investissement (un SPV Parallel) dans un outil interne de family office. À partir des communications investisseur fournies, décris **l'opération elle-même, telle qu'elle a été présentée au départ** — PAS son avancement ni sa performance.

Produis deux champs en FRANÇAIS :
- "oneLiner" : 3 à 8 mots, sans point final, style annuaire — nature de l'opération + repère géographique ou sectoriel, ex. « Promotion immobilière — Bordeaux », « Club deal — SaaS RH », « Dette obligataire — hôtellerie ».
- "summary" : 2 à 3 phrases (30 à 50 mots) décrivant CE QU'EST l'opération : type (promotion immobilière, club deal, dette, foncière, growth, secondaire…), actif ou société sous-jacente, secteur, géographie, et structure (equity ou dette) si elle ressort de la présentation.

INTERDIT — n'écris RIEN sur l'avancement ni le statut : pas de ventes réalisées, remboursements, coupons versés, appels de fonds, retards, valorisations ou performances « à date ». On veut la description intemporelle de l'opération vendue, pas son actualité.
Factuel, déductible des communications uniquement. Pas de superlatifs ni de langage marketing.`

/**
 * Shared LLM call producing the `{oneLiner, summary}` pitch. Tries structured
 * output, falls back to free-text JSON (some models reject schemas). Returns
 * null on failure (the caller leaves the fields as-is).
 */
async function generatePitch(
  system: string,
  prompt: string,
): Promise<{ oneLiner: string; summary: string } | null> {
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: enrichmentSchema,
      system,
      prompt,
    })
    return object
  } catch (err) {
    console.warn(
      '[companyEnrichment] generateObject failed, falling back to generateText:',
      err instanceof Error ? err.message : String(err),
    )
    try {
      const { text } = await generateText({
        model: getModel(),
        system: `${system}\n\nRéponds UNIQUEMENT avec un JSON valide {"oneLiner": "...", "summary": "..."}, sans markdown.`,
        prompt,
      })
      const jsonMatch = /\{[\s\S]*\}/.exec(text)
      if (!jsonMatch) throw new Error('no JSON in fallback answer')
      return enrichmentSchema.parse(JSON.parse(jsonMatch[0]))
    } catch (fallbackErr) {
      console.warn(
        '[companyEnrichment] LLM pitch failed:',
        fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr),
      )
      return null
    }
  }
}

export const enrich = internalAction({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const target: {
      name: string
      kind: string
      domain: string | null
      needsFill: boolean
      canonicalOneLiner: string | null
      canonicalSummary: string | null
    } | null = await ctx.runQuery(internal.companyEnrichment.getTarget, {
      companyId,
    })
    // A pitch is meaningless for group/legal entities — portfolio only.
    if (!target || target.kind !== 'portfolio') return null
    // Whole domain group already has both fields → nothing to do.
    if (!target.domain || !target.needsFill) return null

    // A same-domain sibling already carries a complete pitch → reuse it (no
    // LLM call, and the group stays identical) instead of paraphrasing.
    if (target.canonicalOneLiner && target.canonicalSummary) {
      await ctx.runMutation(internal.companyEnrichment.applyEnrichment, {
        companyId,
        oneLiner: target.canonicalOneLiner,
        summary: target.canonicalSummary,
      })
      return null
    }

    const siteText = await fetchSiteText(target.domain)
    if (!siteText) {
      console.warn(
        `[companyEnrichment] site unreachable for ${target.name} (${target.domain}) — skipped`,
      )
      return null
    }

    const prompt = `SOCIÉTÉ : ${target.name}\nSITE (${target.domain}) :\n${siteText}`
    const fields = await generatePitch(SYSTEM_PROMPT, prompt)
    if (!fields) return null

    await ctx.runMutation(internal.companyEnrichment.applyEnrichment, {
      companyId,
      oneLiner: fields.oneLiner,
      summary: fields.summary,
    })
    return null
  },
})

// ── VASCO-sourced pitch (Parallel SPVs — no usable website) ─────────────────

const MAX_VASCO_PITCH_TEXT = 8_000

/** A linked Parallel entity + its cached communications, for the pitch LLM.
 * Returns null unless the entity is a portfolio company linked to a VASCO
 * issuer. */
export const getVascoEnrichmentTarget = internalQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get('companies', companyId)
    if (
      !company ||
      company.kind !== 'portfolio' ||
      !company.vascoClientSlug ||
      !company.vascoIssuerId
    )
      return null
    const rows = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', company.orgId))
      .collect()
    const comms = rows
      .filter(
        (r) =>
          r.clientSlug === company.vascoClientSlug &&
          r.issuerId === company.vascoIssuerId,
      )
      // Oldest first: the initial communication is the deal presentation (what
      // the operation IS), which leads the pitch context; later comms are
      // progress updates we don't want in a timeless description.
      .sort((a, b) => (a.publishDate ?? '').localeCompare(b.publishDate ?? ''))
      .map((r) => ({
        title: r.title ?? null,
        bodyText: r.bodyText ?? null,
        publishDate: r.publishDate ?? null,
        issuerLabel: r.issuerLabel ?? null,
        docNames: r.documents
          .map((d) => d.name ?? null)
          .filter((n): n is string => Boolean(n)),
      }))
    return {
      name: company.name,
      issuerLabel: comms[0]?.issuerLabel ?? null,
      comms,
    }
  },
})

/** Portfolio entities of `orgId` linked to a VASCO issuer (for the backfill). */
export const listLinkedParallelCompanies = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return companies
      .filter(
        (c) =>
          c.kind === 'portfolio' &&
          c.archivedAt == null &&
          Boolean(c.vascoClientSlug) &&
          Boolean(c.vascoIssuerId),
      )
      .map((c) => c._id)
  },
})

/** Overwrite the entity's pitch with the VASCO-derived one. Unlike the
 * website-based `applyEnrichment` (additive), this REPLACES `oneLiner` +
 * `summary`: the Parallel operation description supersedes the domain-derived
 * one. Single company (each SPV is a distinct operation — no domain group). */
export const applyVascoPitch = internalMutation({
  args: {
    companyId: v.id('companies'),
    oneLiner: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, { companyId, oneLiner, summary }) => {
    const company = await ctx.db.get('companies', companyId)
    if (!company) return null
    const patch: { oneLiner?: string; summary?: string } = {}
    if (oneLiner.trim()) patch.oneLiner = oneLiner.trim()
    if (summary.trim()) patch.summary = summary.trim()
    if (Object.keys(patch).length > 0)
      await ctx.db.patch('companies', companyId, patch)
    return null
  },
})

/**
 * Describe a Parallel SPV's operation from its cached investor communications
 * and (over)write the entity's `oneLiner` + `summary`. Best-effort: skips if the
 * entity isn't a linked Parallel portfolio company or has no cached comms yet
 * (the cache is filled by the cron / a refresh). Triggered on `setVascoLink`
 * and by the backfill; org-agnostic (keyed by the VASCO link, not the org).
 */
export const enrichFromVasco = internalAction({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const target = await ctx.runQuery(
      internal.companyEnrichment.getVascoEnrichmentTarget,
      { companyId },
    )
    if (!target || target.comms.length === 0) return null

    let text = ''
    for (const c of target.comms) {
      const block = [
        c.publishDate ? `[${c.publishDate}]` : '',
        c.title ?? '',
        c.bodyText ?? '',
        c.docNames.length ? `Documents : ${c.docNames.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      if (text.length + block.length > MAX_VASCO_PITCH_TEXT) break
      text += `${block}\n\n`
    }

    const prompt = `OPÉRATION : ${target.name}\nSPV : ${target.issuerLabel ?? '—'}\nCOMMUNICATIONS :\n${text.trim()}`
    const fields = await generatePitch(VASCO_PITCH_PROMPT, prompt)
    if (!fields) return null

    await ctx.runMutation(internal.companyEnrichment.applyVascoPitch, {
      companyId,
      oneLiner: fields.oneLiner,
      summary: fields.summary,
    })
    return null
  },
})

/**
 * One-shot backfill (CLI): describe every linked Parallel entity from VASCO,
 * across ALL orgs that have an active VASCO connection (Calte today, Albo once
 * connected). Refreshes each org's cache first so the descriptions are built on
 * fresh communications.
 *   npx convex run --prod companyEnrichment:backfillVascoPitches '{}'
 */
export const backfillVascoPitches = internalAction({
  args: {},
  handler: async (ctx): Promise<{ orgs: number; companies: number }> => {
    const conns = await ctx.runQuery(internal.connections.listAllActive, {
      platform: 'vasco',
    })
    const orgIds = Array.from(new Set(conns.map((c) => c.orgId)))
    let companies = 0
    for (const orgId of orgIds) {
      await ctx.runAction(internal.vasco.refreshVascoCacheForOrg, { orgId })
      const ids = await ctx.runQuery(
        internal.companyEnrichment.listLinkedParallelCompanies,
        { orgId },
      )
      for (const companyId of ids) {
        await ctx.runAction(internal.companyEnrichment.enrichFromVasco, {
          companyId,
        })
        companies++
      }
    }
    return { orgs: orgIds.length, companies }
  },
})
