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

// ─── dryRun — read-only, stopping point before scheduling anything ──────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const candidates = await listCandidates(ctx)
    return {
      candidateCount: candidates.length,
      estimatedDurationSec: Math.round((candidates.length * STAGGER_MS) / 1000),
      candidates: candidates.map((c) => ({
        org: c.orgSlug,
        name: c.company.name,
        domain: c.company.domain,
        missing: c.missing,
      })),
      note:
        'Lecture seule. Valider la liste puis lancer ' +
        'migrations/backfillCompanyEnrichment:apply',
    }
  },
})

// ─── apply — schedules enrich for each candidate (staggered) ────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const candidates = await listCandidates(ctx)
    let scheduled = 0
    for (const c of candidates) {
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.companyEnrichment.enrich,
        { companyId: c.company._id },
      )
      scheduled++
    }
    return {
      scheduled,
      estimatedDurationSec: Math.round((scheduled * STAGGER_MS) / 1000),
      note:
        'Génération lancée en arrière-plan. Relancer ' +
        'migrations/backfillCompanyEnrichment:report dans quelques minutes ' +
        'pour voir ce qui reste vide (site injoignable → à remplir à la main).',
    }
  },
})

// ─── report — post-apply state: which candidates are still empty ────────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stillEmpty = await listCandidates(ctx)
    return {
      stillEmptyCount: stillEmpty.length,
      stillEmpty: stillEmpty.map((c) => ({
        org: c.orgSlug,
        name: c.company.name,
        domain: c.company.domain,
        missing: c.missing,
      })),
      note:
        stillEmpty.length === 0
          ? 'Toutes les entités portfolio avec domaine ont désormais one-liner + résumé.'
          : 'Ces entités sont encore vides (site injoignable ou génération en cours) — à remplir à la main si besoin.',
    }
  },
})
