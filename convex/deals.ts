import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { deleteStorageText } from './lib/documentTexts'
import {
  couponPeriodicityValidator,
  fundTypeValidator,
  placementLiquidityValidator,
  propertyTypeValidator,
  repaymentModalityValidator,
  roundTypeValidator,
  safeTypeValidator,
  instrumentValidator as sharedInstrumentValidator,
  termDurationValidator,
} from './lib/instruments'
import { isTreasuryPlacement } from './lib/instrumentMapping'
import { listSilentCompanies, withReportAlerts } from './lib/reportFreshness'
import {
  moic as moicRatio,
  proceedsFromReceived,
  realizedCashflows,
  residualValueCents,
  tvpi as tvpiRatio,
} from './lib/metrics'
import { xirr } from './lib/xirr'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from './_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const statusValidator = v.union(
  v.literal('pending'), // Attio Term Sheet (committed, not yet wired)
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
  // Royalties custom panel (cf. schema.ts). The two lists are patched from
  // RoyaltiesPanel via deals.update — they are NOT in INSTRUMENT_FIELDS.
  capitalInvested: v.optional(v.number()), // cents
  depreciationRate: v.optional(v.number()), // bps
  bpPoints: v.optional(
    v.array(v.object({ quarter: v.string(), plannedRevenue: v.number() })),
  ),
  actualPoints: v.optional(
    v.array(v.object({ quarter: v.string(), actualRevenue: v.number() })),
  ),
  // Generic royalty contract parameters (cf. schema.ts). Floor/cap are
  // multiples of capitalInvested; the euro amount is derived at display.
  investmentDate: v.optional(v.number()), // ms
  royaltyStartDate: v.optional(v.number()), // ms — informational only
  floorMultiple: v.optional(v.number()), // decimal
  capMultiple: v.optional(v.number()), // decimal
  endDate: v.optional(v.number()), // ms
  valuationCap: v.optional(v.number()),
  discount: v.optional(v.number()),
  entryValuation: v.optional(v.number()),
  roundSize: v.optional(v.number()),
  signedDate: v.optional(v.number()),
  closingDate: v.optional(v.number()),
  exitedDate: v.optional(v.number()),
  exitProceeds: v.optional(v.number()), // cents — sale proceeds (exit)
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
  // Placement liquidity override; default derived from instrumentKind.
  liquidity: v.optional(placementLiquidityValidator),
  // The bank account backing a treasury placement — envelope link for
  // Powens Wealth positions.
  bankAccountId: v.optional(v.id('bankAccounts')),

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
    oneLiner: c.oneLiner ?? null,
    domain: c.domain ?? null,
    totalShares: c.totalShares ?? null,
  }
}

/**
 * Defensive read of the Cerveau 3 health score (`aiAnalysis` is `v.any()`:
 * the shape is enforced by the synthesis prompt, never by the schema).
 * Returns null unless a numeric `health_score.score` is present.
 */
export function aiHealthScore(aiAnalysis: unknown): number | null {
  const score = (
    aiAnalysis as { health_score?: { score?: unknown } } | null | undefined
  )?.health_score?.score
  return typeof score === 'number' ? score : null
}

/**
 * One indexed read of an org's `companyIntelligence` rows → companyId →
 * health score (1-10). Feeds the AI score column of the Participations
 * views (per-org and aggregated) without a per-deal read.
 */
export async function aiScoresByCompany(
  ctx: Ctx,
  orgId: Id<'organizations'>,
): Promise<Map<Id<'companies'>, number>> {
  const rows = await ctx.db
    .query('companyIntelligence')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  const map = new Map<Id<'companies'>, number>()
  for (const row of rows) {
    const score = aiHealthScore(row.aiAnalysis)
    if (score !== null) map.set(row.companyId, score)
  }
  return map
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

/**
 * Realized metrics of a single deal, transaction-true (reads the matched
 * transactions ONCE). Returns the Versé/Reçu totals, the realized MOIC and the
 * EXACT XIRR (annualized), plus the per-transaction dated `flows` (signed and
 * de-VAT'd via the shared convention) so consumers can build a company-level
 * IRR by concatenating the flows of a company's deals and solving `xirr` on the
 * union — IRR is not additive, so it can't be derived from the per-deal rates.
 * `irr` is null when the flow set has no sign change (e.g. a total loss with no
 * proceeds) or does not converge.
 */
export async function dealRealizedMetrics(ctx: Ctx, deal: Doc<'deals'>) {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', deal._id))
    .collect()
  let paidActual = 0
  let received = 0
  for (const tx of txs) {
    if (tx.direction === 'out') paidActual += tx.amount
    else received += tx.amount
  }
  const flows = realizedCashflows(
    txs.map((tx) => ({
      direction: tx.direction,
      amount: tx.amount,
      date: tx.transactionDate,
    })),
    deal.instrumentKind,
  )
  const moic = moicRatio({
    capital: paidActual,
    proceeds: proceedsFromReceived(received, deal.instrumentKind),
  })
  return { paidActual, received, flows, moic, irr: xirr(flows) }
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
 * Includes per deal the Versé/Reçu amounts, the realized MOIC + EXACT XIRR,
 * and the dated `flows` (so the view unions them per company for a company
 * IRR) computed from the transactions, plus the latest known valuation
 * (TVPI computed client-side from the aggregates).
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
    const aiScores = await aiScoresByCompany(ctx, orgId)
    return await Promise.all(
      rows.map(async (d) => {
        const enriched = await enrich(ctx, d)
        return {
          ...enriched,
          target: enriched.target && {
            ...enriched.target,
            aiScore: aiScores.get(d.targetCompanyId) ?? null,
          },
          ...(await dealRealizedMetrics(ctx, d)),
          lastValuationCents: await lastValuationCents(ctx, d._id),
        }
      }),
    )
  },
})

/**
 * One deal reduced to the inputs of the participations rows. Built by
 * `participationSource` (per-org and aggregated queries feed the same
 * builder); `org` is only set by the aggregated view.
 */
type ParticipationDealSource = {
  status: string
  instrumentKind: string
  name: string | null
  committedAmount: number | null
  signedDate: number | null
  targetCompanyId: Id<'companies'>
  target: { name: string; sector: string | null; domain: string | null } | null
  investorName: string | null
  aiScore: number | null
  paidActual: number
  received: number
  lastValuationCents: number | null
  flows: Array<{ amount: number; date: number }>
  org: { name: string; slug: string } | null
}

/** Builds one ParticipationDealSource (reads the deal's txs + last valuation). */
export async function participationSource(
  ctx: Ctx,
  deal: Doc<'deals'>,
  companiesById: Map<Id<'companies'>, Doc<'companies'>>,
  aiScores: Map<Id<'companies'>, number>,
  org: { name: string; slug: string } | null,
): Promise<ParticipationDealSource> {
  const target = companiesById.get(deal.targetCompanyId) ?? null
  const metrics = await dealRealizedMetrics(ctx, deal)
  return {
    status: deal.status,
    instrumentKind: deal.instrumentKind,
    name: deal.name ?? null,
    committedAmount: deal.committedAmount ?? null,
    signedDate: deal.signedDate ?? null,
    targetCompanyId: deal.targetCompanyId,
    target: target && {
      name: target.name,
      sector: target.sector ?? null,
      domain: target.domain ?? null,
    },
    investorName: companiesById.get(deal.investorCompanyId)?.name ?? null,
    aiScore: aiScores.get(deal.targetCompanyId) ?? null,
    paidActual: metrics.paidActual,
    received: metrics.received,
    lastValuationCents: await lastValuationCents(ctx, deal._id),
    flows: metrics.flows,
    org,
  }
}

/**
 * Server-side projection for the participations list: ONE row per company and
 * per bucket (pending TS vs active vs settled — mirroring the client-side
 * split into one table per status; a company holding e.g. a TS deal AND
 * active deals yields two rows, so each table's sums stay exact). Each row
 * carries only what the table displays (name/domain/sector/AI score + the
 * pre-aggregated sums and ratios) plus the per-deal facet values (instrument
 * kinds, statuses, deal/investor names) so the client search & filters keep
 * working — the full deal docs and dated flows never reach the client.
 *
 * Ratios follow the tables: TVPI on active rows (gross received, residual =
 * last valuation falling back to cost), MOIC (de-VAT'd proceeds) + exact XIRR
 * on the flow union for settled rows — IRR is not additive, so it is solved
 * here on the union, never derived from per-deal rates. Pending rows carry
 * the summed commitment instead (nothing is wired yet).
 *
 * Default order: most recent deal first (the pending TS rows live in their
 * own table, always rendered on top).
 */
export function buildParticipationRows(deals: Array<ParticipationDealSource>) {
  type Group = {
    companyId: Id<'companies'>
    name: string
    domain: string | null
    sector: string | null
    aiScore: number | null
    org: { name: string; slug: string } | null
    pending: boolean
    settled: boolean
    dealCount: number
    committed: number
    paid: number
    received: number
    residual: number
    capital: number
    proceeds: number
    flows: Array<{ amount: number; date: number }>
    writtenOff: boolean
    lastSigned: number
    instrumentKinds: Set<string>
    dealNames: Array<string>
    investorNames: Set<string>
  }
  const map = new Map<string, Group>()
  for (const d of deals) {
    const pending = d.status === 'pending'
    const settled = d.status === 'fully_exited' || d.status === 'written_off'
    const bucket = pending ? 'pending' : settled ? 'settled' : 'active'
    const key = `${d.targetCompanyId}:${bucket}`
    const g = map.get(key) ?? {
      companyId: d.targetCompanyId,
      name: d.target?.name ?? '—',
      domain: d.target?.domain ?? null,
      sector: d.target?.sector ?? null,
      aiScore: d.aiScore,
      org: d.org,
      pending,
      settled,
      dealCount: 0,
      committed: 0,
      paid: 0,
      received: 0,
      residual: 0,
      capital: 0,
      proceeds: 0,
      flows: [],
      writtenOff: false,
      lastSigned: 0,
      instrumentKinds: new Set<string>(),
      dealNames: [],
      investorNames: new Set<string>(),
    }
    g.dealCount += 1
    g.committed += d.committedAmount ?? 0
    g.paid += d.paidActual
    g.received += d.received
    g.residual += residualValueCents({
      status: d.status,
      lastValuationCents: d.lastValuationCents,
      paidActual: d.paidActual,
    })
    // MOIC capital/proceeds accumulated per-deal so each deal's own VAT
    // convention applies (royalty proceeds are net of VAT). De-VATing only
    // ever lowers the multiple, so a mixed group is never overvalued.
    g.capital += d.paidActual
    g.proceeds += proceedsFromReceived(d.received, d.instrumentKind)
    g.flows.push(...d.flows)
    if (d.status === 'written_off') g.writtenOff = true
    g.lastSigned = Math.max(g.lastSigned, d.signedDate ?? 0)
    g.instrumentKinds.add(d.instrumentKind)
    if (d.name) g.dealNames.push(d.name)
    if (d.investorName) g.investorNames.add(d.investorName)
    map.set(key, g)
  }
  return Array.from(map.values())
    .sort((a, b) => b.lastSigned - a.lastSigned)
    .map((g) => ({
      companyId: g.companyId,
      name: g.name,
      domain: g.domain,
      sector: g.sector,
      aiScore: g.aiScore,
      org: g.org,
      pending: g.pending,
      settled: g.settled,
      dealCount: g.dealCount,
      committed: g.committed,
      invested: g.paid,
      received: g.received,
      // TVPI keeps the GROSS received (not de-VAT'd), unlike the MOIC.
      // Pending rows have no ratio at all: nothing is wired yet.
      tvpi:
        g.settled || g.pending
          ? null
          : tvpiRatio({
              capital: g.paid,
              proceeds: g.received,
              residual: g.residual,
            }),
      moic: g.settled
        ? moicRatio({ capital: g.capital, proceeds: g.proceeds })
        : null,
      tri: g.settled ? xirr(g.flows) : null,
      writtenOff: g.writtenOff,
      instrumentKinds: [...g.instrumentKinds],
      dealNames: g.dealNames,
      investorNames: [...g.investorNames],
    }))
}

export type ParticipationRow = ReturnType<typeof buildParticipationRows>[number]

/**
 * Per-org participations rows (see `buildParticipationRows`), plus the set of
 * company ids referenced by any deal (target / investor / via-SPV) so the
 * "entities without a deal" section works without shipping the deals.
 */
export const listParticipations = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    // One indexed read of the org's companies (names/sector/domain) instead
    // of per-deal gets; one read of the AI scores.
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const companiesById = new Map(companies.map((c) => [c._id, c]))
    const aiScores = await aiScoresByCompany(ctx, orgId)

    // Treasury placements (crypto, capitalization accounts, term deposits…)
    // live on the dedicated Placements page — the participations rows only
    // cover participations. `referencedCompanyIds` below stays computed on
    // the UNFILTERED set, so a placement's company never shows as orphan.
    const sources = await Promise.all(
      deals
        .filter((d) => !isTreasuryPlacement(d.instrumentKind))
        .map((d) => participationSource(ctx, d, companiesById, aiScores, null)),
    )

    const referenced = new Set<Id<'companies'>>()
    for (const d of deals) {
      referenced.add(d.targetCompanyId)
      referenced.add(d.investorCompanyId)
      if (d.viaSpvCompanyId) referenced.add(d.viaSpvCompanyId)
    }

    const silent = await listSilentCompanies(ctx, orgId, Date.now())

    return {
      rows: withReportAlerts(buildParticipationRows(sources), silent),
      referencedCompanyIds: [...referenced],
    }
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
      // Lifecycle fields accept an explicit null to CLEAR them (reversibility
      // of an exit — Convex can't transmit `undefined` from the client).
      exitedDate: v.optional(v.union(v.null(), v.number())),
      exitProceeds: v.optional(v.union(v.null(), v.number())),
      // Same pattern: explicit null detaches the placement's bank account.
      bankAccountId: v.optional(v.union(v.null(), v.id('bankAccounts'))),
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
    if (patch.viaSpvCompanyId) {
      await assertSameOrg(ctx, deal.orgId, patch.viaSpvCompanyId, 'spv_wrong_org')
    }
    // Backing bank account (treasury placement): must exist in the deal's org.
    if (patch.bankAccountId) {
      const account = await ctx.db.get("bankAccounts", patch.bankAccountId)
      if (!account || account.orgId !== deal.orgId) {
        throw new ConvexError('account_wrong_org')
      }
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
    // Lifecycle: an explicit null on exitedDate/exitProceeds clears the field
    // (cancelling an exit). `null ?? undefined` → undefined, which tells
    // db.patch to drop the column; absent keys are left untouched (so editing
    // an unrelated field never wipes a recorded exit).
    const { exitedDate, exitProceeds, bankAccountId, ...rest } = patch
    await ctx.db.patch("deals", id, {
      ...rest,
      ...('exitedDate' in patch ? { exitedDate: exitedDate ?? undefined } : {}),
      ...('exitProceeds' in patch
        ? { exitProceeds: exitProceeds ?? undefined }
        : {}),
      ...('bankAccountId' in patch
        ? { bankAccountId: bankAccountId ?? undefined }
        : {}),
      manuallyEditedFields: [...editedFields],
    })
    // Placement balance history: every currentValue update (Placements page,
    // deal sheet or edit dialog — they all land here) also logs a valuation
    // row, so the balance builds a dated series over time. Skip 0 (the
    // valuations module contract requires fairValue > 0).
    if (
      patch.currentValue != null &&
      patch.currentValue > 0 &&
      patch.currentValue !== deal.currentValue
    ) {
      await ctx.db.insert('valuations', {
        orgId: deal.orgId,
        dealId: id,
        asOf: Date.now(),
        fairValue: patch.currentValue,
        valuationMethod: 'mark_to_market',
        source: 'balance_update',
      })
    }
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
    // Deal documents are owned by the deal (they don't show anywhere else),
    // so they go with it — files included, or the storage leaks.
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_deal', (q) => q.eq('dealId', id))
      .collect()
    for (const doc of docs) {
      await deleteStorageText(ctx, doc.storageId)
      await ctx.storage.delete(doc.storageId)
      await ctx.db.delete('documents', doc._id)
      // Drop the semantic-index entry (no-op if never indexed).
      await ctx.scheduler.runAfter(0, internal.vectorize.removeEntry, {
        orgId: doc.orgId,
        key: `doc:${doc._id}`,
      })
    }
    await ctx.db.delete("deals", id)
    return { deletedId: id }
  },
})
