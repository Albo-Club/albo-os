/**
 * Which sub-sections of Investissements an org shows (SPEC D37, revised).
 *
 * The rules live in `lib/modules.ts` and are shared with the front; this
 * file only answers « does this org hold anything under that sub-section? »
 * and stores the hand-made choice. Since the platform stopped being modular,
 * there are three probes left — the sidebar entries are always shown.
 *
 * The probes are all `.first()` — an existence question, never a count. A
 * sub-section does not need to know how much it holds to know that it holds
 * something.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { isTreasuryPlacement } from './lib/instrumentMapping'
import { ALL_MODULES, isModuleKey } from './lib/modules'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { ModuleKey, ModuleState } from './lib/modules'

/** The org's deals, read at most once per `list` call. */
type DealsReader = () => Promise<Array<Doc<'deals'>>>

/**
 * Memoizes the org's deals for the duration of one `list` call.
 *
 * Deals are the one table a probe cannot answer with `.first()`: whether the
 * Entreprises sub-section holds something depends on the INSTRUMENT of each
 * deal, so the rows have to be read. Both `entreprises` and `placements` need
 * them, so reading them per probe meant reading the whole table twice for one
 * answer, on every navigation — the query re-runs on each.
 */
function dealsReader(ctx: QueryCtx, orgId: Id<'organizations'>): DealsReader {
  let pending: Promise<Array<Doc<'deals'>>> | null = null
  return () => {
    pending ??= ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return pending
  }
}

/** Does this org hold at least one row of the given module? */
async function probe(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  key: ModuleKey,
  deals: DealsReader,
): Promise<boolean> {
  switch (key) {
    case 'entreprises': {
      // A portfolio company, or a deal that is not a treasury placement.
      // The group's own entities do not count: every org has a root, and it
      // would make the sub-section permanently non-empty.
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', orgId).eq('kind', 'portfolio'),
        )
        .first()
      if (companies) return true
      return (await deals()).some(
        (deal) => !isTreasuryPlacement(deal.instrumentKind),
      )
    }
    case 'placements':
      return (await deals()).some((deal) =>
        isTreasuryPlacement(deal.instrumentKind),
      )
    case 'immobilier':
      return (
        (await ctx.db
          .query('properties')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .first()) !== null
      )
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

    // One reader shared by every probe of this call — see `dealsReader`.
    const deals = dealsReader(ctx, orgId)
    const states: Array<ModuleState> = []
    for (const key of ALL_MODULES) {
      states.push({
        key,
        hasContent: await probe(ctx, orgId, key, deals),
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
