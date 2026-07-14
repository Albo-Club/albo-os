/**
 * One-shot backfill of the website auto-enrichment (oneLiner + summary) over
 * EVERY existing portfolio company that already has a `domain` but is still
 * missing at least one of the two pitch fields — across ALL orgs (Calte +
 * Albo).
 *
 * Why this exists: `companyEnrichment` fires forward-only (on domain set /
 * company create). Entities whose `domain` was filled by earlier imports
 * (Attio, identity) never triggered it, so their pitch fields stayed empty.
 * This sweep schedules `companyEnrichment.enrich` for each candidate. That
 * action is additive (writes only `undefined` fields) and portfolio-only, so
 * the backfill is safe and idempotent; an unreachable site simply leaves the
 * fields empty (warn log, no error).
 *
 * Deliberate scope (per product decision, 14/07/2026): SPVs and pure
 * investment vehicles are INCLUDED. Their `domain` often points at the parent
 * platform (e.g. parallel-invest.com for a single Parallel SPV), so the
 * generated pitch may describe the platform rather than the vehicle — review
 * those few by hand afterwards.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/backfillCompanyEnrichment:dryRun
 *   # STOP: eyeball the candidate list, then:
 *   pnpm exec convex run --prod migrations/backfillCompanyEnrichment:apply
 *   # wait a few minutes (LLM calls run in the background), then:
 *   pnpm exec convex run --prod migrations/backfillCompanyEnrichment:report
 */
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

// Gap between scheduled enrich actions, to spread the site fetches + LLM
// calls instead of firing every candidate at once.
const STAGGER_MS = 2_000

type Candidate = {
  company: Doc<'companies'>
  orgSlug: string
  missing: Array<'oneLiner' | 'summary'>
}

// Non-company lines to keep OUT of enrichment: deal lines, SPVs, funds and
// investment vehicles. A generated "what does it do" pitch is meaningless for
// them (their domain usually points at the parent platform). Structural
// markers first (platform names shared across many deal lines), then an
// explicit list for the one-off vehicles that carry no such marker. Reviewed
// against the prod dryRun — extend the explicit list from its `excluded`
// output if a non-company slips through.
const EXCLUDE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bside\b/i, reason: 'side_deal' },
  { re: /\basterion\b/i, reason: 'asterion_line' },
  { re: /\banaxago\b/i, reason: 'anaxago_line' },
  { re: /parallel\s*invest/i, reason: 'parallel_spv' },
  { re: /\bsezame\b/i, reason: 'sezame_spv' },
  { re: /vie\s*de\s*quartier\s*-/i, reason: 'lvdq_sub_entity' },
  { re: /\bspv\b/i, reason: 'spv' },
  { re: /\bhexa\s+sprint\b/i, reason: 'fund' },
  { re: /\boprtrs\b/i, reason: 'vehicle' },
  { re: /\bco[\s-]?invest/i, reason: 'co_invest' },
  { re: /\bfund\b/i, reason: 'fund' },
  // Savings/insurance products (e.g. "CAPITALISATION PALATINE - La Mondiale"):
  // the domain is the bank's, so a pitch would describe the bank, not the line.
  { re: /\bcapitalisation\b/i, reason: 'capitalisation_contract' },
]

// Normalised (upper, collapsed spaces) exact names — one-off vehicles/funds
// with no structural marker above.
const EXCLUDE_NAMES = new Set(
  [
    'Etoro',
    'Crypto AM',
    'Batch Venture 1',
    'Batch Venture 2025 (Fund n°2)',
    'Eutopia 2',
    'Wind Capital 2',
    'Galion.exe Origin',
    'Good Only Ventures',
    'Holding Mineral Capital 7',
  ].map((n) => n.toUpperCase().replace(/\s+/g, ' ').trim()),
)

/** Reason a name is a non-company line, or null if it should be enriched. */
function classifyExclusion(name: string): string | null {
  const norm = name.toUpperCase().replace(/\s+/g, ' ').trim()
  if (EXCLUDE_NAMES.has(norm)) return 'named_vehicle'
  for (const { re, reason } of EXCLUDE_PATTERNS) {
    if (re.test(name)) return reason
  }
  return null
}

/**
 * Every portfolio company (all orgs) that has a `domain` but is missing at
 * least one pitch field — the exact set `enrich` would still fill.
 */
async function listCandidates(ctx: Ctx): Promise<Array<Candidate>> {
  const orgs = await ctx.db.query('organizations').collect()
  const candidates: Array<Candidate> = []
  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'portfolio'),
      )
      .collect()
    for (const company of companies) {
      if (company.archivedAt != null) continue
      if (!company.domain) continue
      const missing: Array<'oneLiner' | 'summary'> = []
      if (company.oneLiner === undefined) missing.push('oneLiner')
      if (company.summary === undefined) missing.push('summary')
      if (missing.length === 0) continue
      candidates.push({ company, orgSlug: org.slug, missing })
    }
  }
  return candidates
}

/** Split candidates into the ones to enrich and the excluded non-company lines. */
function partition(candidates: Array<Candidate>): {
  willEnrich: Array<Candidate>
  excluded: Array<{ candidate: Candidate; reason: string }>
} {
  const willEnrich: Array<Candidate> = []
  const excluded: Array<{ candidate: Candidate; reason: string }> = []
  for (const c of candidates) {
    const reason = classifyExclusion(c.company.name)
    if (reason) excluded.push({ candidate: c, reason })
    else willEnrich.push(c)
  }
  return { willEnrich, excluded }
}

// ─── dryRun — read-only, stopping point before scheduling anything ──────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { willEnrich, excluded } = partition(await listCandidates(ctx))
    return {
      willEnrichCount: willEnrich.length,
      excludedCount: excluded.length,
      estimatedDurationSec: Math.round((willEnrich.length * STAGGER_MS) / 1000),
      willEnrich: willEnrich.map((c) => ({
        org: c.orgSlug,
        name: c.company.name,
        domain: c.company.domain,
        missing: c.missing,
      })),
      excluded: excluded.map((e) => ({
        org: e.candidate.orgSlug,
        name: e.candidate.company.name,
        reason: e.reason,
      })),
      note:
        'Lecture seule. Vérifier surtout willEnrich (aucune non-société ?) ' +
        'et excluded (aucune vraie société écartée ?). Signaler les erreurs ' +
        'pour ajuster le tri, puis lancer ' +
        'migrations/backfillCompanyEnrichment:apply',
    }
  },
})

// ─── apply — schedules enrich for the non-excluded candidates (staggered) ────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { willEnrich, excluded } = partition(await listCandidates(ctx))
    let scheduled = 0
    for (const c of willEnrich) {
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.companyEnrichment.enrich,
        { companyId: c.company._id },
      )
      scheduled++
    }
    return {
      scheduled,
      excludedCount: excluded.length,
      estimatedDurationSec: Math.round((scheduled * STAGGER_MS) / 1000),
      note:
        'Génération lancée en arrière-plan (non-sociétés exclues). Relancer ' +
        'migrations/backfillCompanyEnrichment:report dans quelques minutes ' +
        'pour voir ce qui reste vide (site injoignable → à remplir à la main).',
    }
  },
})

// ─── report — post-apply state: non-excluded candidates still empty ─────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { willEnrich } = partition(await listCandidates(ctx))
    return {
      stillEmptyCount: willEnrich.length,
      stillEmpty: willEnrich.map((c) => ({
        org: c.orgSlug,
        name: c.company.name,
        domain: c.company.domain,
        missing: c.missing,
      })),
      note:
        willEnrich.length === 0
          ? 'Toutes les sociétés visées (hors non-sociétés exclues) ont one-liner + résumé.'
          : 'Ces sociétés sont encore vides (site injoignable ou génération en cours) — à remplir à la main si besoin.',
    }
  },
})

// ─── listEnrichedNonCompanies — leftovers from the first, UNFILTERED run ─────
//
// The initial backfill (PR #201) ran WITHOUT the exclusion filter, so any
// non-company line (SIDE, Anaxago, SPV, fund…) with a reachable domain got a
// pitch. Those are now "done" and invisible to `report`. This read-only query
// lists every exclusion-matched portfolio entity that ALREADY carries a pitch,
// with its text, so a human can judge which are wrong and clear them via
// `clearByIds`. ⚠️ It also surfaces legitimately-curated ones that happen to
// match a pattern (e.g. "La vie de Quartier - Holding", summarised by
// alboSummaryImport) — do NOT clear those; that's why clearing is by explicit
// id, never a blanket wipe.

export const listEnrichedNonCompanies = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query('organizations').collect()
    const rows: Array<{
      id: Doc<'companies'>['_id']
      org: string
      name: string
      reason: string
      oneLiner: string | null
      summary: string | null
    }> = []
    for (const org of orgs) {
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', org._id).eq('kind', 'portfolio'),
        )
        .collect()
      for (const c of companies) {
        if (c.archivedAt != null) continue
        const reason = classifyExclusion(c.name)
        if (!reason) continue
        if (c.oneLiner === undefined && c.summary === undefined) continue
        rows.push({
          id: c._id,
          org: org.slug,
          name: c.name,
          reason,
          oneLiner: c.oneLiner ?? null,
          summary: c.summary ?? null,
        })
      }
    }
    return {
      count: rows.length,
      rows,
      note:
        'Non-sociétés (motif d’exclusion) portant déjà un résumé/one-liner — ' +
        'probablement écrit par le 1er passage non filtré. Relire, puis vider ' +
        'les mauvaises via clearByIds avec la liste des id (NE PAS inclure les ' +
        'résumés légitimes, ex. « La vie de Quartier - Holding »).',
    }
  },
})

// ─── clearByIds — blank oneLiner + summary on an EXPLICIT id list ────────────

export const clearByIds = internalMutation({
  args: { ids: v.array(v.id('companies')) },
  handler: async (ctx, { ids }) => {
    let cleared = 0
    const skipped: Array<{ id: string; reason: string }> = []
    for (const id of ids) {
      const c = await ctx.db.get('companies', id)
      if (!c) {
        skipped.push({ id, reason: 'not_found' })
        continue
      }
      if (c.kind !== 'portfolio') {
        skipped.push({ id, reason: 'not_portfolio' })
        continue
      }
      await ctx.db.patch('companies', id, {
        oneLiner: undefined,
        summary: undefined,
      })
      cleared++
    }
    return { cleared, skipped }
  },
})
