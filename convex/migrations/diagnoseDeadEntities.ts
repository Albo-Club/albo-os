/**
 * READ-ONLY diagnostic — no writes, ever.
 *
 * Measures the exact scope of "dead" portfolio entities (no deal points at
 * them) on both orgs, to prepare a future cleanup (Lot 2). This module is an
 * `internalQuery` only — Convex queries CANNOT write, so running it (even with
 * `--prod`) mutates nothing:
 *
 *   pnpm exec convex run --prod migrations/diagnoseDeadEntities:dryRun
 *
 * Nothing here decides a deletion. Entities are matched to deals strictly by
 * ID (target / investor / viaSpv) — never by name, because exact-name twins
 * exist (RDB, COEUR PIGALLE…) and would fool a name match. The `isLikelyShell`
 * flag and the duplicate report are heuristics to triage by eye. `group_*`
 * entities (the legal entities of the org: CALTE, SCIs…) are NEVER cleanup
 * candidates — they are listed apart as protected.
 */
import { ConvexError } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel>

/** The two investment vehicles (one Better Auth org each). */
const ORG_SLUGS = ['albo', 'calte'] as const

async function getOrgBySlug(ctx: Ctx, slug: string) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${slug}`)
  return org
}

/** `group_*` = legal entity of the org (protected, never a cleanup candidate). */
const isGroupKind = (kind: Doc<'companies'>['kind']) => kind.startsWith('group_')

/** True when the field actually holds a value (treats ''/whitespace as empty). */
const filled = (v: unknown) =>
  v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')

/**
 * Prefix of an Airtable anchor, to tell a migration shell from a hand import.
 * `split:attio:{id}` → "split:attio" ; a raw `rec…` id → null (Airtable import).
 */
function airtableIdPrefix(airtableId: string | undefined): string | null {
  if (!airtableId) return null
  const idx = airtableId.lastIndexOf(':')
  return idx === -1 ? null : airtableId.slice(0, idx)
}

/** Identity + provenance detail of one portfolio entity with no deal. */
function deadEntityRow(c: Doc<'companies'>) {
  const identityFilled = {
    siren: filled(c.siren),
    legalName: filled(c.legalName),
    legalForm: filled(c.legalForm),
    domain: filled(c.domain),
    sector: filled(c.sector),
    countryCode: filled(c.countryCode),
    incorporationDate: filled(c.incorporationDate),
    totalShares: filled(c.totalShares),
  }
  return {
    companyId: c._id,
    name: c.name,
    kind: c.kind,
    archived: c.archivedAt != null,
    archivedAt: c.archivedAt ?? null,
    createdAt: c._creationTime, // ms epoch
    // Identity (null when absent — the point of the check).
    identity: {
      siren: c.siren ?? null,
      legalName: c.legalName ?? null,
      legalForm: c.legalForm ?? null,
      domain: c.domain ?? null,
      sector: c.sector ?? null,
      countryCode: c.countryCode ?? null,
      incorporationDate: c.incorporationDate ?? null,
      totalShares: c.totalShares ?? null,
    },
    // "Shell or real entity?" — which identity fields are actually filled.
    identityFilled,
    // Provenance: distinguishes a migration shell from a hand-typed entity.
    provenance: {
      airtableId: c.airtableId ?? null,
      airtableIdPrefix: airtableIdPrefix(c.airtableId),
      attioCompanyId: c.attioCompanyId ?? null,
    },
    // Heuristic only — confirm by eye, never act on it.
    isLikelyShell: Object.values(identityFilled).every((v) => v === false),
  }
}

async function buildOrgReport(ctx: Ctx, slug: string) {
  const org = await getOrgBySlug(ctx, slug)

  const [companies, deals] = await Promise.all([
    ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect(),
  ])

  // Every company id referenced by ANY deal, via any of the three pointers.
  // Matching by ID is mandatory — exact-name twins exist and would fool a name
  // match.
  const referenced = new Set<string>()
  for (const d of deals) {
    referenced.add(d.targetCompanyId)
    referenced.add(d.investorCompanyId)
    if (d.viaSpvCompanyId) referenced.add(d.viaSpvCompanyId)
  }
  const hasDeal = (id: Id<'companies'>) => referenced.has(id)

  const groupEntities = companies.filter((c) => isGroupKind(c.kind))
  const portfolio = companies.filter((c) => c.kind === 'portfolio')
  const portfolioWithoutDeal = portfolio.filter((c) => !hasDeal(c._id))

  // ── Duplicate report ──────────────────────────────────────────────────────
  // Exact-name groups among portfolio entities; per occurrence, by ID, whether
  // it carries any deal. Reveals the "hidden twins" a name match would miss.
  const byName = new Map<string, Array<Doc<'companies'>>>()
  for (const c of portfolio) {
    const bucket = byName.get(c.name) ?? []
    bucket.push(c)
    byName.set(c.name, bucket)
  }
  const exactNameGroups = [...byName.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([name, bucket]) => ({
      name,
      occurrences: bucket.map((c) => ({
        companyId: c._id,
        archived: c.archivedAt != null,
        hasDeals: hasDeal(c._id),
      })),
    }))

  // Portfolio entities whose exact name collides with a protected group_*
  // entity of the same org (import copies: CALTIMO, RDB, SCI CHAPELLE…).
  const groupNames = new Map<string, Array<Doc<'companies'>>>()
  for (const g of groupEntities) {
    const bucket = groupNames.get(g.name) ?? []
    bucket.push(g)
    groupNames.set(g.name, bucket)
  }
  const portfolioMatchingGroupName = portfolio
    .filter((c) => groupNames.has(c.name))
    .map((c) => ({
      name: c.name,
      portfolio: {
        companyId: c._id,
        archived: c.archivedAt != null,
        hasDeals: hasDeal(c._id),
      },
      groupEntities: (groupNames.get(c.name) ?? []).map((g) => ({
        companyId: g._id,
        kind: g.kind,
        archived: g.archivedAt != null,
      })),
    }))

  return {
    orgId: org._id,
    slug,
    summary: {
      totalEntities: companies.length, // archived included — the point.
      groupEntities: groupEntities.length, // protected
      portfolioEntities: portfolio.length,
      portfolioWithoutDeal: portfolioWithoutDeal.length,
      archivedTotal: companies.filter((c) => c.archivedAt != null).length,
      archivedAmongPortfolioWithoutDeal: portfolioWithoutDeal.filter(
        (c) => c.archivedAt != null,
      ).length,
    },
    // group_* are legal entities — NEVER cleanup candidates. Listed apart.
    protectedGroupEntities: groupEntities.map((c) => ({
      companyId: c._id,
      name: c.name,
      kind: c.kind,
      archived: c.archivedAt != null,
    })),
    portfolioWithoutDeal: portfolioWithoutDeal.map(deadEntityRow),
    duplicates: {
      exactNameGroups,
      portfolioMatchingGroupName,
    },
  }
}

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs: Record<string, Awaited<ReturnType<typeof buildOrgReport>>> = {}
    for (const slug of ORG_SLUGS) {
      orgs[slug] = await buildOrgReport(ctx, slug)
    }
    return {
      readOnly: true,
      note: "Lecture seule — aucune écriture. Entités matchées par ID (jamais par nom). isLikelyShell, doublons et tri coquille/entité sont des heuristiques à confirmer à l'œil ; les group_* sont des entités juridiques protégées, jamais candidates au ménage.",
      orgs,
    }
  },
})
