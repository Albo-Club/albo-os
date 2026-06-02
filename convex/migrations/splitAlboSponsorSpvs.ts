/**
 * Split one-shot : éclatement des companies chapeaux Parallel Invest / Sezame
 * de l'org `albo` en une company par SPV émetteur.
 *
 * Contexte : l'import Attio (`attioAlboImport.ts`) reflète le modèle Attio où
 * 1 company = la plateforme et 1 deal = le SPV. Le modèle cible d'Albo OS est
 * « 1 entité juridique = 1 company » : chaque SPV devient sa propre company
 * (`kind: 'portfolio'`, `sponsor` = nom de la plateforme), et le deal pointe
 * dessus via `targetCompanyId`. Les deals sont déjà distincts (ancre
 * `attioDealId`) : aucun split de deal, aucun re-rattachement de
 * transactions/valuations (liées par `dealId`, inchangé).
 *
 * Scope : Parallel Invest (4 deals) + Sezame (2 deals). Rewatt exclu
 * volontairement — ses deals restent sur la company chapeau.
 *
 * Idempotent : les companies SPV sont ancrées par
 * `airtableId = split:attio:{attioDealId}` (index `by_airtable_id`).
 * Re-lancer `apply` ne crée aucun doublon. ⚠️ Re-lancer
 * `attioAlboImport:run` re-pointe les deals vers les chapeaux → re-lancer
 * `apply` ensuite (cf. KNOWN_ISSUES.md « Split chapeaux Attio → SPV »).
 *
 * Ordre d'exécution (prod, manuel) :
 *   pnpm exec convex export --prod                                   # snapshot
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:dryRun
 *   # STOP : valider le rapport, puis seulement :
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:apply
 *   pnpm exec convex run --prod migrations/splitAlboSponsorSpvs:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

/** Helpers partagés entre dryRun/verify (query) et apply (mutation). */
type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'albo'

/** Companies chapeaux à éclater (pont Attio conservé sur le chapeau archivé). */
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
 * Mapping deal Attio → company SPV cible. Le nom Attio du deal reste dans
 * `deal.notes` (non modifié) pour la traçabilité.
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

/** Ancre d'idempotence de la company SPV créée pour un deal donné. */
const splitKey = (attioDealId: string) => `split:attio:${attioDealId}`

// ─── Helpers (lecture) ────────────────────────────────────────────────────────

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
 * Références (hors deals.targetCompanyId) qui pointent encore vers une
 * company : elles bloquent son archivage et sont rapportées telles quelles.
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
    // Pas d'index sur viaSpvCompanyId / investorCompanyId : scan des deals de
    // l'org (volume faible, migration one-shot).
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

// ─── dryRun — lecture seule, point d'arrêt avant toute écriture ──────────────

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
        // Invariant : les montants ne bougent pas (on ne touche pas aux deals,
        // seulement à leur targetCompanyId) — AVANT = APRÈS par construction.
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

    // Entrées du mapping dont le deal n'existe pas en prod.
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

// ─── apply — écritures, idempotent, à lancer après validation du dryRun ──────

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

      // Upsert de la company SPV (ancre d'idempotence : airtableId).
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

    // Archivage des chapeaux : uniquement si plus aucune référence.
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

// ─── verify — rapport final post-apply ───────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)

    // Deals splittés : target attendue = company SPV non archivée + sponsor.
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

    // Orphelins : deals de l'org dont la target est absente ou archivée.
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

    // État des chapeaux.
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
