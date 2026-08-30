/**
 * Which modules an org shows (SPEC D37).
 *
 * « Un module s'affiche s'il contient quelque chose, ou s'il a été activé à
 * la main. » Nothing is cached: what each module holds is probed on every
 * read, so a module appears the moment its first row exists and disappears
 * again if that row is removed — unless someone turned it on by hand.
 *
 * The probes are all `.first()` — an existence question, never a count. A
 * module does not need to know how much it holds to know that it holds
 * something.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { isTreasuryPlacement } from './lib/instrumentMapping'
import { ALL_MODULES, isModuleKey } from './lib/modules'

import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { ModuleKey, ModuleState } from './lib/modules'

/** Does this org hold at least one row of the given module? */
async function probe(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  key: ModuleKey,
): Promise<boolean> {
  const byOrg = (table: 'deals' | 'companies' | 'properties') =>
    ctx.db
      .query(table)
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .first()

  switch (key) {
    case 'entreprises': {
      // A portfolio company, or a deal that is not a treasury placement.
      // The group's own entities do not count: every org has a root, and it
      // would make the tab permanently non-empty.
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', orgId).eq('kind', 'portfolio'),
        )
        .first()
      if (companies) return true
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      return deals.some((deal) => !isTreasuryPlacement(deal.instrumentKind))
    }
    case 'placements': {
      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      return deals.some((deal) => isTreasuryPlacement(deal.instrumentKind))
    }
    case 'immobilier':
      return (await byOrg('properties')) !== null
    case 'investments':
      // The section shows as soon as ANY of its three tabs holds something.
      return (
        (await probe(ctx, orgId, 'entreprises')) ||
        (await probe(ctx, orgId, 'placements')) ||
        (await probe(ctx, orgId, 'immobilier'))
      )
    case 'cash':
      return (
        (await ctx.db
          .query('bankAccounts')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .first()) !== null
      )
    case 'passif': {
      // Anything the Passif page can show: bank debt, equity, a current
      // account on either side, or a security this org has pledged.
      const loan = await ctx.db
        .query('loans')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .first()
      if (loan) return true
      const equity = await ctx.db
        .query('equityPositions')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .first()
      if (equity) return true
      const from = await ctx.db
        .query('intercompanyLoans')
        .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
        .first()
      if (from) return true
      const to = await ctx.db
        .query('intercompanyLoans')
        .withIndex('by_to', (q) => q.eq('toOrgId', orgId))
        .first()
      if (to) return true
      const pledged = await ctx.db
        .query('guarantees')
        .withIndex('by_pledgor_org', (q) => q.eq('pledgorOrgId', orgId))
        .first()
      return pledged !== null
    }
  }
}

/**
 * The state of every module for this org: what it holds, and whether it was
 * turned on by hand. The front derives visibility from the pair — the rule
 * lives once, in `lib/modules.ts`, and both surfaces read it.
 */
export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const org = await ctx.db.get('organizations', orgId)
    const enabled = new Set(org?.enabledModules ?? [])

    const states: Array<ModuleState> = []
    for (const key of ALL_MODULES) {
      states.push({
        key,
        hasContent: await probe(ctx, orgId, key),
        enabled: enabled.has(key),
      })
    }
    return states
  },
})

/**
 * Turns a module on or off BY HAND — the ⋯ menu.
 *
 * Turning one off does not hide it while it holds something: the content
 * wins. That is deliberate — a module with rows in it must stay reachable,
 * or those rows would become invisible with no way back.
 */
export const setEnabled = mutation({
  args: {
    orgId: v.id('organizations'),
    module: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, { orgId, module, enabled }) => {
    await requireOrgMember(ctx, orgId)
    if (!isModuleKey(module)) throw new ConvexError('unknown_module')
    const org = await ctx.db.get('organizations', orgId)
    if (!org) throw new ConvexError('not_found')

    const current = new Set(org.enabledModules ?? [])
    if (enabled) current.add(module)
    else current.delete(module)
    // Stored in declaration order, and only known slugs survive: a module
    // retired from the code must not linger in production rows.
    await ctx.db.patch('organizations', orgId, {
      enabledModules: ALL_MODULES.filter((key) => current.has(key)),
    })
    return null
  },
})
