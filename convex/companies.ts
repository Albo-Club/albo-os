import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { ensureGroupSettings } from './lib/groupSettings'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const kindValidator = v.union(
  v.literal('group_root'),
  v.literal('group_operating'),
  v.literal('group_sci'),
  v.literal('group_spv'),
  v.literal('group_manco'),
  v.literal('portfolio'),
)

/** Normalizes a typed SIREN: strips spaces. '' = clears the field.
 * Throws 'invalid_siren' if non-empty and ≠ 9 digits. */
function normalizeSiren(raw: string): string | undefined {
  const cleaned = raw.replace(/\s/g, '')
  if (cleaned === '') return undefined
  if (!/^\d{9}$/.test(cleaned)) throw new ConvexError('invalid_siren')
  return cleaned
}

/** Rejects a SIREN already used by another company of the org. */
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
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, { orgId, kind }) => {
    await requireOrgMember(ctx, orgId)
    const rows = kind
      ? await ctx.db
          .query('companies')
          .withIndex('by_org_kind', (q) =>
            q.eq('orgId', orgId).eq('kind', kind),
          )
          .collect()
      : await ctx.db
          .query('companies')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .collect()
    return rows.filter((c) => !c.archivedAt)
  },
})

export const getById = query({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const company = await ctx.db.get("companies", id)
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
    if (args.siren !== undefined) args.siren = normalizeSiren(args.siren)
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
      siren: v.optional(v.string()),
      countryCode: v.optional(v.string()),
      domain: v.optional(v.string()),
      legalForm: v.optional(v.string()),
      sector: v.optional(v.string()),
      totalShares: v.optional(v.number()),
      group: v.optional(v.string()),
      // Nature of a NEWLY created group (sponsor | group). Not a company
      // field — consumed by ensureGroupSettings, stripped before the patch.
      groupKind: v.optional(v.union(v.literal('sponsor'), v.literal('group'))),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const company = await ctx.db.get("companies", id)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)

    // Guardrail: never demote the org's root entity.
    if (company.kind === 'group_root' && patch.kind && patch.kind !== 'group_root') {
      throw new ConvexError('cannot_change_root_kind')
    }
    // SIREN: normalized (spaces stripped), '' = clears the field.
    if (patch.siren !== undefined) {
      patch.siren = normalizeSiren(patch.siren)
    }
    if (patch.siren) {
      await assertSirenFree(ctx, company.orgId, patch.siren, id)
    }
    // groupKind drives the group settings row, not the company; pull it out.
    const { groupKind, ...companyPatch } = patch
    // Group: trimmed; '' = removes from group. Assigning to a (new) group
    // ensures its settings row + stable slug exist. groupKind is honored only
    // when the group is created here (existing groups keep their kind).
    if (companyPatch.group !== undefined) {
      const trimmed = companyPatch.group.trim()
      companyPatch.group = trimmed === '' ? undefined : trimmed
      if (companyPatch.group)
        await ensureGroupSettings(ctx, company.orgId, companyPatch.group, groupKind)
    }
    await ctx.db.patch("companies", id, companyPatch)
    return id
  },
})
