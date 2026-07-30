/**
 * One-shot normalisation of `companies.sector` onto the reduced taxonomy
 * (cf. `lib/sectors.ts`), all orgs, archived entities included.
 *
 * Two things were wrong before this pass, and they need two different fixes:
 *
 *  - Per-entity decisions (ALBO). Some corrections cannot be derived from the
 *    stored value: `services` became `industry` for Reekom but `silver` for
 *    Tango and Auxicare; `Retail` became `agrifood` for the La Vie de Quartier
 *    lines but the generic reading of "retail" is `consumer`. These 18 rows are
 *    listed in `DECISIONS`, anchored by prod `_id` with a name guard (same
 *    pattern as the other Albo migrations), and take precedence.
 *  - Value-level aliases (everything else). Free-typed and legacy values with
 *    one unambiguous reading — casing slips (`Mobility`), Attio wording
 *    (`Agritech`, `Circular Economy`), vehicle labels (`Start-up Studio`), the
 *    two Calte real-estate strings. Applied to any company not covered by a
 *    decision, which is how archived entities get cleaned up too.
 *
 * Anything left — a value that is neither a valid slug, nor a decision, nor an
 * unambiguous alias — is REPORTED, not rewritten. Mapping an unknown sector to
 * `other` would silently destroy the only information it carries, and an
 * unrecognised value still displays verbatim in the UI meanwhile. `dryRun` and
 * `report` surface them under `needsManualReview`.
 *
 * Write semantics: patches only when the target differs from the stored value,
 * so re-running is a no-op. Non-destructive — never clears a sector.
 *
 * ⚠️ Run right after the deploy that ships the reduced list: until it has run,
 * the entities still carrying `climate` / `services` / a free value display
 * that raw string instead of a translated label.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/normalizeSectors:dryRun
 *   # STOP: eyeball the before→after list, then:
 *   pnpm exec convex run --prod migrations/normalizeSectors:apply
 *   pnpm exec convex run --prod migrations/normalizeSectors:report
 */
import { internalMutation, internalQuery } from '../_generated/server'
import { isSectorSlug } from '../lib/sectors'
import type { SectorSlug } from '../lib/sectors'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Per-entity corrections (org ALBO), anchored by prod `_id` + name guard. */
const DECISIONS: Array<{
  companyId: string
  expectedName: string
  to: SectorSlug
}> = [
  // `services` was a catch-all: it held an industrial subcontractor and two
  // silver-economy care providers.
  { companyId: 'jx71fa19ezp2vzaaj0k09gkmzn87rq97', expectedName: 'Reekom', to: 'industry' },
  { companyId: 'jx79jwd3y9rmsakghwagm48st187skyz', expectedName: 'Tango', to: 'silver' },
  { companyId: 'jx75dbb7q4zp0p1234ayc6zy8187wq18', expectedName: 'Auxicare', to: 'silver' },
  // Free-typed `Agritech`: farm software is agrifood, ecological-offset land
  // sourcing has no listed vertical → horizontal software.
  { companyId: 'jx77vx2npwy75w80xdmcgrs04987s3ea', expectedName: 'Cockpit Agriculture', to: 'agrifood' },
  { companyId: 'jx71te1271bdq9qt5qpny56zw187rz88', expectedName: 'Versant', to: 'saas' },
  // Free-typed `Retail`: fresh-food shops, sold to eaters → agrifood.
  { companyId: 'jx7agg7khvm20qt2pryer2rxb987r8w5', expectedName: 'La vie de Quartier - Holding', to: 'agrifood' },
  { companyId: 'jx7332wvprgbtksfsnsnbvd35d8990c2', expectedName: 'La Vie de Quartier - Rue du RDV', to: 'agrifood' },
  { companyId: 'jx74e2822v5aazcewpmy94bhb1898xv0', expectedName: 'La Vie de Quartier - Rue St Maur', to: 'agrifood' },
  { companyId: 'jx720ph745f5wx0ba2nchad8xd89kjfv', expectedName: 'La Vie de Quartier - Bdv Voltaire', to: 'agrifood' },
  // `industry` split: the two scientific-breakthrough plays move to deeptech,
  // `industry` keeps production and circular economy.
  { companyId: 'jx78rdch9avsme496sqg8pw88x87rchk', expectedName: 'Wandercraft', to: 'deeptech' },
  { companyId: 'jx7d25nz1ed4q0p9xd875py76587r4g3', expectedName: 'Genomines', to: 'deeptech' },
  // `climate` removed (rule 4): each line returns to the market it sells to.
  { companyId: 'jx7f66x612xx0zrzce4k41a9rh87shkp', expectedName: 'CarbonFarm', to: 'agrifood' },
  { companyId: 'jx72bsqr4wr6j5wqzeb2zbwkex87s6tx', expectedName: 'Upcyclea', to: 'realestate' },
  // Casing slip on an existing slug.
  { companyId: 'jx7fgc6r15rydb31jpn4jyvc6x88dkmp', expectedName: 'Wheelee - Loewi', to: 'mobility' },
  // Refurbished office furniture: distribution, not industrial reconditioning.
  { companyId: 'jx7fda6mb1dmpej8zaq9tzy6gd8a7nzw', expectedName: 'Redesk', to: 'consumer' },
  // Rule 1 — three one-off vehicle labels collapse into `fund`; the vehicle
  // itself is already described by the deal instrument (fund_lp/carry_vehicle).
  { companyId: 'jx70wzjrfpp4cfn1aq9ex127qd8ada3z', expectedName: 'Hexa', to: 'fund' },
  { companyId: 'jx7fm5rmj0s4k4bj6sfr4zkecd8ajxt9', expectedName: 'Marble', to: 'fund' },
  { companyId: 'jx75rezn2rwshzyn7k2s3tq70d88pv9q', expectedName: 'Oprtrs & Co', to: 'fund' },
]

/** Values with a single unambiguous reading, keyed by lowercased sector. */
const VALUE_ALIASES: Record<string, SectorSlug | undefined> = {
  agritech: 'agrifood',
  retail: 'consumer',
  'circular economy': 'industry',
  'start-up studio': 'fund',
  'startup studio': 'fund',
  'carried interest structure': 'fund',
  'climate tech / fund': 'fund',
  immobilier: 'realestate',
  'promotion immobilière': 'realestate',
}

type Resolved = {
  toFix: Array<{
    company: Doc<'companies'>
    orgSlug: string
    from: string
    to: SectorSlug
    via: 'decision' | 'alias'
  }>
  /** Decision whose anchor no longer matches the entity found at that id. */
  anchorMismatch: Array<{ companyId: string; expected: string; found: string }>
  needsManualReview: Array<{ orgSlug: string; name: string; sector: string }>
  alreadyClean: number
}

async function resolve(ctx: Ctx): Promise<Resolved> {
  const decisionById = new Map(DECISIONS.map((d) => [d.companyId, d]))
  const orgs = await ctx.db.query('organizations').collect()
  const toFix: Resolved['toFix'] = []
  const anchorMismatch: Resolved['anchorMismatch'] = []
  const needsManualReview: Resolved['needsManualReview'] = []
  let alreadyClean = 0

  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const company of companies) {
      const current = company.sector?.trim()
      if (!current) continue

      const decision = decisionById.get(company._id)
      if (decision) {
        // Guard: the id is a prod anchor — if the entity behind it is not the
        // one the decision was taken on, skip rather than mis-tag it.
        if (company.name !== decision.expectedName) {
          anchorMismatch.push({
            companyId: decision.companyId,
            expected: decision.expectedName,
            found: company.name,
          })
          continue
        }
        if (current === decision.to) {
          alreadyClean++
          continue
        }
        toFix.push({
          company,
          orgSlug: org.slug,
          from: current,
          to: decision.to,
          via: 'decision',
        })
        continue
      }

      if (isSectorSlug(current)) {
        alreadyClean++
        continue
      }

      const alias = VALUE_ALIASES[current.toLowerCase()]
      if (alias) {
        toFix.push({
          company,
          orgSlug: org.slug,
          from: current,
          to: alias,
          via: 'alias',
        })
        continue
      }

      needsManualReview.push({
        orgSlug: org.slug,
        name: company.name,
        sector: current,
      })
    }
  }
  return { toFix, anchorMismatch, needsManualReview, alreadyClean }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, anchorMismatch, needsManualReview, alreadyClean } =
      await resolve(ctx)
    return {
      toFixCount: toFix.length,
      alreadyClean,
      anchorMismatch,
      needsManualReviewCount: needsManualReview.length,
      toFix: toFix.map((f) => ({
        org: f.orgSlug,
        name: f.company.name,
        from: f.from,
        to: f.to,
        via: f.via,
      })),
      needsManualReview,
      note:
        'Lecture seule. Valider les réécritures (from → to) puis lancer ' +
        'migrations/normalizeSectors:apply. Les entrées needsManualReview ne ' +
        'sont pas touchées (valeur sans lecture unique) — les arbitrer à la ' +
        'main depuis la fiche société.',
    }
  },
})

// ─── apply — writes the normalised sectors, idempotent ───────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { toFix, anchorMismatch, needsManualReview } = await resolve(ctx)
    for (const f of toFix) {
      await ctx.db.patch('companies', f.company._id, { sector: f.to })
    }
    return {
      fixed: toFix.length,
      byDecision: toFix.filter((f) => f.via === 'decision').length,
      byAlias: toFix.filter((f) => f.via === 'alias').length,
      anchorMismatch,
      needsManualReviewCount: needsManualReview.length,
      note: 'Secteurs normalisés. Vérifier avec migrations/normalizeSectors:report.',
    }
  },
})

// ─── report — post-apply: what is still off the canonical list ───────────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, anchorMismatch, needsManualReview, alreadyClean } =
      await resolve(ctx)
    return {
      stillToFix: toFix.length,
      alreadyClean,
      anchorMismatch,
      needsManualReviewCount: needsManualReview.length,
      needsManualReview,
      note:
        toFix.length === 0
          ? 'Toutes les valeurs mappables sont sur la liste canonique. needsManualReview = à arbitrer à la main.'
          : 'Des secteurs restent à normaliser — relancer apply.',
    }
  },
})
