import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const statusValidator = v.union(
  v.literal('active'),
  v.literal('partially_exited'),
  v.literal('fully_exited'),
  v.literal('written_off'),
)

const instrumentValidator = v.union(
  v.literal('share'),
  v.literal('bsa'),
  v.literal('bsa_air'),
  v.literal('safe'),
  v.literal('oc'),
  v.literal('os'),
  v.literal('convertible_note'),
  v.literal('cca'),
  v.literal('royalty'),
  v.literal('fund_lp'),
  v.literal('spv_share'),
  v.literal('secondary'),
  v.literal('real_estate_direct'),
  v.literal('scpi'),
  v.literal('cto'),
  v.literal('dat'),
  v.literal('crypto'),
  v.literal('loan'),
  v.literal('capitalization_account'),
)

/** Champs financiers/lifecycle communs, tous optionnels. */
const dealFields = {
  // Nom personnalisé — affiché à la place du titre dérivé quand présent.
  name: v.optional(v.string()),
  viaSpvCompanyId: v.optional(v.id('companies')),
  currency: v.optional(v.string()),
  committedAmount: v.optional(v.number()),
  paidAmount: v.optional(v.number()),
  sharesAcquired: v.optional(v.number()),
  pricePerShare: v.optional(v.number()),
  interestRate: v.optional(v.number()),
  maturityDate: v.optional(v.number()),
  principalAmount: v.optional(v.number()),
  repaymentFrequencyMonths: v.optional(v.number()),
  royaltyRate: v.optional(v.number()),
  royaltyCapAmount: v.optional(v.number()),
  valuationCap: v.optional(v.number()),
  discount: v.optional(v.number()),
  entryValuation: v.optional(v.number()),
  roundSize: v.optional(v.number()),
  signedDate: v.optional(v.number()),
  closingDate: v.optional(v.number()),
  exitedDate: v.optional(v.number()),
  attioDealId: v.optional(v.string()),
  notes: v.optional(v.string()),
}

function companyRef(c: Doc<'companies'> | null) {
  if (!c) return null
  return {
    _id: c._id,
    name: c.name,
    kind: c.kind,
    sector: c.sector ?? null,
    totalShares: c.totalShares ?? null,
  }
}

/** Enrichit un deal avec investor / target / spv (pour la vue). */
async function enrich(ctx: Ctx, deal: Doc<'deals'>) {
  const [investor, target, spv] = await Promise.all([
    ctx.db.get(deal.investorCompanyId),
    ctx.db.get(deal.targetCompanyId),
    deal.viaSpvCompanyId ? ctx.db.get(deal.viaSpvCompanyId) : null,
  ])
  return {
    ...deal,
    investor: companyRef(investor),
    target: companyRef(target),
    spv: companyRef(spv),
  }
}

/**
 * Sommes des transactions rattachées à un deal (cents) : Versé = sorties,
 * Reçu = entrées, jamais nettés. Même définition que la page détail
 * (transactions.listByDeal + reduce côté client).
 */
export async function transactionTotals(ctx: Ctx, dealId: Id<'deals'>) {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .collect()
  let paidActual = 0
  let received = 0
  for (const tx of txs) {
    if (tx.direction === 'out') paidActual += tx.amount
    else received += tx.amount
  }
  return { paidActual, received }
}

/**
 * Liste enrichie des deals (deal + noms investor/target/spv) d'une org,
 * filtrable par status / target. Sert la vue Participations par-org
 * (regroupée par société côté client). Tri par défaut : signedDate desc.
 * Inclut par deal les montants Versé/Reçu calculés depuis les transactions.
 */
export const list = query({
  args: {
    orgId: v.id('organizations'),
    status: v.optional(statusValidator),
    targetCompanyId: v.optional(v.id('companies')),
  },
  handler: async (ctx, { orgId, status, targetCompanyId }) => {
    await requireOrgMember(ctx, orgId)

    let rows: Array<Doc<'deals'>>
    if (targetCompanyId) {
      rows = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', orgId).eq('targetCompanyId', targetCompanyId),
        )
        .collect()
    } else {
      rows = await ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
    }
    if (status) rows = rows.filter((d) => d.status === status)

    rows.sort((a, b) => (b.signedDate ?? 0) - (a.signedDate ?? 0))
    return await Promise.all(
      rows.map(async (d) => ({
        ...(await enrich(ctx, d)),
        ...(await transactionTotals(ctx, d._id)),
      })),
    )
  },
})

export const getById = query({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const deal = await ctx.db.get(id)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    return await enrich(ctx, deal)
  },
})

/** Vérifie qu'une company appartient bien à l'org. */
async function assertSameOrg(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  code: string,
) {
  const c = await ctx.db.get(companyId)
  if (!c || c.orgId !== orgId) throw new ConvexError(code)
}

/**
 * L'investisseur d'un deal est toujours une entité du groupe (`group_*`),
 * jamais une société portfolio. (Remplace l'ancienne dérivation de scope.)
 */
async function assertInvestorIsGroupEntity(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  investorCompanyId: Id<'companies'>,
) {
  const c = await ctx.db.get(investorCompanyId)
  if (!c || c.orgId !== orgId) throw new ConvexError('investor_wrong_org')
  if (!c.kind.startsWith('group_')) {
    throw new ConvexError('investor_must_be_group_entity')
  }
}

export const create = mutation({
  args: {
    orgId: v.id('organizations'),
    investorCompanyId: v.id('companies'),
    targetCompanyId: v.id('companies'),
    instrumentKind: instrumentValidator,
    status: v.optional(statusValidator),
    ...dealFields,
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    await assertSameOrg(
      ctx,
      args.orgId,
      args.targetCompanyId,
      'target_wrong_org',
    )
    if (args.viaSpvCompanyId) {
      await assertSameOrg(ctx, args.orgId, args.viaSpvCompanyId, 'spv_wrong_org')
    }
    await assertInvestorIsGroupEntity(ctx, args.orgId, args.investorCompanyId)

    const { status, currency, ...rest } = args
    return await ctx.db.insert('deals', {
      ...rest,
      currency: currency ?? 'EUR',
      status: status ?? 'active',
    })
  },
})

export const update = mutation({
  args: {
    id: v.id('deals'),
    patch: v.object({
      investorCompanyId: v.optional(v.id('companies')),
      targetCompanyId: v.optional(v.id('companies')),
      instrumentKind: v.optional(instrumentValidator),
      status: v.optional(statusValidator),
      ...dealFields,
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const deal = await ctx.db.get(id)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    if (patch.investorCompanyId) {
      await assertInvestorIsGroupEntity(
        ctx,
        deal.orgId,
        patch.investorCompanyId,
      )
    }
    if (patch.targetCompanyId) {
      await assertSameOrg(
        ctx,
        deal.orgId,
        patch.targetCompanyId,
        'target_wrong_org',
      )
    }
    // Nom : trim ; '' = effacement (l'affichage retombe sur le titre dérivé).
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      patch.name = trimmed === '' ? undefined : trimmed
    }
    await ctx.db.patch(id, patch)
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const deal = await ctx.db.get(id)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    await ctx.db.delete(id)
    return { deletedId: id }
  },
})
