/**
 * Agent tools for bank debt and guarantees, scoped to the thread's org
 * (convex/agentTools.ts pattern).
 *
 * READ ONLY. Writing loans, guarantees and properties is a later lot, and
 * every write tool there MUST carry `needsApproval: true` (SPEC D34, repo
 * rule) — do not add one here without it.
 *
 * The streaming action has no auth identity, so each tool parses the thread
 * scope `${orgId}:${userId}` and re-checks membership through
 * `readMembership`, exactly like the liability tools.
 */

import { v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalQuery } from './_generated/server'
import { parseScope, readMembership } from './lib/agentScope'
import {
  attributeActuals,
  summarize,
} from './lib/amortization'
import { sortByStrength, summarizePledges } from './lib/guarantees'
import { addMonthsUtc } from './lib/recurrence'
import { loanSchedule } from './loans'

import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import type { ScheduleRow } from './lib/amortization'

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
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

export const debtTools = {
  listLoans,
  getLoanSchedule,
  listGuarantees,
  getPledgesOnDeal,
}
