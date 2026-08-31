/**
 * Bank debt: the loans a group company has taken out, and the dated series of
 * revisions of a variable rate.
 *
 * NOTHING derivable is stored. There is no "capital outstanding" column and
 * no table of instalments: the schedule is rebuilt on every read by the pure
 * engine `convex/lib/amortization.ts`, exactly as the current-account
 * balances are derived from the matched transactions (KNOWN_ISSUES.md
 * § Passif). The one assumed exception is the outstanding of a `revolving`
 * credit, which no schedule can deduce — it lives in `principalCents` and is
 * corrected by hand.
 *
 * Every function goes through `requireOrgMember`: a loan belongs to exactly
 * one org (the borrowing company), so there is no cross-org case here — that
 * arrives with the guarantees.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  attributeActuals,
  buildScheduleWithAmendments,
  outstandingAt,
  summarize,
} from './lib/amortization'
import { isActive, sortByStrength } from './lib/guarantees'
import { addMonthsUtc } from './lib/recurrence'
import {
  amortizationKind,
  loanDeferralKind,
  loanPaymentFrequency,
  loanRateKind,
  loanRateStepKind,
  loanStatus,
} from './schema'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type {
  LoanAmendment,
  LoanTerms,
  RateStep,
  ScheduleRow,
} from './lib/amortization'

/**
 * How far a revolving credit with no `endDate` is projected. Matches the
 * forecast layer's default horizon: past that, an open-ended credit would
 * generate interest rows forever.
 */
const REVOLVING_HORIZON_MONTHS = 24

/** The stored row, in the shape the pure engine expects. */
function termsOf(loan: Doc<'loans'>): LoanTerms {
  return {
    principalCents: loan.principalCents,
    firstPaymentDate: loan.firstPaymentDate,
    durationMonths: loan.durationMonths,
    amortizationKind: loan.amortizationKind,
    rateBps: loan.rateBps,
    rateKind: loan.rateKind,
    paymentFrequency: loan.paymentFrequency,
    deferralMonths: loan.deferralMonths,
    deferralKind: loan.deferralKind,
    insuranceMonthlyCents: loan.insuranceMonthlyCents,
    endDate: loan.endDate,
  }
}

/**
 * The loan's dated amendments, oldest first. Empty on a loan that has never
 * been renegotiated — which is every loan until someone uses the gesture.
 */
async function amendmentsOf(
  ctx: QueryCtx,
  loanId: Id<'loans'>,
): Promise<Array<LoanAmendment>> {
  const rows = await ctx.db
    .query('loanAmendments')
    .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
    .collect()
  return rows.map((row) => ({
    effectiveDate: row.effectiveDate,
    rateBps: row.rateBps,
    durationMonths: row.durationMonths,
    amortizationKind: row.amortizationKind,
    paymentFrequency: row.paymentFrequency,
    insuranceMonthlyCents: row.insuranceMonthlyCents,
    outstandingCents: row.outstandingCents,
  }))
}

/** The loan's rate steps, oldest first. Empty on a fixed-rate loan. */
async function ratesOf(
  ctx: QueryCtx,
  loanId: Id<'loans'>,
): Promise<Array<RateStep>> {
  const rows = await ctx.db
    .query('loanRates')
    .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
    .collect()
  return rows.map((row) => ({
    fromDate: row.fromDate,
    rateBps: row.rateBps,
    kind: row.kind,
  }))
}

/**
 * Schedule of a stored loan, amendments applied and the revolving
 * projection bounded. With no amendment this is the plain `buildSchedule`
 * of lot 1 — nothing changes for a loan that was never renegotiated.
 */
function scheduleOf(
  loan: Doc<'loans'>,
  rates: Array<RateStep>,
  now: number,
  amendments: Array<LoanAmendment> = [],
): Array<ScheduleRow> {
  return buildScheduleWithAmendments(termsOf(loan), rates, amendments, {
    horizonDate: addMonthsUtc(now, REVOLVING_HORIZON_MONTHS),
  })
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * An org's loans with their derived figures, for the « Dette bancaire »
 * section of the Passif page.
 *
 * Reads the rate steps but NOT the transactions: the list must not be
 * re-executed on every matching gesture (same rule as `liabilities.listOptions`
 * — cf. KNOWN_ISSUES.md § Pointage). The actual amounts belong to the loan
 * sheet.
 */
export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const now = Date.now()

    const loans = await ctx.db
      .query('loans')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const rows = await Promise.all(
      loans.map(async (loan) => {
        const rates = await ratesOf(ctx, loan._id)
        const amendments = await amendmentsOf(ctx, loan._id)
        const schedule = scheduleOf(loan, rates, now, amendments)
        const summary = summarize(loan, schedule, now)
        // The FORMS of the securities covering this loan, strongest first —
        // never their amounts (SPEC D44). The Passif list carries one nature
        // of figure in its right-hand column, the outstanding; a pledged
        // amount beside it would invite a comparison that means nothing. The
        // detail lives on the loan sheet.
        const pledges = await ctx.db
          .query('guarantees')
          .withIndex('by_loan', (q) => q.eq('loanId', loan._id))
          .collect()
        const guaranteeForms = [
          ...new Set(
            sortByStrength(pledges.filter(isActive)).map((row) => row.form),
          ),
        ]
        return {
          _id: loan._id,
          label: loan.label,
          guaranteeForms,
          lenderName: loan.lenderName,
          principalCents: loan.principalCents,
          amortizationKind: loan.amortizationKind,
          creditLimitCents: loan.creditLimitCents ?? null,
          rateKind: loan.rateKind,
          paymentFrequency: loan.paymentFrequency,
          signedDate: loan.signedDate,
          status: loan.status,
          // Derived, never stored. A cancelled or repaid loan owes nothing.
          outstandingCents:
            loan.status === 'active' ? summary.outstandingCents : 0,
          currentRateBps: summary.currentRateBps,
          currentPaymentCents: summary.currentPaymentCents,
          insuranceMonthlyCents: loan.insuranceMonthlyCents ?? null,
          lastPaymentDate: summary.lastPaymentDate,
        }
      }),
    )
    // Debt first, settled loans last; then the biggest outstanding.
    rows.sort((a, b) => {
      const rank = (s: string) => (s === 'active' ? 0 : s === 'repaid' ? 1 : 2)
      const byStatus = rank(a.status) - rank(b.status)
      return byStatus !== 0 ? byStatus : b.outstandingCents - a.outstandingCents
    })

    const totalOutstandingCents = rows.reduce(
      (sum, row) => sum + row.outstandingCents,
      0,
    )
    return { loans: rows, totalOutstandingCents }
  },
})

/**
 * Lightweight loan targets for the matching combobox: ids + labels only.
 * Reads NO transaction, exactly like `liabilities.listOptions` — a matching
 * gesture must not invalidate the options list. Settled loans stay out: they
 * are not a debit target any more.
 */
export const listOptions = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const loans = await ctx.db
      .query('loans')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'active'),
      )
      .collect()
    return loans.map((loan) => ({
      _id: loan._id,
      label: loan.label,
      lenderName: loan.lenderName,
    }))
  },
})

/**
 * The loan sheet: the row, its rate series, its full schedule, the matched
 * transactions and the headline figures — every one of them derived.
 *
 * Matching a direct debit to a loan is a POINTAGE gesture; the sheet only
 * reads (SPEC D41). The « Réel » column is the consequence of that gesture,
 * never a second way to perform it.
 */
export const getById = query({
  args: { loanId: v.id('loans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('loans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)
    const now = Date.now()

    const rateRows = await ctx.db
      .query('loanRates')
      .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
      .collect()
    const rates = rateRows.map((row) => ({
      fromDate: row.fromDate,
      rateBps: row.rateBps,
      kind: row.kind,
    }))
    const amendmentRows = await ctx.db
      .query('loanAmendments')
      .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
      .collect()
    const schedule = scheduleOf(
      loan,
      rates,
      now,
      await amendmentsOf(ctx, loanId),
    )
    const summary = summarize(loan, schedule, now)

    // Transactions matched to this loan — the « Réel » column of the
    // schedule and the transactions table under it.
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', loan.orgId).eq('allocation.targetId', loanId as string),
      )
      .collect()
    const transactions = txs
      .filter((tx) => tx.allocation?.kind === 'loan')
      .map((tx) => ({
        _id: tx._id,
        direction: tx.direction,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        rawLabel: tx.rawLabel,
        counterparty: tx.counterparty ?? null,
      }))
      .sort((a, b) => b.transactionDate - a.transactionDate)

    const account = loan.bankAccountId
      ? await ctx.db.get('bankAccounts', loan.bankAccountId)
      : null

    // Per-instalment actual: a CALENDAR attribution, never a likelihood
    // match (cf. lib/amortization.ts:attributeActuals).
    const actuals = attributeActuals(
      schedule,
      transactions.map((tx) => ({
        transactionDate: tx.transactionDate,
        amountCents: tx.direction === 'out' ? tx.amount : -tx.amount,
      })),
    )

    return {
      loan,
      transactions,
      // Actual outflows, all instalments together. The plan stays the source
      // of the outstanding; the actual is a CONTROL (§ 5.1) — a divergence
      // points at an incomplete matching or an unrecorded event, not a bug.
      paidCents: transactions.reduce(
        (sum, tx) => sum + (tx.direction === 'out' ? tx.amount : -tx.amount),
        0,
      ),
      rates: rateRows
        .map((row) => ({
          _id: row._id,
          fromDate: row.fromDate,
          rateBps: row.rateBps,
          kind: row.kind,
          notes: row.notes ?? null,
        }))
        .sort((a, b) => b.fromDate - a.fromDate),
      // Most recent first — the terms in force sit at the top.
      amendments: amendmentRows
        .map((row) => ({
          _id: row._id,
          effectiveDate: row.effectiveDate,
          rateBps: row.rateBps ?? null,
          durationMonths: row.durationMonths ?? null,
          amortizationKind: row.amortizationKind ?? null,
          paymentFrequency: row.paymentFrequency ?? null,
          insuranceMonthlyCents: row.insuranceMonthlyCents ?? null,
          outstandingCents: row.outstandingCents ?? null,
          notes: row.notes ?? null,
        }))
        .sort((a, b) => b.effectiveDate - a.effectiveDate),
      schedule: schedule.map((row, index) => ({
        ...row,
        actualCents: actuals[index],
      })),
      accountLabel: account ? (account.displayName ?? account.label) : null,
      summary: {
        ...summary,
        outstandingCents:
          loan.status === 'active' ? summary.outstandingCents : 0,
        // Revolving only: what is left to draw under the ceiling.
        availableCreditCents:
          loan.creditLimitCents != null
            ? loan.creditLimitCents - loan.principalCents
            : null,
      },
    }
  },
})

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Field coherence, shared by create and update. What the four amortization
 * kinds require differs, and accepting an incoherent row would produce an
 * empty schedule with no explanation.
 */
function assertValidTerms(args: {
  principalCents: number
  rateBps: number
  amortizationKind: Doc<'loans'>['amortizationKind']
  durationMonths?: number
  creditLimitCents?: number
  deferralMonths?: number
  insuranceMonthlyCents?: number
}) {
  if (args.principalCents <= 0) throw new ConvexError('invalid_amount')
  if (args.rateBps < 0) throw new ConvexError('invalid_rate')
  if (
    args.insuranceMonthlyCents != null &&
    args.insuranceMonthlyCents < 0
  ) {
    throw new ConvexError('invalid_amount')
  }
  if (args.amortizationKind === 'revolving') {
    // No schedule, hence no duration. A ceiling below the outstanding would
    // display a negative drawdown headroom.
    if (
      args.creditLimitCents != null &&
      args.creditLimitCents < args.principalCents
    ) {
      throw new ConvexError('limit_below_outstanding')
    }
    return
  }
  if (!args.durationMonths || args.durationMonths <= 0) {
    throw new ConvexError('missing_duration')
  }
  const deferral = args.deferralMonths ?? 0
  if (deferral < 0) throw new ConvexError('invalid_deferral')
  // A deferral covering the whole term would leave nothing to amortize.
  if (args.amortizationKind !== 'bullet' && deferral >= args.durationMonths) {
    throw new ConvexError('deferral_too_long')
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

const loanFields = {
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
  endDate: v.optional(v.number()),
  bankAccountId: v.optional(v.id('bankAccounts')),
  notes: v.optional(v.string()),
}

export const create = mutation({
  args: { orgId: v.id('organizations'), ...loanFields },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)
    const label = args.label.trim()
    const lenderName = args.lenderName.trim()
    if (!label || !lenderName) throw new ConvexError('invalid_label')
    assertValidTerms(args)

    // The direct-debit account must belong to the borrowing org, otherwise
    // the sheet would link to another tenant's account.
    if (args.bankAccountId) {
      const account = await ctx.db.get('bankAccounts', args.bankAccountId)
      if (!account || account.orgId !== args.orgId) {
        throw new ConvexError('account_wrong_org')
      }
    }

    return await ctx.db.insert('loans', {
      orgId: args.orgId,
      label,
      lenderName,
      principalCents: args.principalCents,
      signedDate: args.signedDate,
      firstPaymentDate: args.firstPaymentDate,
      durationMonths: args.durationMonths,
      amortizationKind: args.amortizationKind,
      creditLimitCents: args.creditLimitCents,
      rateBps: args.rateBps,
      rateKind: args.rateKind,
      insuranceMonthlyCents: args.insuranceMonthlyCents,
      paymentFrequency: args.paymentFrequency,
      deferralMonths: args.deferralMonths,
      deferralKind: args.deferralKind,
      endDate: args.endDate,
      bankAccountId: args.bankAccountId,
      status: 'active',
      notes: args.notes?.trim() || undefined,
    })
  },
})

/**
 * « Corriger » — full replacement of the terms, which recomputes the whole
 * schedule. The app cannot tell a typo from an amendment, so the lot 1
 * gesture OVERWRITES: keeping the before and the after of an amendment is
 * the « Mettre à jour au JJ/MM » gesture of lot 5 (SPEC D35, C7).
 *
 * Revising a VARIABLE rate is not a correction: it goes through `addRate`,
 * which is why `rateBps` here stays the rate at signature.
 */
export const update = mutation({
  args: {
    loanId: v.id('loans'),
    status: loanStatus,
    ...loanFields,
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)
    const label = args.label.trim()
    const lenderName = args.lenderName.trim()
    if (!label || !lenderName) throw new ConvexError('invalid_label')
    assertValidTerms(args)

    if (args.bankAccountId) {
      const account = await ctx.db.get('bankAccounts', args.bankAccountId)
      if (!account || account.orgId !== loan.orgId) {
        throw new ConvexError('account_wrong_org')
      }
    }

    await ctx.db.patch('loans', args.loanId, {
      label,
      lenderName,
      principalCents: args.principalCents,
      signedDate: args.signedDate,
      firstPaymentDate: args.firstPaymentDate,
      durationMonths: args.durationMonths,
      amortizationKind: args.amortizationKind,
      creditLimitCents: args.creditLimitCents,
      rateBps: args.rateBps,
      rateKind: args.rateKind,
      insuranceMonthlyCents: args.insuranceMonthlyCents,
      paymentFrequency: args.paymentFrequency,
      deferralMonths: args.deferralMonths,
      deferralKind: args.deferralKind,
      endDate: args.endDate,
      bankAccountId: args.bankAccountId,
      status: args.status,
      notes: args.notes?.trim() || undefined,
    })
    return null
  },
})

/**
 * Deletes a loan. Refused while guarantees still point at it
 * (`has_guarantees`, C11 — detach them first), while transactions are
 * matched to it (`has_allocations`, same guardrail as a current account),
 * or while documents hang off it (`has_documents`) — a deed must never be
 * orphaned in silence.
 */
export const remove = mutation({
  args: { loanId: v.id('loans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('loans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)

    const guarantee = await ctx.db
      .query('guarantees')
      .withIndex('by_loan', (q) => q.eq('loanId', loanId))
      .first()
    if (guarantee) throw new ConvexError('has_guarantees')

    const allocated = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', loan.orgId).eq('allocation.targetId', loanId as string),
      )
      .first()
    if (allocated) throw new ConvexError('has_allocations')

    const doc = await ctx.db
      .query('documents')
      .withIndex('by_loan', (q) => q.eq('loanId', loanId))
      .first()
    if (doc) throw new ConvexError('has_documents')

    // Neither the rate series nor the amendments have a life of their own —
    // they go with the loan.
    const rates = await ctx.db
      .query('loanRates')
      .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
      .collect()
    for (const rate of rates) await ctx.db.delete('loanRates', rate._id)
    const amendments = await ctx.db
      .query('loanAmendments')
      .withIndex('by_loan_from', (q) => q.eq('loanId', loanId))
      .collect()
    for (const row of amendments) {
      await ctx.db.delete('loanAmendments', row._id)
    }
    await ctx.db.delete('loans', loanId)
    return null
  },
})

// ─── Rate series (variable-rate loans) ──────────────────────────────────────

/**
 * Adds a step to the rate series: a revision that happened (`actual`) or a
 * steering assumption (`forecast`). One step per effective date — re-entering
 * the same date replaces the previous one rather than stacking a second
 * truth on it.
 *
 * Refused on a fixed-rate loan: there would be nothing to revise, and the
 * step would silently change a schedule the contract fixes.
 */
export const addRate = mutation({
  args: {
    loanId: v.id('loans'),
    fromDate: v.number(),
    rateBps: v.number(),
    kind: loanRateStepKind,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)
    if (loan.rateKind !== 'variable') throw new ConvexError('rate_is_fixed')
    if (args.rateBps < 0) throw new ConvexError('invalid_rate')

    const existing = await ctx.db
      .query('loanRates')
      .withIndex('by_loan_from', (q) =>
        q.eq('loanId', args.loanId).eq('fromDate', args.fromDate),
      )
      .first()
    if (existing) {
      await ctx.db.patch('loanRates', existing._id, {
        rateBps: args.rateBps,
        kind: args.kind,
        notes: args.notes?.trim() || undefined,
      })
      return existing._id
    }

    return await ctx.db.insert('loanRates', {
      orgId: loan.orgId,
      loanId: args.loanId,
      fromDate: args.fromDate,
      rateBps: args.rateBps,
      kind: args.kind,
      notes: args.notes?.trim() || undefined,
    })
  },
})

export const removeRate = mutation({
  args: { rateId: v.id('loanRates') },
  handler: async (ctx, { rateId }) => {
    const rate = await ctx.db.get('loanRates', rateId)
    if (!rate) throw new ConvexError('not_found')
    await requireOrgMember(ctx, rate.orgId)
    await ctx.db.delete('loanRates', rateId)
    return null
  },
})

// ─── Shared read core (agent tools reuse it after their own auth) ───────────

/**
 * The schedule of one loan, rate steps AND amendments applied.
 *
 * The single entry point for every reader — the loan sheet, the forecast
 * expansion, the « À faire » signal and the agent. Rebuilding it by hand
 * anywhere else is how the projection and the sheet come to disagree about
 * the same loan, which is exactly what a renegotiation would cause.
 */
export async function loanSchedule(
  ctx: QueryCtx,
  loan: Doc<'loans'>,
  opts: { horizonDate: number },
): Promise<Array<ScheduleRow>> {
  const [rates, amendments] = await Promise.all([
    ratesOf(ctx, loan._id),
    amendmentsOf(ctx, loan._id),
  ])
  return buildScheduleWithAmendments(termsOf(loan), rates, amendments, opts)
}

/** Outstanding capital of one loan at a date — derived, never stored. */
export async function loanOutstandingCents(
  ctx: QueryCtx,
  loan: Doc<'loans'>,
  at: number,
): Promise<number> {
  if (loan.status !== 'active') return 0
  const rates = await ratesOf(ctx, loan._id)
  const amendments = await amendmentsOf(ctx, loan._id)
  return outstandingAt(loan, scheduleOf(loan, rates, at, amendments), at)
}

// ─── Amendments (« Mettre à jour au JJ/MM ») ────────────────────────────────

/**
 * Records a dated amendment to the loan's terms. Only the fields that
 * actually change are passed; the rest carries over from the terms in force
 * before that date.
 *
 * This is the OTHER half of D35, and the difference with « Corriger » is the
 * whole point: `update` overwrites, as if the old terms had never existed —
 * that is for a typo. An amendment keeps them: the instalments already run
 * stay exactly as they were, and the new terms apply to the capital that
 * remains. The app cannot tell a typo from a renegotiation, so the user does.
 *
 * One amendment per effective date — re-entering the same date replaces the
 * previous one rather than stacking a second truth on it (same rule as a
 * rate step).
 *
 * Refused on a `revolving`: it has no schedule to segment, and its terms are
 * corrected in place.
 */
export const addAmendment = mutation({
  args: {
    loanId: v.id('loans'),
    effectiveDate: v.number(),
    rateBps: v.optional(v.number()),
    durationMonths: v.optional(v.number()),
    amortizationKind: v.optional(amortizationKind),
    paymentFrequency: v.optional(loanPaymentFrequency),
    insuranceMonthlyCents: v.optional(v.number()),
    outstandingCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)
    if (loan.amortizationKind === 'revolving') {
      throw new ConvexError('revolving_not_amendable')
    }
    if (args.effectiveDate <= loan.firstPaymentDate) {
      // Before the first instalment there is nothing to keep the history of:
      // that is a correction, not an amendment.
      throw new ConvexError('amendment_before_start')
    }
    if (args.rateBps != null && args.rateBps < 0) {
      throw new ConvexError('invalid_rate')
    }
    if (args.durationMonths != null && args.durationMonths <= 0) {
      throw new ConvexError('missing_duration')
    }
    if (args.outstandingCents != null && args.outstandingCents < 0) {
      throw new ConvexError('invalid_amount')
    }
    if (
      args.insuranceMonthlyCents != null &&
      args.insuranceMonthlyCents < 0
    ) {
      throw new ConvexError('invalid_amount')
    }

    const existing = await ctx.db
      .query('loanAmendments')
      .withIndex('by_loan_from', (q) =>
        q.eq('loanId', args.loanId).eq('effectiveDate', args.effectiveDate),
      )
      .first()
    const fields = {
      rateBps: args.rateBps,
      durationMonths: args.durationMonths,
      amortizationKind: args.amortizationKind,
      paymentFrequency: args.paymentFrequency,
      insuranceMonthlyCents: args.insuranceMonthlyCents,
      outstandingCents: args.outstandingCents,
      notes: args.notes?.trim() || undefined,
    }
    if (existing) {
      await ctx.db.patch('loanAmendments', existing._id, fields)
      return existing._id
    }
    return await ctx.db.insert('loanAmendments', {
      orgId: loan.orgId,
      loanId: args.loanId,
      effectiveDate: args.effectiveDate,
      ...fields,
    })
  },
})

export const removeAmendment = mutation({
  args: { amendmentId: v.id('loanAmendments') },
  handler: async (ctx, { amendmentId }) => {
    const amendment = await ctx.db.get('loanAmendments', amendmentId)
    if (!amendment) throw new ConvexError('not_found')
    await requireOrgMember(ctx, amendment.orgId)
    await ctx.db.delete('loanAmendments', amendmentId)
    return null
  },
})
