/**
 * READ-ONLY diagnostic — no writes, ever.
 *
 * Surfaces the "umbrella" cleanup cases on the `albo` org (deals still pointing
 * at the archived chapeau companies « Sezame » and « Parallel Invest », while
 * the real per-SPV / per-entity companies exist), plus the candidate target
 * entities and the homonym duplicates on `calte`.
 *
 * Purpose: measure the exact scope before any manual repair via the UI. This
 * module is an `internalQuery` only — Convex queries CANNOT write, so running
 * it (even with `--prod`) mutates nothing:
 *
 *   pnpm exec convex run --prod migrations/diagnoseAlboUmbrellas:dryRun
 *
 * The repair itself is done by hand in the app (reassign each deal to the right
 * entity via the deal « Modifier » dialog, then archive the emptied umbrella).
 */
import { ConvexError } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel>

/** The two albo chapeau companies, anchored by their Attio id (stable). */
const UMBRELLAS = [
  {
    label: 'Sezame',
    attioCompanyId: '1b983a83-6a07-4253-8ab3-0a6e4c908103',
    // Real legal entities the deals should be reassigned to.
    targetNames: ['Sezame Immo 2', 'Sezame Immo 6'],
  },
  {
    label: 'Parallel Invest',
    attioCompanyId: '3b410d44-3a53-4001-a2f9-006a297f5dc7',
    targetNames: [
      'Parallel Invest SPV 10 (Arcachon)',
      'Parallel Invest SPV 13 (Bernay)',
      'Parallel Invest SPV 18 (Bour)',
      'Parallel Invest SPV 23 (STOA - Pessac)',
    ],
  },
] as const

async function getOrgBySlug(ctx: Ctx, slug: string) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!org) throw new ConvexError(`org_not_found:${slug}`)
  return org
}

async function countDealTransactions(ctx: Ctx, dealId: Id<'deals'>) {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .collect()
  return txs.length
}

/**
 * Incoming references that would block archiving a company — mirror of the
 * production guardrail (`convex/companies.ts:listBlockingRefs`), reproduced
 * here read-only so the report says exactly what remains.
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
      ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
    ])
  return {
    dealsAsTarget: asTarget.length,
    dealsAsInvestor: asInvestor.length,
    dealsAsViaSpv: orgDeals.filter((d) => d.viaSpvCompanyId === companyId).length,
    companyRelations: asParent.length + asChild.length,
    kpiSnapshots: kpis.length,
    bankAccounts: accounts.length,
    documents: docs.length,
  }
}

/** Compact view of a deal still attached to an umbrella (for manual mapping). */
const dealRow = (deal: Doc<'deals'>, transactions: number) => ({
  dealId: deal._id,
  name: deal.name ?? null,
  instrumentKind: deal.instrumentKind,
  status: deal.status,
  committedAmountCents: deal.committedAmount ?? null,
  paidAmountCents: deal.paidAmount ?? null,
  signedDate: deal.signedDate ?? null,
  attioDealId: deal.attioDealId ?? null,
  // notes often carry the original Attio SPV name → key to map deal → entity.
  notes: deal.notes ?? null,
  transactions,
})

/** Normalized key to catch case/accents/spacing-only duplicate names. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const albo = await getOrgBySlug(ctx, 'albo')

    // ── Albo umbrellas ──────────────────────────────────────────────────────
    const umbrellas = []
    for (const u of UMBRELLAS) {
      const company = await ctx.db
        .query('companies')
        .withIndex('by_attio_company_id', (q) =>
          q.eq('attioCompanyId', u.attioCompanyId),
        )
        .unique()

      if (!company || company.orgId !== albo._id) {
        umbrellas.push({ label: u.label, found: false })
        continue
      }

      const attachedDeals = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', albo._id).eq('targetCompanyId', company._id),
        )
        .collect()

      const deals = await Promise.all(
        attachedDeals.map(async (d) =>
          dealRow(d, await countDealTransactions(ctx, d._id)),
        ),
      )

      // Candidate target entities, by name, within albo.
      const orgCompanies = await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', albo._id))
        .collect()
      const candidateTargets = u.targetNames.map((name) => {
        const match = orgCompanies.find((c) => c.name === name)
        return {
          name,
          exists: match != null,
          companyId: match?._id ?? null,
          archived: match?.archivedAt != null,
          kind: match?.kind ?? null,
        }
      })

      const refs = await listBlockingRefs(ctx, albo._id, company._id)
      umbrellas.push({
        label: u.label,
        found: true,
        companyId: company._id,
        name: company.name,
        kind: company.kind,
        archived: company.archivedAt != null,
        attachedDealCount: deals.length,
        deals,
        candidateTargets,
        blockingRefs: refs,
        // After reassigning every attached deal away, would it be archivable?
        archivableOnceDealsReassigned:
          refs.dealsAsInvestor === 0 &&
          refs.dealsAsViaSpv === 0 &&
          refs.companyRelations === 0 &&
          refs.kpiSnapshots === 0 &&
          refs.bankAccounts === 0 &&
          refs.documents === 0,
      })
    }

    // ── Calte homonyms (read-only, list only) ─────────────────────────────────
    const calte = await getOrgBySlug(ctx, 'calte')
    const calteCompanies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', calte._id))
      .collect()

    // Exact duplicates modulo case / accents / spacing.
    const byNorm = new Map<string, Array<Doc<'companies'>>>()
    for (const c of calteCompanies) {
      const key = normalizeName(c.name)
      const bucket = byNorm.get(key) ?? []
      bucket.push(c)
      byNorm.set(key, bucket)
    }
    const caseDuplicates = [...byNorm.values()]
      .filter((bucket) => bucket.length > 1)
      .map((bucket) =>
        bucket.map((c) => ({
          companyId: c._id,
          name: c.name,
          kind: c.kind,
          archived: c.archivedAt != null,
        })),
      )

    // Prefix collisions (e.g. "SEZAME" vs "SEZAME IMMO 1"): a non-archived
    // company whose normalized name is a word-prefix of another's.
    const norms = calteCompanies.map((c) => ({ c, n: normalizeName(c.name) }))
    const prefixCollisions = []
    for (const a of norms) {
      const children = norms.filter(
        (b) => b.n !== a.n && b.n.startsWith(a.n + ' '),
      )
      if (children.length > 0) {
        prefixCollisions.push({
          base: { companyId: a.c._id, name: a.c.name, kind: a.c.kind },
          extends: children.map((b) => ({
            companyId: b.c._id,
            name: b.c.name,
            kind: b.c.kind,
          })),
        })
      }
    }

    return {
      readOnly: true,
      note: 'Lecture seule — aucune écriture. Mapping deal → entité à confirmer via les champs name/notes/attioDealId.',
      albo: { orgId: albo._id, umbrellas },
      calte: {
        orgId: calte._id,
        companyCount: calteCompanies.length,
        caseDuplicates,
        prefixCollisions,
      },
    }
  },
})
