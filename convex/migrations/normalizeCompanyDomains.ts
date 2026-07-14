/**
 * One-shot cleanup of corrupted `companies.domain` values, all orgs.
 *
 * The Calte import stored many domains as markdown links
 * (`[www.anaxago.com](https://www.anaxago.com)`) or full tracking URLs
 * (`monstock.net/fr_fr/?utm_term=…&gclid=…`). A corrupted `domain` breaks
 * BOTH the company logo (logo.dev hotlink builds `https://logo.dev/<domain>`)
 * AND the website auto-enrichment (`https://<domain>` is invalid → fetch
 * fails). This migration rewrites each domain to its bare hostname via
 * `normalizeDomain`.
 *
 * Write semantics: only writes when the normalised value DIFFERS from the
 * current one (idempotent — a clean domain is left as-is). Values that can't
 * be reduced to a hostname (normalizeDomain → null) are NOT touched and are
 * surfaced under `needsManualReview` for a human to fix.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/normalizeCompanyDomains:dryRun
 *   # STOP: eyeball the before→after list, then:
 *   pnpm exec convex run --prod migrations/normalizeCompanyDomains:apply
 *   pnpm exec convex run --prod migrations/normalizeCompanyDomains:report
 */
import { internalMutation, internalQuery } from '../_generated/server'
import { normalizeDomain } from '../lib/domain'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

type Resolved = {
  toFix: Array<{
    company: Doc<'companies'>
    orgSlug: string
    from: string
    to: string
  }>
  needsManualReview: Array<{ orgSlug: string; name: string; domain: string }>
  alreadyClean: number
}

/** Classify every company with a domain: fixable / manual / already-clean. */
async function resolve(ctx: Ctx): Promise<Resolved> {
  const orgs = await ctx.db.query('organizations').collect()
  const orgSlug = new Map(orgs.map((o) => [o._id, o.slug]))
  const toFix: Resolved['toFix'] = []
  const needsManualReview: Resolved['needsManualReview'] = []
  let alreadyClean = 0

  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const company of companies) {
      if (!company.domain) continue
      const slug = orgSlug.get(company.orgId) ?? '?'
      const cleaned = normalizeDomain(company.domain)
      if (cleaned === null) {
        needsManualReview.push({
          orgSlug: slug,
          name: company.name,
          domain: company.domain,
        })
        continue
      }
      if (cleaned === company.domain) {
        alreadyClean++
        continue
      }
      toFix.push({ company, orgSlug: slug, from: company.domain, to: cleaned })
    }
  }
  return { toFix, needsManualReview, alreadyClean }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, needsManualReview, alreadyClean } = await resolve(ctx)
    return {
      toFixCount: toFix.length,
      alreadyClean,
      needsManualReviewCount: needsManualReview.length,
      toFix: toFix.map((f) => ({
        org: f.orgSlug,
        name: f.company.name,
        from: f.from,
        to: f.to,
      })),
      needsManualReview,
      note:
        'Lecture seule. Valider les réécritures (from → to) puis lancer ' +
        'migrations/normalizeCompanyDomains:apply. Les entrées ' +
        'needsManualReview ne sont pas touchées (domaine illisible).',
    }
  },
})

// ─── apply — writes the cleaned domains, idempotent ──────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { toFix, needsManualReview } = await resolve(ctx)
    for (const f of toFix) {
      await ctx.db.patch('companies', f.company._id, { domain: f.to })
    }
    return {
      fixed: toFix.length,
      needsManualReviewCount: needsManualReview.length,
      note:
        'Domaines nettoyés (logos + enrichissement débloqués). Relancer ' +
        'ensuite migrations/backfillCompanyEnrichment:dryRun.',
    }
  },
})

// ─── report — post-apply: what still isn't a clean bare domain ───────────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, needsManualReview } = await resolve(ctx)
    return {
      stillToFix: toFix.length,
      needsManualReviewCount: needsManualReview.length,
      needsManualReview,
      note:
        toFix.length === 0
          ? 'Tous les domaines réductibles sont propres. needsManualReview = à corriger à la main.'
          : 'Des domaines restent à normaliser — relancer apply.',
    }
  },
})
