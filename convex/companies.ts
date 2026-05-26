import { ConvexError, v } from 'convex/values'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const scopeValidator = v.union(v.literal('albo'), v.literal('calte'))

const kindValidator = v.union(
  v.literal('group_root'),
  v.literal('group_operating'),
  v.literal('group_sci'),
  v.literal('group_spv'),
  v.literal('group_manco'),
  v.literal('portfolio'),
)

/** Refuse un SIREN déjà porté par une autre company de l'org. */
async function assertSirenFree(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  siren: string,
  selfId?: Id<'companies'>,
) {
  const clash = await ctx.db
    .query('companies')
    .withIndex('by_org_siren', (q) => q.eq('orgId', orgId).eq('siren', siren))
    .first()
  if (clash && clash._id !== selfId) throw new ConvexError('siren_already_used')
}

export const list = query({
  args: {
    orgId: v.id('organizations'),
    scope: v.optional(scopeValidator),
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, { orgId, scope, kind }) => {
    await requireOrgMember(ctx, orgId)
    let rows
    if (kind) {
      rows = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) => q.eq('orgId', orgId).eq('kind', kind))
        .collect()
    } else if (scope) {
      rows = await ctx.db
        .query('companies')
        .withIndex('by_org_scope', (q) =>
          q.eq('orgId', orgId).eq('holdingScope', scope),
        )
        .collect()
    } else {
      rows = await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
    }
    return rows.filter((c) => !c.archivedAt)
  },
})

export const getById = query({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const company = await ctx.db.get(id)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    return company
  },
})

export const create = mutation({
  args: {
    orgId: v.id('organizations'),
    name: v.string(),
    kind: kindValidator,
    legalName: v.optional(v.string()),
    holdingScope: v.optional(scopeValidator),
    siren: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    domain: v.optional(v.string()),
    legalForm: v.optional(v.string()),
    sector: v.optional(v.string()),
    totalShares: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    if (args.siren) await assertSirenFree(ctx, args.orgId, args.siren)
    return await ctx.db.insert('companies', args)
  },
})

export const update = mutation({
  args: {
    id: v.id('companies'),
    patch: v.object({
      name: v.optional(v.string()),
      legalName: v.optional(v.string()),
      kind: v.optional(kindValidator),
      holdingScope: v.optional(scopeValidator),
      siren: v.optional(v.string()),
      countryCode: v.optional(v.string()),
      domain: v.optional(v.string()),
      legalForm: v.optional(v.string()),
      sector: v.optional(v.string()),
      totalShares: v.optional(v.number()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const company = await ctx.db.get(id)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    // Garde-fou : on ne change pas l'identité d'une racine de vue.
    if (company.kind === 'group_root') {
      if (patch.kind && patch.kind !== 'group_root') {
        throw new ConvexError('cannot_change_root_kind')
      }
      if (patch.holdingScope && patch.holdingScope !== company.holdingScope) {
        throw new ConvexError('cannot_change_root_scope')
      }
    }
    if (patch.siren) {
      await assertSirenFree(ctx, company.orgId, patch.siren, id)
    }
    await ctx.db.patch(id, patch)
    return id
  },
})
