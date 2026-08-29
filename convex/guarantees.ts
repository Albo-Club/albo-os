/**
 * Guarantees: the link between a debt and the security that covers it.
 *
 * ONE row, three readings (SPEC D13) — from the loan, from the pledged
 * asset, from the guarantor. Nothing is stored twice, so nothing can
 * diverge.
 *
 * Authorization is NOT `requireOrgMember` alone: a guarantee legitimately
 * spans two orgs (the loan in `sci-chapelle`, the asset in `calte`).
 * `requireGuaranteeParty` mirrors `requireLoanParty` from
 * convex/liabilities.ts — membership of at least ONE party. Orgs stay flat;
 * there is no inheritance of rights.
 */

import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAppUser, requireOrgMember } from './lib/auth'
import { sortByStrength, summarizePledges } from './lib/guarantees'
import { guaranteeForm, guaranteeSubjectKind } from './schema'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { PledgeSummary } from './lib/guarantees'

/** The orgs a guarantee touches: borrower, guarantor, and asset holder. */
function partiesOf(
  guarantee: Pick<
    Doc<'guarantees'>,
    'borrowerOrgId' | 'pledgorOrgId' | 'subjectOrgId'
  >,
): Array<Id<'organizations'>> {
  return [
    guarantee.borrowerOrgId,
    guarantee.pledgorOrgId,
    guarantee.subjectOrgId,
  ].filter((orgId): orgId is Id<'organizations'> => orgId != null)
}

/**
 * Checks that the user is a member of at least one of the orgs a guarantee
 * touches (same rule as `requireLoanParty` for a current account).
 *
 * A guarantee with NO group org at all — an outside borrower, an outside
 * guarantor, an outside asset — has no party to be a member of, and is
 * refused: nothing in Albo OS would justify reading it.
 */
export async function requireGuaranteeParty(
  ctx: QueryCtx,
  guarantee: Pick<
    Doc<'guarantees'>,
    'borrowerOrgId' | 'pledgorOrgId' | 'subjectOrgId'
  >,
): Promise<void> {
  const user = await requireAppUser(ctx)
  const parties = partiesOf(guarantee)
  if (parties.length === 0) throw new ConvexError('not_a_party')
  const memberships = await Promise.all(
    parties.map((orgId) =>
      ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', user._id),
        )
        .unique(),
    ),
  )
  if (!memberships.some((member) => member !== null)) {
    throw new ConvexError('not_a_party')
  }
}

// ─── Shape returned to the front ────────────────────────────────────────────

/** Last known valuation of a deal — the asset value the margin compares to. */
async function dealValueCents(
  ctx: QueryCtx,
  dealId: Id<'deals'>,
): Promise<number | null> {
  const valuation = await ctx.db
    .query('valuations')
    .withIndex('by_deal_asof', (q) => q.eq('dealId', dealId))
    .order('desc')
    .first()
  if (valuation) return valuation.fairValue
  // No valuation yet: the deal's own carried value is the honest fallback.
  const deal = await ctx.db.get('deals', dealId)
  return deal?.currentValue ?? null
}

/** Human label of the pledged subject, and where to link to. */
async function describeSubject(ctx: QueryCtx, guarantee: Doc<'guarantees'>) {
  if (guarantee.subjectKind === 'placement' && guarantee.subjectDealId) {
    const deal = await ctx.db.get('deals', guarantee.subjectDealId)
    const target = deal?.targetCompanyId
      ? await ctx.db.get('companies', deal.targetCompanyId)
      : null
    return {
      label: deal?.name ?? target?.name ?? null,
      dealId: guarantee.subjectDealId,
      companyId: null,
    }
  }
  if (guarantee.subjectKind === 'shares' && guarantee.subjectCompanyId) {
    const company = await ctx.db.get('companies', guarantee.subjectCompanyId)
    return {
      label: company?.name ?? null,
      dealId: null,
      companyId: guarantee.subjectCompanyId,
    }
  }
  return {
    label: guarantee.subjectLabel ?? null,
    dealId: null,
    companyId: null,
  }
}

/** Org name, or the free-text label, or nothing. */
async function orgOrLabel(
  ctx: QueryCtx,
  orgId: Id<'organizations'> | undefined,
  label: string | undefined,
): Promise<{ name: string | null; orgSlug: string | null }> {
  if (orgId) {
    const org = await ctx.db.get('organizations', orgId)
    return { name: org?.name ?? null, orgSlug: org?.slug ?? null }
  }
  return { name: label ?? null, orgSlug: null }
}

/**
 * Every guarantee bearing on the same subject as `guarantee`, ACROSS ORGS.
 *
 * That cross-org read is not a consolidated view in the sense of D14 — it is
 * the reading of a link already accepted in D13. Without it, an asset
 * pledged for three different borrowers would show the margin of one of them
 * (SPEC § 6.5).
 */
async function siblingPledges(
  ctx: QueryCtx,
  guarantee: Doc<'guarantees'>,
): Promise<Array<Doc<'guarantees'>>> {
  if (guarantee.subjectKind === 'placement' && guarantee.subjectDealId) {
    return await ctx.db
      .query('guarantees')
      .withIndex('by_subject_deal', (q) =>
        q.eq('subjectDealId', guarantee.subjectDealId),
      )
      .collect()
  }
  if (guarantee.subjectKind === 'shares' && guarantee.subjectCompanyId) {
    return await ctx.db
      .query('guarantees')
      .withIndex('by_subject_company', (q) =>
        q.eq('subjectCompanyId', guarantee.subjectCompanyId),
      )
      .collect()
  }
  // An outside subject has no asset of ours to weigh against.
  return [guarantee]
}

/** Value of the pledged subject, or null when it is not one of our assets. */
async function subjectValueCents(
  ctx: QueryCtx,
  guarantee: Doc<'guarantees'>,
): Promise<number | null> {
  if (guarantee.subjectKind === 'placement' && guarantee.subjectDealId) {
    return await dealValueCents(ctx, guarantee.subjectDealId)
  }
  // Shares of a group company have no valuation table of their own, and an
  // outside subject is not ours to value — both answer « unknown » rather
  // than a zero that would read as « no margin left ».
  return null
}

/** One guarantee, enriched for display. */
async function enrich(ctx: QueryCtx, guarantee: Doc<'guarantees'>) {
  const [subject, pledgor, borrower] = await Promise.all([
    describeSubject(ctx, guarantee),
    orgOrLabel(ctx, guarantee.pledgorOrgId, guarantee.pledgorLabel),
    orgOrLabel(ctx, guarantee.borrowerOrgId, guarantee.borrowerLabel),
  ])
  return {
    _id: guarantee._id,
    form: guarantee.form,
    rank: guarantee.rank ?? null,
    pledgedAmountCents: guarantee.pledgedAmountCents ?? null,
    actDate: guarantee.actDate ?? null,
    releasedAt: guarantee.releasedAt ?? null,
    notes: guarantee.notes ?? null,
    loanId: guarantee.loanId ?? null,
    subjectKind: guarantee.subjectKind,
    subject,
    subjectOrgId: guarantee.subjectOrgId ?? null,
    pledgorName: pledgor.name,
    pledgorOrgSlug: pledgor.orgSlug,
    borrowerName: borrower.name,
    borrowerOrgSlug: borrower.orgSlug,
  }
}

export type EnrichedGuarantee = Awaited<ReturnType<typeof enrich>>

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * « Garanties » block of the loan sheet: what covers this loan, strongest
 * first (D48), each with the available margin on the asset it bites.
 */
export const listByLoan = query({
  args: { loanId: v.id('loans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('loans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireOrgMember(ctx, loan.orgId)

    const rows = await ctx.db
      .query('guarantees')
      .withIndex('by_loan', (q) => q.eq('loanId', loanId))
      .collect()

    return await Promise.all(
      sortByStrength(rows).map(async (guarantee) => ({
        ...(await enrich(ctx, guarantee)),
        // The margin is read from the WHOLE asset, all borrowers included —
        // otherwise this loan's own pledge would look like the only one.
        assetSummary: summarizePledges(
          await subjectValueCents(ctx, guarantee),
          await siblingPledges(ctx, guarantee),
        ) satisfies PledgeSummary,
      })),
    )
  },
})

/**
 * « Nantissements sur ce contrat » block of a placement sheet — the screen
 * that carries the module's main value (U3).
 *
 * Lists EVERY pledge on the asset, including those benefiting another group
 * company or an outside borrower (D-QA). Leaving the latter out is exactly
 * how the margin would be overstated.
 */
export const listBySubjectDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get('deals', dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('guarantees')
      .withIndex('by_subject_deal', (q) => q.eq('subjectDealId', dealId))
      .collect()

    const guarantees = await Promise.all(
      sortByStrength(rows).map(async (guarantee) => {
        const loan = guarantee.loanId
          ? await ctx.db.get('loans', guarantee.loanId)
          : null
        return {
          ...(await enrich(ctx, guarantee)),
          loanLabel: loan?.label ?? null,
        }
      }),
    )

    return {
      summary: summarizePledges(await dealValueCents(ctx, dealId), rows),
      guarantees,
    }
  },
})

/**
 * « Garanties données » block of the Passif page: the assets this org has
 * pledged for someone else. An off-balance-sheet commitment, not a debt —
 * which is why the section stands apart from the three others (SPEC § 6.3).
 */
export const listByPledgorOrg = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    const rows = await ctx.db
      .query('guarantees')
      .withIndex('by_pledgor_org', (q) => q.eq('pledgorOrgId', orgId))
      .collect()

    return await Promise.all(
      sortByStrength(rows).map(async (guarantee) => {
        const loan = guarantee.loanId
          ? await ctx.db.get('loans', guarantee.loanId)
          : null
        return {
          ...(await enrich(ctx, guarantee)),
          loanLabel: loan?.label ?? null,
        }
      }),
    )
  },
})

// ─── Validation ─────────────────────────────────────────────────────────────

const guaranteeArgs = {
  // Beneficiary — exactly one of the two.
  loanId: v.optional(v.id('loans')),
  borrowerLabel: v.optional(v.string()),
  // Guarantor — at most one of the two (unknown is a real case, SPEC Q-B).
  pledgorOrgId: v.optional(v.id('organizations')),
  pledgorLabel: v.optional(v.string()),
  // Subject.
  subjectKind: guaranteeSubjectKind,
  subjectDealId: v.optional(v.id('deals')),
  subjectCompanyId: v.optional(v.id('companies')),
  subjectLabel: v.optional(v.string()),
  // The pledge.
  form: guaranteeForm,
  rank: v.optional(v.number()),
  pledgedAmountCents: v.optional(v.number()),
  actDate: v.optional(v.number()),
  notes: v.optional(v.string()),
}

type GuaranteeArgs = {
  loanId?: Id<'loans'>
  borrowerLabel?: string
  pledgorOrgId?: Id<'organizations'>
  pledgorLabel?: string
  subjectKind: Doc<'guarantees'>['subjectKind']
  subjectDealId?: Id<'deals'>
  subjectCompanyId?: Id<'companies'>
  subjectLabel?: string
  rank?: number
  pledgedAmountCents?: number
}

/**
 * Resolves the denormalized orgs from the referenced rows — never from an
 * argument. `borrowerOrgId` comes from the loan, `subjectOrgId` from the
 * asset: a caller cannot claim a party it is not.
 *
 * Also enforces the shape: exactly one beneficiary, at most one guarantor,
 * and a subject matching its `subjectKind`.
 */
async function resolveParties(ctx: QueryCtx, args: GuaranteeArgs) {
  const borrowerLabel = args.borrowerLabel?.trim() || undefined
  if ((args.loanId != null) === (borrowerLabel != null)) {
    throw new ConvexError('ambiguous_borrower')
  }
  const pledgorLabel = args.pledgorLabel?.trim() || undefined
  if (args.pledgorOrgId && pledgorLabel) {
    throw new ConvexError('ambiguous_pledgor')
  }
  if (args.rank != null && args.rank < 1) throw new ConvexError('invalid_rank')
  if (args.pledgedAmountCents != null && args.pledgedAmountCents <= 0) {
    throw new ConvexError('invalid_amount')
  }

  let borrowerOrgId: Id<'organizations'> | undefined
  if (args.loanId) {
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    borrowerOrgId = loan.orgId
  }

  if (args.pledgorOrgId) {
    const org = await ctx.db.get('organizations', args.pledgorOrgId)
    if (!org) throw new ConvexError('not_found')
  }

  let subjectOrgId: Id<'organizations'> | undefined
  let subjectDealId: Id<'deals'> | undefined
  let subjectCompanyId: Id<'companies'> | undefined
  let subjectLabel: string | undefined

  if (args.subjectKind === 'placement') {
    if (!args.subjectDealId) throw new ConvexError('missing_subject')
    const deal = await ctx.db.get('deals', args.subjectDealId)
    if (!deal) throw new ConvexError('not_found')
    subjectDealId = deal._id
    subjectOrgId = deal.orgId
  } else if (args.subjectKind === 'shares') {
    if (!args.subjectCompanyId) throw new ConvexError('missing_subject')
    const company = await ctx.db.get('companies', args.subjectCompanyId)
    if (!company) throw new ConvexError('not_found')
    subjectCompanyId = company._id
    subjectOrgId = company.orgId
  } else {
    subjectLabel = args.subjectLabel?.trim() || undefined
    if (!subjectLabel) throw new ConvexError('missing_subject')
  }

  return {
    borrowerOrgId,
    borrowerLabel,
    pledgorLabel,
    subjectOrgId,
    subjectDealId,
    subjectCompanyId,
    subjectLabel,
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export const create = mutation({
  args: guaranteeArgs,
  handler: async (ctx, args) => {
    const resolved = await resolveParties(ctx, args)
    await requireGuaranteeParty(ctx, {
      borrowerOrgId: resolved.borrowerOrgId,
      pledgorOrgId: args.pledgorOrgId,
      subjectOrgId: resolved.subjectOrgId,
    })

    return await ctx.db.insert('guarantees', {
      loanId: args.loanId,
      borrowerOrgId: resolved.borrowerOrgId,
      borrowerLabel: resolved.borrowerLabel,
      pledgorOrgId: args.pledgorOrgId,
      pledgorLabel: resolved.pledgorLabel,
      subjectKind: args.subjectKind,
      subjectDealId: resolved.subjectDealId,
      subjectCompanyId: resolved.subjectCompanyId,
      subjectOrgId: resolved.subjectOrgId,
      subjectLabel: resolved.subjectLabel,
      form: args.form,
      rank: args.rank,
      pledgedAmountCents: args.pledgedAmountCents,
      actDate: args.actDate,
      notes: args.notes?.trim() || undefined,
    })
  },
})

/**
 * Full replacement of the editable fields (the dialog is prefilled with the
 * current values), including the parties: a guarantee mis-entered on the
 * wrong loan has to be fixable.
 *
 * The caller must be a party BOTH before and after the change — otherwise
 * one could walk a guarantee out of its own orgs, or into someone else's.
 */
export const update = mutation({
  args: { guaranteeId: v.id('guarantees'), ...guaranteeArgs },
  handler: async (ctx, { guaranteeId, ...args }) => {
    const existing = await ctx.db.get('guarantees', guaranteeId)
    if (!existing) throw new ConvexError('not_found')
    await requireGuaranteeParty(ctx, existing)

    const resolved = await resolveParties(ctx, args)
    await requireGuaranteeParty(ctx, {
      borrowerOrgId: resolved.borrowerOrgId,
      pledgorOrgId: args.pledgorOrgId,
      subjectOrgId: resolved.subjectOrgId,
    })

    await ctx.db.patch('guarantees', guaranteeId, {
      loanId: args.loanId,
      borrowerOrgId: resolved.borrowerOrgId,
      borrowerLabel: resolved.borrowerLabel,
      pledgorOrgId: args.pledgorOrgId,
      pledgorLabel: resolved.pledgorLabel,
      subjectKind: args.subjectKind,
      subjectDealId: resolved.subjectDealId,
      subjectCompanyId: resolved.subjectCompanyId,
      subjectOrgId: resolved.subjectOrgId,
      subjectLabel: resolved.subjectLabel,
      form: args.form,
      rank: args.rank,
      pledgedAmountCents: args.pledgedAmountCents,
      actDate: args.actDate,
      notes: args.notes?.trim() || undefined,
    })
    return null
  },
})

/**
 * Mainlevée (C6): the row STAYS — it is history — and leaves the pledged
 * total. Passing `releasedAt: undefined` puts it back in force, for the
 * mainlevée entered by mistake.
 */
export const setReleased = mutation({
  args: {
    guaranteeId: v.id('guarantees'),
    releasedAt: v.optional(v.number()),
  },
  handler: async (ctx, { guaranteeId, releasedAt }) => {
    const guarantee = await ctx.db.get('guarantees', guaranteeId)
    if (!guarantee) throw new ConvexError('not_found')
    await requireGuaranteeParty(ctx, guarantee)
    await ctx.db.patch('guarantees', guaranteeId, { releasedAt })
    return null
  },
})

/**
 * Deletes a guarantee. Refused while documents hang off it — a deed must
 * never be orphaned in silence (same guardrail as a loan).
 *
 * Deleting is for a row entered by mistake. A guarantee that ENDED is a
 * mainlevée: `setReleased`, which keeps the history.
 */
export const remove = mutation({
  args: { guaranteeId: v.id('guarantees') },
  handler: async (ctx, { guaranteeId }) => {
    const guarantee = await ctx.db.get('guarantees', guaranteeId)
    if (!guarantee) throw new ConvexError('not_found')
    await requireGuaranteeParty(ctx, guarantee)

    const doc = await ctx.db
      .query('documents')
      .withIndex('by_guarantee', (q) => q.eq('guaranteeId', guaranteeId))
      .first()
    if (doc) throw new ConvexError('has_documents')

    await ctx.db.delete('guarantees', guaranteeId)
    return null
  },
})
