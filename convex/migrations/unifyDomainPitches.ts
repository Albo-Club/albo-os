/**
 * One-shot unification of the pitch (`oneLiner` + `summary`) across entities
 * that share a `domain`, per org.
 *
 * Product rule (14/07/2026): same domain ⇒ same pitch. Going forward this is
 * kept by edit-propagation (companies.update) and by the enrichment reusing a
 * sibling's text (companyEnrichment). This migration fixes the EXISTING drift
 * — e.g. the four "La Vie de Quartier" entities each got a different
 * paraphrase from laviedequartier.fr.
 *
 * Canonical choice: the pair of the entity with the LONGEST summary in the
 * group (cf. lib/pitch.ts:pickCanonicalPitch). That pair is written to every
 * non-archived entity of the group (overwrite). Groups already identical, or
 * with no summary anywhere, are left untouched.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/unifyDomainPitches:dryRun
 *   # STOP: eyeball the chosen canonical per domain, then:
 *   pnpm exec convex run --prod migrations/unifyDomainPitches:apply
 *   pnpm exec convex run --prod migrations/unifyDomainPitches:report
 */
import { internalMutation, internalQuery } from '../_generated/server'
import { applyPitchToDomainGroup, pickCanonicalPitch } from '../lib/pitch'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

type Group = {
  orgSlug: string
  orgId: Id<'organizations'>
  domain: string
  members: Array<Doc<'companies'>>
  canonical: { oneLiner?: string; summary?: string }
}

/** Domain groups (≥2 members, a summary somewhere) not yet all identical. */
async function resolveGroups(ctx: Ctx): Promise<Array<Group>> {
  const orgs = await ctx.db.query('organizations').collect()
  const groups: Array<Group> = []
  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const byDomain = new Map<string, Array<Doc<'companies'>>>()
    for (const c of companies) {
      if (c.archivedAt != null || !c.domain) continue
      const list = byDomain.get(c.domain) ?? []
      list.push(c)
      byDomain.set(c.domain, list)
    }
    for (const [domain, members] of byDomain) {
      if (members.length < 2) continue
      const canonical = pickCanonicalPitch(members)
      if (!canonical) continue // no summary anywhere → nothing to unify
      const allIdentical = members.every(
        (m) =>
          m.oneLiner === canonical.oneLiner && m.summary === canonical.summary,
      )
      if (allIdentical) continue
      groups.push({ orgSlug: org.slug, orgId: org._id, domain, members, canonical })
    }
  }
  return groups
}

// ─── dryRun — read-only, shows the canonical chosen per domain ───────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const groups = await resolveGroups(ctx)
    return {
      groupCount: groups.length,
      entitiesAffected: groups.reduce((n, g) => n + g.members.length, 0),
      groups: groups.map((g) => ({
        org: g.orgSlug,
        domain: g.domain,
        members: g.members.map((m) => m.name),
        canonicalOneLiner: g.canonical.oneLiner ?? null,
        canonicalSummary: g.canonical.summary ?? null,
      })),
      note:
        'Lecture seule. Le canonique = résumé le plus long du groupe, appliqué ' +
        'à tous. Valider puis lancer migrations/unifyDomainPitches:apply.',
    }
  },
})

// ─── apply — overwrites each group with its canonical pitch ──────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const groups = await resolveGroups(ctx)
    let patched = 0
    for (const g of groups) {
      patched += await applyPitchToDomainGroup(
        ctx,
        g.orgId,
        g.domain,
        { oneLiner: g.canonical.oneLiner, summary: g.canonical.summary },
        'overwrite',
      )
    }
    return { groupsUnified: groups.length, entitiesPatched: patched }
  },
})

// ─── report — post-apply: groups still divergent (should be none) ────────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const groups = await resolveGroups(ctx)
    return {
      stillDivergent: groups.length,
      groups: groups.map((g) => ({
        org: g.orgSlug,
        domain: g.domain,
        members: g.members.map((m) => m.name),
      })),
      note:
        groups.length === 0
          ? 'Tous les groupes de même domaine ont un pitch identique.'
          : 'Groupes encore divergents — relancer apply.',
    }
  },
})
