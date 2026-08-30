/**
 * Agent tools for bank debt and guarantees, scoped to the thread's org
 * (convex/agentTools.ts pattern).
 *
 * Reads AND writes. Every write tool carries `needsApproval: true` (SPEC
 * D34, repo rule): generation stops, the UI shows Confirm / Refuse, and
 * `chat.respondToToolApproval` resumes the stream. A new write tool WITHOUT
 * that flag would let the agent change the books silently — never add one.
 *
 * DELETIONS stay out of the agent entirely (repo rule): removing a loan, a
 * guarantee or a property is a UI gesture. A mainlevée is not a deletion —
 * it is `releaseGuarantee`, and it keeps the history.
 *
 * The streaming action has no auth identity, so each tool parses the thread
 * scope `${orgId}:${userId}` and re-checks membership through
 * `readMembership`, exactly like the liability tools.
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { parseScope, readMembership } from './lib/agentScope'
import {
  attributeActuals,
  summarize,
} from './lib/amortization'
import { sortByStrength, summarizePledges } from './lib/guarantees'
import {
  COST_POSTES,
  costBasisTotalCents,
  latentGainCents,
  netYield,
  operatingResult,
  resolveCostBasis,
} from './lib/properties'
import { addMonthsUtc } from './lib/recurrence'
import { loanSchedule } from './loans'
import {
  amortizationKind,
  guaranteeForm,
  loanDeferralKind,
  loanPaymentFrequency,
  loanRateKind,
  loanRateStepKind,
  propertyAssetType,
  propertyCostPoste,
  propertyCostSource,
  propertyUsage,
} from './schema'

import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import type { ScheduleRow } from './lib/amortization'

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` → midnight UTC. Throws `code` on anything else. */
function parseISODate(iso: string, code: string): number {
  const ms = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(ms)) throw new ConvexError(code)
  return ms
}

/** Same bounded projection as the loan sheet, for a revolving with no end. */
const REVOLVING_HORIZON_MONTHS = 24

async function scheduleOf(
  ctx: QueryCtx,
  loan: Doc<'loans'>,
  now: number,
): Promise<Array<ScheduleRow>> {
  // Through the single shared reader (rate steps + amendments), so the agent
  // never describes a different loan than the sheet does.
  return await loanSchedule(ctx, loan, {
    horizonDate: addMonthsUtc(now, REVOLVING_HORIZON_MONTHS),
  })
}

// ─── Internal queries (re-check membership) ─────────────────────────────────

export const listLoansInternal = internalQuery({
  args: { orgId: v.id('organizations'), actorUserId: v.id('users') },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const now = Date.now()

    const loans = await ctx.db
      .query('loans')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const rows = await Promise.all(
      loans.map(async (loan) => {
        const schedule = await scheduleOf(ctx, loan, now)
        const summary = summarize(loan, schedule, now)
        return {
          _id: loan._id,
          label: loan.label,
          lenderName: loan.lenderName,
          status: loan.status,
          amortizationKind: loan.amortizationKind,
          principalCents: loan.principalCents,
          // Derived on every read, never stored.
          outstandingCents:
            loan.status === 'active' ? summary.outstandingCents : 0,
          currentRateBps: summary.currentRateBps,
          rateKind: loan.rateKind,
          paymentFrequency: loan.paymentFrequency,
          currentPaymentCents: summary.currentPaymentCents,
          insuranceMonthlyCents: loan.insuranceMonthlyCents ?? null,
          creditLimitCents: loan.creditLimitCents ?? null,
          signedDateISO: toISODate(loan.signedDate),
          lastPaymentDateISO:
            summary.lastPaymentDate != null
              ? toISODate(summary.lastPaymentDate)
              : null,
        }
      }),
    )
    return {
      loans: rows,
      totalOutstandingCents: rows.reduce(
        (sum, row) => sum + row.outstandingCents,
        0,
      ),
    }
  },
})

export const getLoanScheduleInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    loanId: v.id('loans'),
    /** Instalments to return around today. Bounded — a 240-row table would
     * flood the model's context for no gain. */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, actorUserId, loanId, limit }) => {
    await readMembership(ctx, orgId, actorUserId)
    const loan = await ctx.db.get('loans', loanId)
    if (!loan || loan.orgId !== orgId) return null
    const now = Date.now()

    const schedule = await scheduleOf(ctx, loan, now)
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', loanId as string),
      )
      .collect()
    const actuals = attributeActuals(
      schedule,
      txs
        .filter((tx) => tx.allocation?.kind === 'loan')
        .map((tx) => ({
          transactionDate: tx.transactionDate,
          amountCents: tx.direction === 'out' ? tx.amount : -tx.amount,
        })),
    )

    // Window centred on today: the instalments that are being watched.
    const window = Math.min(Math.max(limit ?? 12, 1), 60)
    const pivot = schedule.findIndex((row) => row.date > now)
    const centre = pivot === -1 ? schedule.length : pivot
    const from = Math.max(0, centre - Math.floor(window / 2))

    return {
      label: loan.label,
      amortizationKind: loan.amortizationKind,
      totalInstalments: schedule.length,
      instalments: schedule.slice(from, from + window).map((row, index) => ({
        dateISO: toISODate(row.date),
        paymentCents: row.paymentCents,
        capitalCents: row.capitalCents,
        interestCents: row.interestCents,
        insuranceCents: row.insuranceCents,
        outstandingAfterCents: row.remainingCents,
        rateBps: row.rateBps,
        isBalloon: row.isBalloon,
        isDeferred: row.isDeferred,
        // Beyond the last actual rate revision on a variable loan: the app
        // does not know this rate, and says so.
        projected: row.projected,
        actualCents: actuals[from + index],
      })),
    }
  },
})

export const listGuaranteesInternal = internalQuery({
  args: { orgId: v.id('organizations'), actorUserId: v.id('users') },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)

    // Three readings of the same table, from this org's point of view.
    const asBorrower = await ctx.db
      .query('guarantees')
      .withIndex('by_borrower_org', (q) => q.eq('borrowerOrgId', orgId))
      .collect()
    const asPledgor = await ctx.db
      .query('guarantees')
      .withIndex('by_pledgor_org', (q) => q.eq('pledgorOrgId', orgId))
      .collect()

    const seen = new Set<Id<'guarantees'>>()
    const rows: Array<Doc<'guarantees'>> = []
    for (const row of [...asBorrower, ...asPledgor]) {
      if (seen.has(row._id)) continue
      seen.add(row._id)
      rows.push(row)
    }

    const describe = async (guarantee: Doc<'guarantees'>) => {
      const loan = guarantee.loanId
        ? await ctx.db.get('loans', guarantee.loanId)
        : null
      const deal = guarantee.subjectDealId
        ? await ctx.db.get('deals', guarantee.subjectDealId)
        : null
      const company = guarantee.subjectCompanyId
        ? await ctx.db.get('companies', guarantee.subjectCompanyId)
        : null
      const pledgorOrg = guarantee.pledgorOrgId
        ? await ctx.db.get('organizations', guarantee.pledgorOrgId)
        : null
      const borrowerOrg = guarantee.borrowerOrgId
        ? await ctx.db.get('organizations', guarantee.borrowerOrgId)
        : null
      return {
        _id: guarantee._id,
        form: guarantee.form,
        rank: guarantee.rank ?? null,
        // Absent = NOT quantified (an unlimited surety). It is excluded from
        // every pledged total — reporting it as 0 would be a lie.
        pledgedAmountCents: guarantee.pledgedAmountCents ?? null,
        actDateISO:
          guarantee.actDate != null ? toISODate(guarantee.actDate) : null,
        releasedAtISO:
          guarantee.releasedAt != null
            ? toISODate(guarantee.releasedAt)
            : null,
        subjectKind: guarantee.subjectKind,
        subjectName:
          deal?.name ?? company?.name ?? guarantee.subjectLabel ?? null,
        guarantorName:
          pledgorOrg?.name ?? guarantee.pledgorLabel ?? null,
        borrowerName:
          borrowerOrg?.name ?? guarantee.borrowerLabel ?? null,
        loanLabel: loan?.label ?? null,
        // Which side of the row this org sits on.
        role:
          guarantee.borrowerOrgId === orgId
            ? guarantee.pledgorOrgId === orgId
              ? ('borrower_and_guarantor' as const)
              : ('borrower' as const)
            : ('guarantor' as const),
      }
    }

    return await Promise.all(sortByStrength(rows).map(describe))
  },
})

export const getPledgesOnDealInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    dealId: v.id('deals'),
  },
  handler: async (ctx, { orgId, actorUserId, dealId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const deal = await ctx.db.get('deals', dealId)
    if (!deal || deal.orgId !== orgId) return null

    const rows = await ctx.db
      .query('guarantees')
      .withIndex('by_subject_deal', (q) => q.eq('subjectDealId', dealId))
      .collect()

    const valuation = await ctx.db
      .query('valuations')
      .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
      .order('desc')
      .first()
    const valueCents = valuation?.fairValue ?? deal.currentValue ?? null

    const summary = summarizePledges(valueCents, rows)
    const pledges = await Promise.all(
      sortByStrength(rows).map(async (guarantee) => {
        const borrowerOrg = guarantee.borrowerOrgId
          ? await ctx.db.get('organizations', guarantee.borrowerOrgId)
          : null
        return {
          form: guarantee.form,
          rank: guarantee.rank ?? null,
          pledgedAmountCents: guarantee.pledgedAmountCents ?? null,
          releasedAtISO:
            guarantee.releasedAt != null
              ? toISODate(guarantee.releasedAt)
              : null,
          beneficiary: borrowerOrg?.name ?? guarantee.borrowerLabel ?? null,
        }
      }),
    )

    return { dealName: deal.name ?? null, summary, pledges }
  },
})

// ─── Tools ──────────────────────────────────────────────────────────────────

const listLoans = createTool({
  description:
    'List the bank loans of the current org, with the CAPITAL OUTSTANDING ' +
    'of each. The outstanding is DERIVED from the computed amortization ' +
    'schedule, never stored — except for a revolving credit, whose ' +
    'principalCents IS the current drawn amount. Amounts in CENTS EUR, ' +
    'rates in basis points (185 = 1.85 %). Use this to answer "how much ' +
    'does this company still owe" and to find loan ids.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentToolsDebt.listLoansInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const getLoanSchedule = createTool({
  description:
    'Amortization schedule of one loan, windowed around today: date, ' +
    'instalment, capital, interest, insurance, outstanding after payment, ' +
    'and the ACTUAL amount debited in that instalment period. The plan is ' +
    'the source of the outstanding; the actual is a control — a divergence ' +
    'means an incomplete matching or an unrecorded event, not a bug. On a ' +
    'variable-rate loan, instalments past the last actual revision are ' +
    'flagged `projected`: the rate is unknown, not predicted.',
  inputSchema: z.object({
    loanId: z.string().describe('Loan id from listLoans'),
    limit: z
      .number()
      .optional()
      .describe('Instalments to return around today (default 12, max 60)'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsDebt.getLoanScheduleInternal,
      {
        orgId,
        actorUserId: userId,
        loanId: input.loanId as Id<'loans'>,
        limit: input.limit,
      },
    )
  },
})

const listGuarantees = createTool({
  description:
    'List the guarantees this org is a party to, strongest form first. A ' +
    'guarantee carries THREE independent things: its form (nantissement, ' +
    'hypotheque, ppd, caution, garantie_organisme), the asset it bites on, ' +
    'and who commits. `role` says whether the org is the borrower, the ' +
    'guarantor, or both. A null pledgedAmountCents means NOT QUANTIFIED ' +
    '(an unlimited surety) — never report it as zero, and never add it to ' +
    'a total.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsDebt.listGuaranteesInternal,
      { orgId, actorUserId: userId },
    )
  },
})

const getPledgesOnDeal = createTool({
  description:
    'What a placement secures in total, and how much room is left: its ' +
    'current value, the total pledged on it, and the available margin. The ' +
    'list includes the pledges benefiting ANOTHER group company or an ' +
    'outside borrower — leaving those out is exactly how the margin gets ' +
    'overstated. The margin is deliberately pessimistic: a pledged amount ' +
    'is worth its deed amount until the release, whatever is left of the ' +
    'debt. A negative margin is information, not an error.',
  inputSchema: z.object({
    dealId: z.string().describe('Deal id of the pledged placement'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsDebt.getPledgesOnDealInternal,
      {
        orgId,
        actorUserId: userId,
        dealId: input.dealId as Id<'deals'>,
      },
    )
  },
})

// ─── Property reads (the agent cannot write what it cannot find) ────────────

export const listPropertiesInternal = internalQuery({
  args: { orgId: v.id('organizations'), actorUserId: v.id('users') },
  handler: async (ctx, { orgId, actorUserId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const now = Date.now()

    const properties = await ctx.db
      .query('properties')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    return await Promise.all(
      properties.map(async (property) => {
        const txs = await ctx.db
          .query('transactions')
          .withIndex('by_org_allocation_target', (q) =>
            q
              .eq('orgId', orgId)
              .eq('allocation.targetId', property._id as string),
          )
          .collect()
        const flows = txs
          .filter((tx) => tx.allocation?.kind === 'property')
          .map((tx) => ({
            transactionDate: tx.transactionDate,
            direction: tx.direction,
            amount: tx.amount,
            category: tx.allocation?.category,
          }))
        const postes = resolveCostBasis(property.costBasis, flows)
        const costBasisCents = costBasisTotalCents(postes)
        const valuation = await ctx.db
          .query('propertyValuations')
          .withIndex('by_property_asof', (q) =>
            q.eq('propertyId', property._id),
          )
          .order('desc')
          .first()
        const currentValueCents = valuation?.valueCents ?? null
        const operating = operatingResult(flows, now)
        return {
          _id: property._id,
          name: property.name,
          address: property.address,
          propertyType: property.propertyType,
          usage: property.usage,
          status: property.status,
          // All DERIVED on every read, nothing stored.
          costBasisCents,
          costBasis: postes.map((poste) => ({
            poste: poste.poste,
            source: poste.source,
            amountCents: poste.amountCents,
            flowCount: poste.flowCount,
            ignoredFlowCount: poste.ignoredFlowCount,
          })),
          currentValueCents,
          latentGainCents: latentGainCents(currentValueCents, costBasisCents),
          netResultCents: operating.netCents,
          netYield: netYield(operating.netCents, costBasisCents),
          acquiredDateISO:
            property.acquiredDate != null
              ? toISODate(property.acquiredDate)
              : null,
        }
      }),
    )
  },
})

// ─── Internal mutations (re-check membership, like every agent write) ───────

/** The org a loan belongs to, once membership is confirmed. */
async function loanOfOrg(
  ctx: { db: { get: (t: 'loans', id: Id<'loans'>) => Promise<Doc<'loans'> | null> } },
  orgId: Id<'organizations'>,
  loanId: Id<'loans'>,
): Promise<Doc<'loans'>> {
  const loan = await ctx.db.get('loans', loanId)
  if (!loan || loan.orgId !== orgId) throw new ConvexError('not_found')
  return loan
}

export const createLoanInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    label: v.string(),
    lenderName: v.string(),
    principalCents: v.number(),
    signedDate: v.number(),
    firstPaymentDate: v.number(),
    durationMonths: v.optional(v.number()),
    amortizationKind,
    creditLimitCents: v.optional(v.number()),
    rateBps: v.number(),
    rateKind: loanRateKind,
    insuranceMonthlyCents: v.optional(v.number()),
    paymentFrequency: loanPaymentFrequency,
    deferralMonths: v.optional(v.number()),
    deferralKind: v.optional(loanDeferralKind),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, ...fields }) => {
    await readMembership(ctx, orgId, actorUserId)
    const label = fields.label.trim()
    const lenderName = fields.lenderName.trim()
    if (!label || !lenderName) throw new ConvexError('invalid_label')
    if (fields.principalCents <= 0) throw new ConvexError('invalid_amount')
    if (fields.rateBps < 0) throw new ConvexError('invalid_rate')
    if (
      fields.amortizationKind !== 'revolving' &&
      (!fields.durationMonths || fields.durationMonths <= 0)
    ) {
      throw new ConvexError('missing_duration')
    }
    const _id = await ctx.db.insert('loans', {
      orgId,
      ...fields,
      label,
      lenderName,
      status: 'active',
      notes: fields.notes?.trim() || undefined,
    })
    return { _id }
  },
})

export const addLoanRateInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    loanId: v.id('loans'),
    fromDate: v.number(),
    rateBps: v.number(),
    kind: loanRateStepKind,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, loanId, ...fields }) => {
    await readMembership(ctx, orgId, actorUserId)
    const loan = await loanOfOrg(ctx, orgId, loanId)
    if (loan.rateKind !== 'variable') throw new ConvexError('rate_is_fixed')
    if (fields.rateBps < 0) throw new ConvexError('invalid_rate')

    const existing = await ctx.db
      .query('loanRates')
      .withIndex('by_loan_from', (q) =>
        q.eq('loanId', loanId).eq('fromDate', fields.fromDate),
      )
      .first()
    if (existing) {
      await ctx.db.patch('loanRates', existing._id, {
        rateBps: fields.rateBps,
        kind: fields.kind,
        notes: fields.notes?.trim() || undefined,
      })
      return { _id: existing._id }
    }
    const _id = await ctx.db.insert('loanRates', {
      orgId,
      loanId,
      ...fields,
      notes: fields.notes?.trim() || undefined,
    })
    return { _id }
  },
})

export const addLoanAmendmentInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    loanId: v.id('loans'),
    effectiveDate: v.number(),
    rateBps: v.optional(v.number()),
    durationMonths: v.optional(v.number()),
    insuranceMonthlyCents: v.optional(v.number()),
    outstandingCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, actorUserId, loanId, ...fields }) => {
    await readMembership(ctx, orgId, actorUserId)
    const loan = await loanOfOrg(ctx, orgId, loanId)
    if (loan.amortizationKind === 'revolving') {
      throw new ConvexError('revolving_not_amendable')
    }
    if (fields.effectiveDate <= loan.firstPaymentDate) {
      throw new ConvexError('amendment_before_start')
    }

    const existing = await ctx.db
      .query('loanAmendments')
      .withIndex('by_loan_from', (q) =>
        q.eq('loanId', loanId).eq('effectiveDate', fields.effectiveDate),
      )
      .first()
    const payload = { ...fields, notes: fields.notes?.trim() || undefined }
    if (existing) {
      await ctx.db.patch('loanAmendments', existing._id, payload)
      return { _id: existing._id }
    }
    const _id = await ctx.db.insert('loanAmendments', {
      orgId,
      loanId,
      ...payload,
    })
    return { _id }
  },
})

export const createGuaranteeInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    loanId: v.id('loans'),
    form: guaranteeForm,
    subjectDealId: v.optional(v.id('deals')),
    subjectPropertyId: v.optional(v.id('properties')),
    subjectCompanyId: v.optional(v.id('companies')),
    subjectLabel: v.optional(v.string()),
    pledgorOrgId: v.optional(v.id('organizations')),
    pledgorLabel: v.optional(v.string()),
    rank: v.optional(v.number()),
    pledgedAmountCents: v.optional(v.number()),
    actDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    // The guarantee is anchored on a loan of THIS org — the agent never
    // creates one for an outside borrower, which is a rarer, hand-entered
    // case that needs a human reading of the deed.
    const loan = await loanOfOrg(ctx, args.orgId, args.loanId)

    // The subject's org is resolved FROM the asset, never taken as an
    // argument: otherwise a caller could claim to be a party it is not
    // (KNOWN_ISSUES « Garanties »).
    let subjectOrgId: Id<'organizations'> | undefined
    let subjectKind: Doc<'guarantees'>['subjectKind'] = 'external'
    if (args.subjectDealId) {
      const deal = await ctx.db.get('deals', args.subjectDealId)
      if (!deal) throw new ConvexError('not_found')
      subjectKind = 'placement'
      subjectOrgId = deal.orgId
    } else if (args.subjectPropertyId) {
      const property = await ctx.db.get('properties', args.subjectPropertyId)
      if (!property) throw new ConvexError('not_found')
      subjectKind = 'property'
      subjectOrgId = property.orgId
    } else if (args.subjectCompanyId) {
      const company = await ctx.db.get('companies', args.subjectCompanyId)
      if (!company) throw new ConvexError('not_found')
      subjectKind = 'shares'
      subjectOrgId = company.orgId
    } else if (!args.subjectLabel?.trim()) {
      throw new ConvexError('missing_subject')
    }
    if (args.pledgorOrgId && args.pledgorLabel) {
      throw new ConvexError('ambiguous_pledgor')
    }
    if (args.rank != null && args.rank < 1) {
      throw new ConvexError('invalid_rank')
    }
    if (args.pledgedAmountCents != null && args.pledgedAmountCents <= 0) {
      throw new ConvexError('invalid_amount')
    }

    const _id = await ctx.db.insert('guarantees', {
      loanId: args.loanId,
      borrowerOrgId: loan.orgId,
      pledgorOrgId: args.pledgorOrgId,
      pledgorLabel: args.pledgorLabel?.trim() || undefined,
      subjectKind,
      subjectDealId: args.subjectDealId,
      subjectPropertyId: args.subjectPropertyId,
      subjectCompanyId: args.subjectCompanyId,
      subjectOrgId,
      subjectLabel:
        subjectKind === 'external'
          ? args.subjectLabel?.trim() || undefined
          : undefined,
      form: args.form,
      rank: args.rank,
      pledgedAmountCents: args.pledgedAmountCents,
      actDate: args.actDate,
      notes: args.notes?.trim() || undefined,
    })
    return { _id }
  },
})

export const releaseGuaranteeInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    guaranteeId: v.id('guarantees'),
    releasedAt: v.number(),
  },
  handler: async (ctx, { orgId, actorUserId, guaranteeId, releasedAt }) => {
    await readMembership(ctx, orgId, actorUserId)
    const guarantee = await ctx.db.get('guarantees', guaranteeId)
    if (!guarantee) throw new ConvexError('not_found')
    // A party of the guarantee, and the thread's org must be one of them.
    const parties = [
      guarantee.borrowerOrgId,
      guarantee.pledgorOrgId,
      guarantee.subjectOrgId,
    ]
    if (!parties.includes(orgId)) throw new ConvexError('not_a_party')

    await ctx.db.patch('guarantees', guaranteeId, { releasedAt })
    return { _id: guaranteeId }
  },
})

export const createPropertyInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    name: v.string(),
    address: v.string(),
    propertyType: propertyAssetType,
    usage: propertyUsage,
    surfaceSqm: v.optional(v.number()),
    acquiredDate: v.optional(v.number()),
    acquisitionCents: v.optional(v.number()),
    acquisitionFeesCents: v.optional(v.number()),
    worksCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('invalid_label')
    for (const amount of [
      args.acquisitionCents,
      args.acquisitionFeesCents,
      args.worksCents,
    ]) {
      if (amount != null && amount < 0) throw new ConvexError('invalid_amount')
    }

    // A new property starts every line item on `manual`: nothing is matched
    // to it yet, so `flows` would read zero. Switching a line item to the
    // flows is a separate, deliberate gesture.
    const _id = await ctx.db.insert('properties', {
      orgId: args.orgId,
      name,
      address: args.address.trim(),
      propertyType: args.propertyType,
      usage: args.usage,
      surfaceSqm: args.surfaceSqm,
      acquiredDate: args.acquiredDate,
      costBasis: [
        {
          poste: 'acquisition' as const,
          source: 'manual' as const,
          manualAmountCents: args.acquisitionCents,
        },
        {
          poste: 'frais_acquisition' as const,
          source: 'manual' as const,
          manualAmountCents: args.acquisitionFeesCents,
        },
        {
          poste: 'travaux' as const,
          source: 'manual' as const,
          manualAmountCents: args.worksCents,
        },
      ],
      status: 'held',
      notes: args.notes?.trim() || undefined,
    })
    return { _id }
  },
})

export const setPropertyCostSourceInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    propertyId: v.id('properties'),
    poste: propertyCostPoste,
    source: propertyCostSource,
    manualAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    const property = await ctx.db.get('properties', args.propertyId)
    if (!property || property.orgId !== args.orgId) {
      throw new ConvexError('not_found')
    }
    if (args.manualAmountCents != null && args.manualAmountCents < 0) {
      throw new ConvexError('invalid_amount')
    }

    const existing = property.costBasis.find((row) => row.poste === args.poste)
    const next = property.costBasis.filter((row) => row.poste !== args.poste)
    next.push({
      poste: args.poste,
      source: args.source,
      // Kept when moving to `flows`: switching back must not mean re-typing.
      manualAmountCents: args.manualAmountCents ?? existing?.manualAmountCents,
    })
    next.sort(
      (a, b) => COST_POSTES.indexOf(a.poste) - COST_POSTES.indexOf(b.poste),
    )
    await ctx.db.patch('properties', args.propertyId, { costBasis: next })
    return { _id: args.propertyId }
  },
})

export const addPropertyValuationInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    propertyId: v.id('properties'),
    asOf: v.number(),
    valueCents: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await readMembership(ctx, args.orgId, args.actorUserId)
    const property = await ctx.db.get('properties', args.propertyId)
    if (!property || property.orgId !== args.orgId) {
      throw new ConvexError('not_found')
    }
    if (args.valueCents < 0) throw new ConvexError('invalid_amount')

    const existing = await ctx.db
      .query('propertyValuations')
      .withIndex('by_property_asof', (q) =>
        q.eq('propertyId', args.propertyId).eq('asOf', args.asOf),
      )
      .first()
    if (existing) {
      await ctx.db.patch('propertyValuations', existing._id, {
        valueCents: args.valueCents,
        source: args.source?.trim() || undefined,
      })
      return { _id: existing._id }
    }
    const _id = await ctx.db.insert('propertyValuations', {
      orgId: args.orgId,
      propertyId: args.propertyId,
      asOf: args.asOf,
      valueCents: args.valueCents,
      source: args.source?.trim() || undefined,
    })
    return { _id }
  },
})

// ─── Write tools — EVERY one carries `needsApproval: true` (SPEC D34) ───────
//
// The flag is not decoration: it stops the generation, shows Confirm /
// Refuse in the UI, and `chat.respondToToolApproval` resumes the stream. A
// write tool without it changes the books with nobody looking.

const listProperties = createTool({
  description:
    'List the real-estate properties of the current org, with their COST ' +
    'PRICE line item by line item, the source of each (manual amount vs ' +
    'matched flows — never both added together), the last known value, the ' +
    'latent gain and the net yield. Everything is derived on every read, ' +
    'nothing is stored. Amounts in CENTS EUR. Use this to find property ids.',
  inputSchema: z.object({}),
  execute: async (ctx): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentToolsDebt.listPropertiesInternal, {
      orgId,
      actorUserId: userId,
    })
  },
})

const createLoan = createTool({
  description:
    'Create a BANK loan for the current org. Enter the TERMS OF THE ' +
    'CONTRACT only — never the capital outstanding, which is computed from ' +
    'them. amortizationKind drives everything: "constant_annuity" (fixed ' +
    'instalment), "constant_capital" (fixed capital slice), "bullet" (in ' +
    'fine: interest only then the whole capital at the end), "revolving" ' +
    '(lombard: no schedule, and principalCents is then the CURRENT DRAWN ' +
    'AMOUNT). durationMonths is the TOTAL duration, deferral included, and ' +
    'is required except on a revolving. Amounts in CENTS EUR, rates in ' +
    'BASIS POINTS (185 = 1.85 %). Dates are "YYYY-MM-DD". The user approves ' +
    'via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    label: z.string().describe('e.g. "Prêt Palatine 2021"'),
    lenderName: z.string().describe('e.g. "Banque Palatine"'),
    principalCents: z.number().int().positive().describe('cents EUR'),
    signedDateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    firstPaymentDateISO: z.string().describe('ISO date of the 1st instalment'),
    durationMonths: z.number().int().positive().optional(),
    amortizationKind: z.enum([
      'constant_annuity',
      'constant_capital',
      'bullet',
      'revolving',
    ]),
    creditLimitCents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Revolving only: authorized ceiling'),
    rateBps: z.number().int().min(0).describe('basis points at signature'),
    rateKind: z.enum(['fixed', 'variable']),
    insuranceMonthlyCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Borrower insurance, OUTSIDE the instalment'),
    paymentFrequency: z.enum(['monthly', 'quarterly']),
    deferralMonths: z.number().int().min(0).optional(),
    deferralKind: z
      .enum(['partial', 'total'])
      .optional()
      .describe('partial = interest paid; total = interest capitalizes'),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const { signedDateISO, firstPaymentDateISO, ...rest } = input
    return await ctx.runMutation(internal.agentToolsDebt.createLoanInternal, {
      orgId,
      actorUserId: userId,
      ...rest,
      signedDate: parseISODate(signedDateISO, 'invalid_signed_date'),
      firstPaymentDate: parseISODate(
        firstPaymentDateISO,
        'invalid_first_payment_date',
      ),
    })
  },
})

const addLoanRate = createTool({
  description:
    'Add a dated step to a VARIABLE-rate loan: a revision that happened ' +
    '(kind "actual") or a steering assumption (kind "forecast"). The ' +
    'distinction is not cosmetic — instalments past the last "actual" step ' +
    'are flagged as projected, because the app does not pretend to know a ' +
    'future rate. Refused on a fixed-rate loan. One step per date: the same ' +
    'date replaces. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    loanId: z.string().describe('Loan id from listLoans'),
    fromDateISO: z.string().describe('Effective date "YYYY-MM-DD"'),
    rateBps: z.number().int().min(0).describe('basis points'),
    kind: z.enum(['actual', 'forecast']),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.agentToolsDebt.addLoanRateInternal, {
      orgId,
      actorUserId: userId,
      loanId: input.loanId as Id<'loans'>,
      fromDate: parseISODate(input.fromDateISO, 'invalid_from_date'),
      rateBps: input.rateBps,
      kind: input.kind,
      notes: input.notes,
    })
  },
})

const addLoanAmendment = createTool({
  description:
    'Record a dated AMENDMENT to a loan (a renegotiation). It KEEPS the ' +
    'history: instalments already run do not move, and the new terms apply ' +
    'to the capital that remains from the effective date. Do NOT use this ' +
    'to fix a typo — that is a correction, and it is a UI gesture. Only ' +
    'pass the fields that actually change; the rest carries over. Set ' +
    'outstandingCents ONLY if the lender restated the capital, otherwise ' +
    'the app derives it. Refused on a revolving and before the first ' +
    'instalment. The user approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    loanId: z.string().describe('Loan id from listLoans'),
    effectiveDateISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    rateBps: z.number().int().min(0).optional(),
    durationMonths: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Duration REMAINING from the effective date'),
    insuranceMonthlyCents: z.number().int().min(0).optional(),
    outstandingCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Only if the lender restated it'),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const { effectiveDateISO, loanId, ...rest } = input
    return await ctx.runMutation(
      internal.agentToolsDebt.addLoanAmendmentInternal,
      {
        orgId,
        actorUserId: userId,
        loanId: loanId as Id<'loans'>,
        effectiveDate: parseISODate(effectiveDateISO, 'invalid_effective_date'),
        ...rest,
      },
    )
  },
})

const createGuarantee = createTool({
  description:
    'Attach a security to a bank loan of the current org. THREE independent ' +
    'pieces of information (never confuse them): the FORM (nantissement, ' +
    'hypotheque, ppd, caution, garantie_organisme), the SUBJECT it bites on ' +
    '(exactly one of subjectDealId for a placement, subjectPropertyId for a ' +
    'property, subjectCompanyId for shares, or subjectLabel for something ' +
    'that is not ours), and the GUARANTOR (pledgorOrgId for a group company, ' +
    'or pledgorLabel for anyone else — a personal caution is a LABEL, never ' +
    'a person record). Leave pledgedAmountCents EMPTY when the deed does not ' +
    'quantify it (an unlimited caution): it is then excluded from the ' +
    'pledged total, and a zero would lie. The user approves via in-app ' +
    'buttons.',
  needsApproval: true,
  inputSchema: z.object({
    loanId: z.string().describe('Loan id from listLoans'),
    form: z.enum([
      'nantissement',
      'hypotheque',
      'ppd',
      'caution',
      'garantie_organisme',
    ]),
    subjectDealId: z.string().optional().describe('A placement (listDeals)'),
    subjectPropertyId: z
      .string()
      .optional()
      .describe('A property (listProperties)'),
    subjectCompanyId: z.string().optional().describe('Shares (listCompanies)'),
    subjectLabel: z
      .string()
      .optional()
      .describe('Something not ours, e.g. "Saccef"'),
    pledgorOrgId: z.string().optional().describe('Group org id (listOrgs)'),
    pledgorLabel: z
      .string()
      .optional()
      .describe('Outside guarantor, e.g. "Clément Alteresco"'),
    rank: z.number().int().min(1).optional().describe('1 = first rank'),
    pledgedAmountCents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Amount ON THE DEED. Omit when not quantified'),
    actDateISO: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsDebt.createGuaranteeInternal,
      {
        orgId,
        actorUserId: userId,
        loanId: input.loanId as Id<'loans'>,
        form: input.form,
        subjectDealId: input.subjectDealId as Id<'deals'> | undefined,
        subjectPropertyId: input.subjectPropertyId as
          | Id<'properties'>
          | undefined,
        subjectCompanyId: input.subjectCompanyId as Id<'companies'> | undefined,
        subjectLabel: input.subjectLabel,
        pledgorOrgId: input.pledgorOrgId as Id<'organizations'> | undefined,
        pledgorLabel: input.pledgorLabel,
        rank: input.rank,
        pledgedAmountCents: input.pledgedAmountCents,
        actDate: input.actDateISO
          ? parseISODate(input.actDateISO, 'invalid_act_date')
          : undefined,
        notes: input.notes,
      },
    )
  },
})

const releaseGuarantee = createTool({
  description:
    'Record a MAINLEVÉE on a guarantee: it stops counting towards the ' +
    'pledged total, and the row STAYS as history. This is not a deletion — ' +
    'deleting a guarantee entered by mistake is a UI gesture. The user ' +
    'approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    guaranteeId: z.string().describe('Guarantee id from listGuarantees'),
    releasedAtISO: z.string().describe('Mainlevée date "YYYY-MM-DD"'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsDebt.releaseGuaranteeInternal,
      {
        orgId,
        actorUserId: userId,
        guaranteeId: input.guaranteeId as Id<'guarantees'>,
        releasedAt: parseISODate(input.releasedAtISO, 'invalid_released_at'),
      },
    )
  },
})

const createProperty = createTool({
  description:
    'Create a real-estate property held by the current org. The three cost ' +
    'line items start as ENTERED amounts (acquisitionCents, ' +
    'acquisitionFeesCents, worksCents) — nothing is matched to a brand-new ' +
    'property, so reading them from the flows would give zero. Switching a ' +
    'line item to the matched flows afterwards is setPropertyCostSource. ' +
    'Rents, charges, yield and latent gain are NEVER entered: they are ' +
    'derived from matched transactions and valuations. usage ' +
    '"marchand_de_biens" means held for resale — no operating result. ' +
    'Amounts in CENTS EUR, all TAX-INCLUSIVE. The user approves via in-app ' +
    'buttons.',
  needsApproval: true,
  inputSchema: z.object({
    name: z.string().describe('e.g. "18 rue de la Chapelle"'),
    address: z.string(),
    propertyType: z.enum([
      'appartement',
      'maison',
      'immeuble',
      'local_commercial',
      'terrain',
    ]),
    usage: z.enum([
      'locatif_nu',
      'locatif_meuble',
      'colocation',
      'saisonnier',
      'commercial',
      'marchand_de_biens',
      'residence_secondaire',
    ]),
    surfaceSqm: z.number().positive().optional(),
    acquiredDateISO: z.string().optional().describe('ISO date "YYYY-MM-DD"'),
    acquisitionCents: z.number().int().min(0).optional(),
    acquisitionFeesCents: z.number().int().min(0).optional(),
    worksCents: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    const { acquiredDateISO, ...rest } = input
    return await ctx.runMutation(
      internal.agentToolsDebt.createPropertyInternal,
      {
        orgId,
        actorUserId: userId,
        ...rest,
        acquiredDate: acquiredDateISO
          ? parseISODate(acquiredDateISO, 'invalid_acquired_date')
          : undefined,
      },
    )
  },
})

const setPropertyCostSource = createTool({
  description:
    'Switch ONE cost line item of a property between its entered amount ' +
    '("manual") and the sum of the transactions matched to that property ' +
    'with that category ("flows"). ONE source per line item — the two are ' +
    'NEVER added together, and the choice is per line item: a property ' +
    'bought before the bank connection has an entered price while its ' +
    'recent works come from real transfers. The entered amount is kept when ' +
    'switching to "flows", so switching back costs nothing. The user ' +
    'approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    propertyId: z.string().describe('Property id from listProperties'),
    poste: z.enum(['acquisition', 'frais_acquisition', 'travaux']),
    source: z.enum(['manual', 'flows']),
    manualAmountCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Sets the entered amount at the same time'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsDebt.setPropertyCostSourceInternal,
      {
        orgId,
        actorUserId: userId,
        propertyId: input.propertyId as Id<'properties'>,
        poste: input.poste,
        source: input.source,
        manualAmountCents: input.manualAmountCents,
      },
    )
  },
})

const addPropertyValuation = createTool({
  description:
    'Add a dated valuation to a property. There is NO automatic estimate — ' +
    'the value is the one the user knows, and `source` is a free label ' +
    '("estimation agence", "notaire", "à dire d\'expert"). One valuation ' +
    'per date: the same date replaces. Amounts in CENTS EUR. The user ' +
    'approves via in-app buttons.',
  needsApproval: true,
  inputSchema: z.object({
    propertyId: z.string().describe('Property id from listProperties'),
    asOfISO: z.string().describe('ISO date "YYYY-MM-DD"'),
    valueCents: z.number().int().min(0).describe('cents EUR'),
    source: z.string().optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsDebt.addPropertyValuationInternal,
      {
        orgId,
        actorUserId: userId,
        propertyId: input.propertyId as Id<'properties'>,
        asOf: parseISODate(input.asOfISO, 'invalid_as_of'),
        valueCents: input.valueCents,
        source: input.source,
      },
    )
  },
})

export const debtTools = {
  listLoans,
  getLoanSchedule,
  listGuarantees,
  getPledgesOnDeal,
  listProperties,
  // Writes — every one carries `needsApproval: true`.
  createLoan,
  addLoanRate,
  addLoanAmendment,
  createGuarantee,
  releaseGuarantee,
  createProperty,
  setPropertyCostSource,
  addPropertyValuation,
}
