/**
 * Near-duplicate detection for the MCP write tools (convex/mcp/registry.ts).
 *
 * Those tools write straight to the DB: unlike the in-app chat agent, there
 * is no `needsApproval` round-trip through the UI. So a creation NEVER blocks
 * on a lookalike — it warns. The mutation returns the matches next to the row
 * it created, the MCP client surfaces them, the user arbitrates.
 *
 * The one hard constraint stays where it already lives: SIREN uniqueness
 * (`assertSirenFree`, convex/companies.ts) is a data invariant of the app, not
 * a warning, and the MCP path must not open a back door around it.
 */

import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * Legal suffixes stripped before comparing two company names, so that
 * "Sezame" and "Sezame SAS" collide. Deliberately not exhaustive: the goal is
 * to raise a warning, not to decide.
 */
const LEGAL_SUFFIXES = new Set([
  'sas',
  'sasu',
  'sarl',
  'eurl',
  'sa',
  'sci',
  'scp',
  'snc',
  'sca',
  'ltd',
  'limited',
  'llc',
  'inc',
  'corp',
  'gmbh',
  'ag',
  'bv',
  'nv',
  'spa',
  'srl',
  'plc',
])

/**
 * Comparison key for a company name: accents dropped, punctuation flattened,
 * legal suffix removed. "Sezame S.A.S." and "sezame" share a key.
 */
export function normalizeCompanyName(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Dots go first: "S.A.S." must fold to one token, not three letters that
      // no longer look like a legal suffix.
      .replace(/\./g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((word) => word !== '' && !LEGAL_SUFFIXES.has(word))
      .join(' ')
  )
}

export type CompanyMatch = {
  _id: Id<'companies'>
  name: string
  domain: string | null
  /** Why it looks like a duplicate — the user needs to know which signal fired. */
  reason: 'domain' | 'name'
}

/**
 * Companies of the org that look like the one being created: same normalized
 * domain, or same normalized name. Archived companies are ignored.
 */
export async function findSimilarCompanies(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  candidate: { name: string; domain?: string; excludeId?: Id<'companies'> },
): Promise<Array<CompanyMatch>> {
  const nameKey = normalizeCompanyName(candidate.name)
  const domainKey = candidate.domain?.trim().toLowerCase()
  if (nameKey === '' && !domainKey) return []

  const rows = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()

  const matches: Array<CompanyMatch> = []
  for (const row of rows) {
    if (row.archivedAt) continue
    if (candidate.excludeId && row._id === candidate.excludeId) continue
    const rowDomain = row.domain?.trim().toLowerCase()
    // Domain first: it is the stronger signal, and a row must only appear once.
    const reason =
      domainKey && rowDomain && rowDomain === domainKey
        ? 'domain'
        : nameKey !== '' && normalizeCompanyName(row.name) === nameKey
          ? 'name'
          : null
    if (reason) {
      matches.push({
        _id: row._id,
        name: row.name,
        domain: row.domain ?? null,
        reason,
      })
    }
  }
  return matches
}

export type DealMatch = {
  _id: Id<'deals'>
  instrumentKind: string
  committedAmount: number | null
  signedDate: number | null
}

/**
 * Existing deals of the org between the same investor and the same target.
 *
 * Always a warning, never a block: a follow-on on a company we already back
 * (a bridge then the equity round) is a legitimate second deal — sometimes on
 * the very same instrument. Only the user can tell that apart from a
 * double entry.
 */
export async function findSimilarDeals(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  candidate: {
    investorCompanyId: Id<'companies'>
    targetCompanyId: Id<'companies'>
    excludeId?: Id<'deals'>
  },
): Promise<Array<DealMatch>> {
  const rows = await ctx.db
    .query('deals')
    .withIndex('by_org_target', (q) =>
      q.eq('orgId', orgId).eq('targetCompanyId', candidate.targetCompanyId),
    )
    .collect()

  return rows
    .filter(
      (row) =>
        row.investorCompanyId === candidate.investorCompanyId &&
        row._id !== candidate.excludeId,
    )
    .map((row) => ({
      _id: row._id,
      instrumentKind: row.instrumentKind,
      committedAmount: row.committedAmount ?? null,
      signedDate: row.signedDate ?? null,
    }))
}
