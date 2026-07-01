import { v } from 'convex/values'

import { query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { normalizeSearch } from './lib/searchText'
import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'

// Per-group result cap for the command palette. Kept small: the palette shows
// a few best matches per type, not an exhaustive list.
const GROUP_LIMIT = 8
// Below this length the query is too noisy to be useful — return nothing.
const MIN_TERM_LENGTH = 2

type Ctx = GenericQueryCtx<DataModel>

/**
 * Global search backing the ⌘K command palette, scoped to one org. Returns
 * three small, independent result groups — deals, companies and movements
 * (transactions) — so the UI can present them separately and let the user pick
 * whether they meant a company or a deal.
 *
 * Deals and companies are filtered in memory (low volumes); transactions use
 * the existing `search_text` full-text index (they can be numerous). Shapes are
 * intentionally light (enough to render a row and navigate) — no totals or
 * valuations are computed here.
 */
export const global = query({
  args: { orgId: v.id('organizations'), query: v.string() },
  handler: async (ctx: Ctx, { orgId, query: rawQuery }) => {
    await requireOrgMember(ctx, orgId)
    const term = normalizeSearch(rawQuery)
    if (term.length < MIN_TERM_LENGTH) {
      return { deals: [], companies: [], transactions: [] }
    }

    // Company names resolved once for the deal group (target + investor).
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const companyById = new Map<string, Doc<'companies'>>()
    for (const c of companies) companyById.set(c._id, c)

    // Companies group: non-archived, matched on name / legalName / sector /
    // siren / domain.
    const companyResults = companies
      .filter((c) => c.archivedAt == null)
      .filter((c) =>
        [c.name, c.legalName, c.sector, c.siren, c.domain].some(
          (s) => s && normalizeSearch(s).includes(term),
        ),
      )
      .slice(0, GROUP_LIMIT)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        kind: c.kind,
        sector: c.sector ?? null,
      }))

    // Deals group: matched on custom name, target/investor name, instrument and
    // notes.
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const dealResults = deals
      .map((d) => {
        const target = companyById.get(d.targetCompanyId)
        const investor = companyById.get(d.investorCompanyId)
        return { deal: d, target, investor }
      })
      .filter(({ deal, target, investor }) =>
        [
          deal.name,
          deal.notes,
          deal.instrumentKind,
          target?.name,
          investor?.name,
        ].some((s) => s && normalizeSearch(s).includes(term)),
      )
      .slice(0, GROUP_LIMIT)
      .map(({ deal, target, investor }) => ({
        _id: deal._id,
        name: deal.name ?? null,
        instrumentKind: deal.instrumentKind,
        targetName: target?.name ?? null,
        investorName: investor?.name ?? null,
      }))

    // Movements group: full-text index on the normalized transaction label.
    const txRows = await ctx.db
      .query('transactions')
      .withSearchIndex('search_text', (q) =>
        q.search('searchText', term).eq('orgId', orgId),
      )
      .take(GROUP_LIMIT)
    const transactionResults = txRows.map((tx) => ({
      _id: tx._id,
      label: tx.counterparty ?? tx.rawLabel,
      amount: tx.amount,
      direction: tx.direction,
      date: tx.transactionDate,
      dealId: tx.dealId ?? null,
    }))

    return {
      deals: dealResults,
      companies: companyResults,
      transactions: transactionResults,
    }
  },
})
