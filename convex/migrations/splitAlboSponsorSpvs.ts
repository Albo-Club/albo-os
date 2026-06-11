/**
 * One-shot split: breaking up the Parallel Invest / Sezame umbrella companies
 * of the `albo` org into one company per issuing SPV.
 *
 * Context: the Attio import (`attioAlboImport.ts`) mirrors the Attio model
 * where 1 company = the platform and 1 deal = the SPV. Albo OS's target model
 * is "1 legal entity = 1 company": each SPV becomes its own company
 * (`kind: 'portfolio'`, `sponsor` = platform name), and the deal points to it
 * via `targetCompanyId`. The deals are already distinct (anchored by
 * `attioDealId`): no deal split, no re-attachment of transactions/valuations
 * (linked by `dealId`, unchanged).
 *
 * Scope: Parallel Invest (4 deals) + Sezame (2 deals). Rewatt deliberately
 * excluded — its deals stay on the umbrella company.
 *
 * Idempotent: the SPV companies are anchored by
 * `airtableId = split:attio:{attioDealId}` (index `by_airtable_id`).
 * Re-running `apply` creates no duplicates. ⚠️ Re-running
 * `attioAlboImport:run` re-points the deals to the umbrellas → re-run
 * `apply` afterwards (cf. KNOWN_ISSUES.md « Split chapeaux Attio → SPV »).
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod                                   # snapshot
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:apply
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

/** Helpers shared between dryRun/verify (query) and apply (mutation). */
type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'albo'

/** Umbrella companies to split (Attio bridge kept on the archived umbrella). */
const UMBRELLAS = [
  {
    sponsor: 'Parallel',
    name: 'Parallel Invest',
    attioCompanyId: '3b410d44-3a53-4001-a2f9-006a297f5dc7',
  },
  {
    sponsor: 'Sezame',
    name: 'Sezame',
    attioCompanyId: '1b983a83-6a07-4253-8ab3-0a6e4c908103',
  },
] as const

/**
 * Mapping Attio deal → target SPV company. The deal's Attio name stays in
 * `deal.notes` (unmodified) for traceability.
 */
const SPLITS = [
  {
    attioDealId: 'aba09139-1635-46e7-b69b-15ba81911303',
    sponsor: 'Parallel',
    companyName: 'Parallel Invest SPV 10 (Arcachon)',
  },
  {
    attioDealId: '8954c5d0-08d8-4486-9390-8d9f3ede17f1',
    sponsor: 'Parallel',
    companyName: 'Parallel Invest SPV 13 (Bernay)',
  },
  {
    attioDealId: '3e78f73d-28dc-4219-8718-89f056c3e48d',
    sponsor: 'Parallel',
    companyName: 'Parallel Invest SPV 18 (Bour)',
  },
  {
    attioDealId: 'dea72272-ca6a-4ab6-8b14-f8d42d6cfb19',
    sponsor: 'Parallel',
    companyName: 'Parallel Invest SPV 23 (STOA - Pessac)',
  },
  {
    attioDealId: '24a1198f-372c-41a9-b5a3-db09ad25e65f',
    sponsor: 'Sezame',
    companyName: 'Sezame Immo 2',
  },
  {
    attioDealId: 'f1f5daf6-ef86-46fe-a57c-3b9dcaed3b8a',
    sponsor: 'Sezame',
    companyName: 'Sezame Immo 6',
  },
] as const

/** Idempotency anchor of the SPV company created for a given deal. */
const splitKey = (attioDealId: string) => `split:attio:${attioDealId}`

// ─── Helpers (read-only) ──────────────────────────────────────────────────────

async function getAlboOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('albo_org_not_found')
  return org
}

async function getUmbrellaCompany(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  attioCompanyId: string,
) {
  const company = await ctx.db
    .query('companies')
    .withIndex('by_attio_company_id', (q) =>
      q.eq('attioCompanyId', attioCompanyId),
    )
    .unique()
  if (!company || company.orgId !== orgId) return null
  return company
}

/**
 * References (besides deals.targetCompanyId) still pointing to a company:
 * they block its archiving and are reported as-is.
 */
async function listBlockingRefs(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
) {
  const [asParent, asChild, kpis, accounts, orgDeals] = await Promise.all([
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
    // No index on viaSpvCompanyId / investorCompanyId: scan the org's deals
    // (low volume, one-shot migration).
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
  ])
  return {
    companyRelations: asParent.length + asChild.length,
    kpiSnapshots: kpis.length,
    bankAccounts: accounts.length,
    dealsAsViaSpv: orgDeals.filter((d) => d.viaSpvCompanyId === companyId)
      .length,
    dealsAsInvestor: orgDeals.filter((d) => d.investorCompanyId === companyId)
      .length,
  }
}

const hasBlockingRefs = (refs: Awaited<ReturnType<typeof listBlockingRefs>>) =>
  refs.companyRelations > 0 ||
  refs.kpiSnapshots > 0 ||
  refs.bankAccounts > 0 ||
  refs.dealsAsViaSpv > 0 ||
  refs.dealsAsInvestor > 0

async function countDealTransactions(ctx: Ctx, dealId: Id<'deals'>) {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .collect()
  return txs.length
}

const dealSummary = (deal: Doc<'deals'>) => ({
  attioDealId: deal.attioDealId ?? null,
  instrumentKind: deal.instrumentKind,
  status: deal.status,
  committedAmount: deal.committedAmount ?? null,
  paidAmount: deal.paidAmount ?? null,
  notes: deal.notes ?? null,
})

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const splitByDealId = new Map<string, (typeof SPLITS)[number]>(
      SPLITS.map((s) => [s.attioDealId, s]),
    )

    const umbrellas = []
    for (const u of UMBRELLAS) {
      const company = await getUmbrellaCompany(ctx, org._id, u.attioCompanyId)
      if (!company) {
        umbrellas.push({ name: u.name, status: 'not_found_in_prod' })
        continue
      }

      const deals = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', org._id).eq('targetCompanyId', company._id),
        )
        .collect()

      const plan = []
      const unresolved = []
      let totalPaid = 0
      let totalCommitted = 0
      for (const deal of deals) {
        const split = deal.attioDealId
          ? splitByDealId.get(deal.attioDealId)
          : undefined
        totalPaid += deal.paidAmount ?? 0
        totalCommitted += deal.committedAmount ?? 0
        const row = {
          ...dealSummary(deal),
          transactions: await countDealTransactions(ctx, deal._id),
        }
        if (split) {
          plan.push({ ...row, newCompanyName: split.companyName })
        } else {
          unresolved.push(row)
        }
      }

      const blockingRefs = await listBlockingRefs(ctx, org._id, company._id)
      umbrellas.push({
        name: company.name,
        companyId: company._id,
        kind: company.kind,
        attioCompanyId: company.attioCompanyId,
        alreadyArchived: company.archivedAt != null,
        dealCount: deals.length,
        // Invariant: the amounts do not move (we don't touch the deals, only
        // their targetCompanyId) — BEFORE = AFTER by construction.
        totalPaidAmount: totalPaid,
        totalCommittedAmount: totalCommitted,
        plan,
        unresolved,
        blockingRefs,
        willBeArchived:
          unresolved.length === 0 &&
          !hasBlockingRefs(blockingRefs) &&
          company.archivedAt == null,
      })
    }

    // Mapping entries whose deal does not exist in prod.
    const missingDeals = []
    for (const s of SPLITS) {
      const deal = await ctx.db
        .query('deals')
        .withIndex('by_attio_deal_id', (q) =>
          q.eq('attioDealId', s.attioDealId),
        )
        .unique()
      if (!deal) missingDeals.push(s.attioDealId)
    }

    return {
      org: org.slug,
      splitsPlanned: SPLITS.length,
      missingDeals,
      umbrellas,
      note:
        'Lecture seule. Valider ce rapport puis lancer ' +
        'migrations/splitAlboSponsorSpvs:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)

    let companiesCreated = 0
    let companiesReused = 0
    let dealsRepointed = 0
    const dealsSkipped: Array<{ attioDealId: string; reason: string }> = []

    for (const s of SPLITS) {
      const deal = await ctx.db
        .query('deals')
        .withIndex('by_attio_deal_id', (q) =>
          q.eq('attioDealId', s.attioDealId),
        )
        .unique()
      if (!deal) {
        dealsSkipped.push({ attioDealId: s.attioDealId, reason: 'deal_not_found' })
        continue
      }
      if (deal.orgId !== org._id) {
        dealsSkipped.push({ attioDealId: s.attioDealId, reason: 'wrong_org' })
        continue
      }

      // Upsert the SPV company (idempotency anchor: airtableId).
      const key = splitKey(s.attioDealId)
      const existing = await ctx.db
        .query('companies')
        .withIndex('by_airtable_id', (q) => q.eq('airtableId', key))
        .unique()
      let spvCompanyId: Id<'companies'>
      if (existing) {
        spvCompanyId = existing._id
        companiesReused++
      } else {
        spvCompanyId = await ctx.db.insert('companies', {
          orgId: org._id,
          name: s.companyName,
          kind: 'portfolio',
          sponsor: s.sponsor,
          airtableId: key,
        })
        companiesCreated++
      }

      if (deal.targetCompanyId !== spvCompanyId) {
        await ctx.db.patch('deals', deal._id, { targetCompanyId: spvCompanyId })
        dealsRepointed++
      }
    }

    // Archive the umbrellas: only if no reference remains.
    const umbrellasArchived: Array<string> = []
    const umbrellasKept: Array<{ name: string; reason: string }> = []
    for (const u of UMBRELLAS) {
      const company = await getUmbrellaCompany(ctx, org._id, u.attioCompanyId)
      if (!company) {
        umbrellasKept.push({ name: u.name, reason: 'not_found_in_prod' })
        continue
      }
      if (company.archivedAt != null) {
        umbrellasKept.push({ name: u.name, reason: 'already_archived' })
        continue
      }
      const remainingDeals = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', org._id).eq('targetCompanyId', company._id),
        )
        .collect()
      const blockingRefs = await listBlockingRefs(ctx, org._id, company._id)
      if (remainingDeals.length > 0 || hasBlockingRefs(blockingRefs)) {
        umbrellasKept.push({
          name: u.name,
          reason: `still_referenced (deals: ${remainingDeals.length}, refs: ${JSON.stringify(blockingRefs)})`,
        })
        continue
      }
      await ctx.db.patch('companies', company._id, { archivedAt: Date.now() })
      umbrellasArchived.push(company.name)
    }

    return {
      companiesCreated,
      companiesReused,
      dealsRepointed,
      dealsSkipped,
      umbrellasArchived,
      umbrellasKept,
    }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)

    // Split deals: expected target = non-archived SPV company + sponsor.
    const splitDeals = []
    for (const s of SPLITS) {
      const deal = await ctx.db
        .query('deals')
        .withIndex('by_attio_deal_id', (q) =>
          q.eq('attioDealId', s.attioDealId),
        )
        .unique()
      if (!deal) {
        splitDeals.push({ attioDealId: s.attioDealId, error: 'deal_not_found' })
        continue
      }
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      splitDeals.push({
        attioDealId: s.attioDealId,
        target: target?.name ?? null,
        sponsor: target?.sponsor ?? null,
        ok:
          target != null &&
          target.name === s.companyName &&
          target.sponsor === s.sponsor &&
          target.archivedAt == null,
      })
    }

    // Orphans: org deals whose target is missing or archived.
    const orgDeals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const orphanDeals = []
    for (const deal of orgDeals) {
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      if (!target || target.archivedAt != null) {
        orphanDeals.push({
          ...dealSummary(deal),
          target: target?.name ?? null,
        })
      }
    }

    // State of the umbrellas.
    const umbrellas = []
    for (const u of UMBRELLAS) {
      const company = await getUmbrellaCompany(ctx, org._id, u.attioCompanyId)
      umbrellas.push({
        name: u.name,
        found: company != null,
        archived: company?.archivedAt != null,
      })
    }

    const allOk =
      splitDeals.every((d) => 'ok' in d && d.ok) && orphanDeals.length === 0
    return { org: org.slug, allOk, splitDeals, orphanDeals, umbrellas }
  },
})
