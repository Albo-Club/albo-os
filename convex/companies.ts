import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { personValidator } from './lib/people'
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

/**
 * Incoming references that block archiving a company. Mirrors the one-shot
 * migration helper (splitAlboSponsorSpvs.ts) but ALSO counts deals where the
 * company is the target — archiving must refuse while any deal still points
 * to it (the Sezame case: reassign the deals first). No direct `companyId`
 * exists on transactions/valuations: they are reached via `dealId`
 * (covered by deals) and `bankAccountId` (covered by bankAccounts).
 */
async function listBlockingRefs(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
) {
  const [asTarget, asInvestor, asParent, asChild, kpis, accounts, docs, orgDeals] =
    await Promise.all([
      ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', orgId).eq('targetCompanyId', companyId),
        )
        .collect(),
      ctx.db
        .query('deals')
        .withIndex('by_org_investor', (q) =>
          q.eq('orgId', orgId).eq('investorCompanyId', companyId),
        )
        .collect(),
      ctx.db
        .query('companyRelations')
        .withIndex('by_parent', (q) =>
          q.eq('orgId', orgId).eq('parentCompanyId', companyId),
        )
        .collect(),
      ctx.db
        .query('companyRelations')
        .withIndex('by_child', (q) =>
          q.eq('orgId', orgId).eq('childCompanyId', companyId),
        )
        .collect(),
      ctx.db
        .query('kpiSnapshots')
        .withIndex('by_company_metric', (q) => q.eq('companyId', companyId))
        .collect(),
      ctx.db
        .query('bankAccounts')
        .withIndex('by_owner', (q) =>
          q.eq('orgId', orgId).eq('ownerCompanyId', companyId),
        )
        .collect(),
      ctx.db
        .query('documents')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .collect(),
      // No index on viaSpvCompanyId: scan the org's deals (low volume).
      ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
    ])
  return {
    dealsAsTarget: asTarget.length,
    dealsAsInvestor: asInvestor.length,
    dealsAsViaSpv: orgDeals.filter((d) => d.viaSpvCompanyId === companyId)
      .length,
    companyRelations: asParent.length + asChild.length,
    kpiSnapshots: kpis.length,
    bankAccounts: accounts.length,
    documents: docs.length,
  }
}

const hasBlockingRefs = (refs: Awaited<ReturnType<typeof listBlockingRefs>>) =>
  Object.values(refs).some((count) => count > 0)

/**
 * Archives a company (reversible soft delete: sets `archivedAt`). Refuses if
 * the entity is still referenced by any deal, relation, KPI, bank account or
 * document — reassign/empty it first. Idempotent: archiving an already
 * archived company is a no-op.
 */
export const archive = mutation({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const company = await ctx.db.get("companies", id)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    if (company.archivedAt != null) return id
    const refs = await listBlockingRefs(ctx, company.orgId, id)
    if (hasBlockingRefs(refs)) throw new ConvexError('company_has_references')
    await ctx.db.patch("companies", id, { archivedAt: Date.now() })
    return id
  },
})

/** Restores an archived company (clears `archivedAt`). Idempotent. */
export const restore = mutation({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const company = await ctx.db.get("companies", id)
    if (!company) throw new ConvexError('not_found')
    await requireOrgMember(ctx, company.orgId)
    await ctx.db.patch("companies", id, { archivedAt: undefined })
    return id
  },
})

/** Archived companies of the org (the regular queries filter them out). */
export const listArchived = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    return rows.filter((c) => c.archivedAt != null)
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
      notes: v.optional(v.string()),
      // Full replacement of the people list (founders/board/co-investors).
      // role is enforced by the validator; name is checked non-empty below.
      people: v.optional(v.array(personValidator)),
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
    // People: full-list replacement. Reject empty names before any write so
    // an invalid entry never produces a partial update. role is already
    // guaranteed valid by the Convex validator.
    if (patch.people) {
      for (const p of patch.people) {
        if (p.name.trim() === '') throw new ConvexError('invalid_person_name')
      }
    }
    // SIREN: normalized (spaces stripped), '' = clears the field.
    if (patch.siren !== undefined) {
      patch.siren = normalizeSiren(patch.siren)
    }
    if (patch.siren) {
      await assertSirenFree(ctx, company.orgId, patch.siren, id)
    }
    // Domain: trimmed; '' clears the field (mirror of SIREN behaviour).
    if (patch.domain !== undefined) {
      patch.domain = patch.domain.trim() || undefined
    }
    await ctx.db.patch("companies", id, patch)
    return id
  },
})
