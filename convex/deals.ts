import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  couponPeriodicityValidator,
  fundTypeValidator,
  propertyTypeValidator,
  repaymentModalityValidator,
  roundTypeValidator,
  safeTypeValidator,
  instrumentValidator as sharedInstrumentValidator,
  termDurationValidator,
} from './lib/instruments'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const statusValidator = v.union(
  v.literal('active'),
  v.literal('partially_exited'),
  v.literal('fully_exited'),
  v.literal('written_off'),
)

// Single source of truth: convex/lib/instruments.ts
const instrumentValidator = sharedInstrumentValidator

/** Shared financial/lifecycle fields, all optional. */
const dealFields = {
  // Custom name — shown instead of the derived title when present.
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

  // Instrument-archetype fields (dashboard refonte) — editable from the deal
  // sheet (Lot 3). Same columns as the schema; validators from lib/instruments.
  roundType: v.optional(roundTypeValidator),
  preMoneyValuation: v.optional(v.number()), // cents
  postMoneyValuation: v.optional(v.number()), // cents
  ownershipPct: v.optional(v.number()), // bps
  safeType: v.optional(safeTypeValidator),
  conversionDeadlineDate: v.optional(v.number()), // ms
  conversionValuation: v.optional(v.number()), // cents
  couponPeriodicity: v.optional(couponPeriodicityValidator),
  repaymentModality: v.optional(repaymentModalityValidator),
  termDuration: v.optional(termDurationValidator),
  bankName: v.optional(v.string()),
  fundType: v.optional(fundTypeValidator),
  vintageYear: v.optional(v.number()),
  managementCompany: v.optional(v.string()),
  underlyingTarget: v.optional(v.string()),
  spvOwnershipPct: v.optional(v.number()), // bps
  structuringFees: v.optional(v.number()), // cents
  spvName: v.optional(v.string()),
  amountRaised: v.optional(v.number()), // cents
  managementFeeRate: v.optional(v.number()), // bps
  hurdleRate: v.optional(v.number()), // bps
  carriedRate: v.optional(v.number()), // bps
  distributionRate: v.optional(v.number()), // bps
  enjoymentDelayMonths: v.optional(v.number()),
  acquisitionFees: v.optional(v.number()), // cents
  surfaceSqm: v.optional(v.number()),
  location: v.optional(v.string()),
  propertyType: v.optional(propertyTypeValidator),
  rentReceived: v.optional(v.number()), // cents
  currentValue: v.optional(v.number()), // cents

  // BSA (warrants) — own config, split from safe
  grantDate: v.optional(v.number()), // ms
  warrantsCount: v.optional(v.number()),
  warrantPrice: v.optional(v.number()), // cents
  strikePrice: v.optional(v.number()), // cents
  warrantParity: v.optional(v.number()), // decimal
  exerciseDeadlineDate: v.optional(v.number()), // ms

  // OC (convertible bond) — own config, split from safe
  conversionRatio: v.optional(v.number()), // decimal
  conversionDiscount: v.optional(v.number()), // bps
}

function companyRef(c: Doc<'companies'> | null) {
  if (!c) return null
  return {
    _id: c._id,
    name: c.name,
    kind: c.kind,
    sector: c.sector ?? null,
    domain: c.domain ?? null,
    totalShares: c.totalShares ?? null,
  }
}

/** Enriches a deal with investor / target / spv (for the view). */
async function enrich(ctx: Ctx, deal: Doc<'deals'>) {
  const [investor, target, spv] = await Promise.all([
    ctx.db.get("companies", deal.investorCompanyId),
    ctx.db.get("companies", deal.targetCompanyId),
    deal.viaSpvCompanyId ? ctx.db.get("companies", deal.viaSpvCompanyId) : null,
  ])
  return {
    ...deal,
    investor: companyRef(investor),
    target: companyRef(target),
    spv: companyRef(spv),
  }
}

/**
 * Sums of the transactions attached to a deal (cents): Versé (paid) =
 * outflows, Reçu (received) = inflows, never netted. Same definition as
 * the detail page (transactions.listByDeal + client-side reduce).
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

/** Latest known valuation of a deal (cents), null if none. */
export async function lastValuationCents(
  ctx: Ctx,
  dealId: Id<'deals'>,
): Promise<number | null> {
  const last = await ctx.db
    .query('valuations')
    .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
    .order('desc')
    .first()
  return last?.fairValue ?? null
}

/**
 * Enriched list of an org's deals (deal + investor/target/spv names),
 * filterable by status / target. Serves the per-org Participations view
 * (grouped by company client-side). Default sort: signedDate desc.
 * Includes per deal the Versé/Reçu amounts computed from the transactions
 * and the latest known valuation (TVPI computed client-side).
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
        lastValuationCents: await lastValuationCents(ctx, d._id),
      })),
    )
  },
})

/**
 * Lightweight org deals for pickers (pointage combobox, re-match sheet):
 * ids + display names only. Unlike `list`, reads NO transactions and NO
 * valuations — so pointage writes never invalidate it, and subscribing
 * pages don't pay the per-deal enrichment.
 */
export const listOptions = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    const rows = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    rows.sort((a, b) => (b.signedDate ?? 0) - (a.signedDate ?? 0))

    // One indexed read of the org's companies instead of two gets per deal.
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const companiesById = new Map(companies.map((c) => [c._id, c]))
    const nameRef = (id: Id<'companies'>) => {
      const company = companiesById.get(id)
      return company ? { name: company.name } : null
    }

    return rows.map((d) => ({
      _id: d._id,
      name: d.name ?? null,
      instrumentKind: d.instrumentKind,
      target: nameRef(d.targetCompanyId),
      investor: nameRef(d.investorCompanyId),
    }))
  },
})

export const getById = query({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const deal = await ctx.db.get("deals", id)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    return await enrich(ctx, deal)
  },
})

/** Checks that a company indeed belongs to the org. */
async function assertSameOrg(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  code: string,
) {
  const c = await ctx.db.get("companies", companyId)
  if (!c || c.orgId !== orgId) throw new ConvexError(code)
}

/**
 * A deal's investor is always a group entity (`group_*`), never a
 * portfolio company. (Replaces the old scope derivation.)
 */
async function assertInvestorIsGroupEntity(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  investorCompanyId: Id<'companies'>,
) {
  const c = await ctx.db.get("companies", investorCompanyId)
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
    const deal = await ctx.db.get("deals", id)
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
    // Name: trimmed; '' = clears it (display falls back to derived title).
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      patch.name = trimmed === '' ? undefined : trimmed
    }
    // Mark every patched field as manually edited so the Airtable re-import
    // (upsertDeals) leaves these columns untouched. Uniform on write: the set
    // grows with whatever the caller patched; the import only consults it for
    // the columns it actually writes (cf. KNOWN_ISSUES « Édition manuelle deals »).
    const editedFields = new Set(deal.manuallyEditedFields ?? [])
    for (const key of Object.keys(patch)) editedFields.add(key)
    await ctx.db.patch("deals", id, {
      ...patch,
      manuallyEditedFields: [...editedFields],
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const deal = await ctx.db.get("deals", id)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)
    // Hard delete is only safe with no reconciled transaction attached
    // (invariant: matched ⟺ dealId). Refuse otherwise to avoid orphans.
    const linked = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', id))
      .first()
    if (linked) throw new ConvexError('deal_has_transactions')
    await ctx.db.delete("deals", id)
    return { deletedId: id }
  },
})
