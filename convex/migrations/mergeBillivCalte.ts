/**
 * Merges the two BILLIV cards of the `calte` org onto a single one.
 *
 * Context. `calte` carries the same company twice — same domain (`billiv.fr`),
 * same pitch, same summary — because the Airtable import created one card per
 * entry wave:
 *
 *   - `SIDE ASTERION BILLIV` — the first entry, signed 31/12/2021, 25 000 €.
 *   - `SIDE ASTERION - Projet BILLIV 2024 T2` — the follow-on, signed
 *     25/03/2024, 100 004 €.
 *
 * One legal entity = one `company`, so the follow-on moves onto the card that
 * carries the oldest deal, and the emptied card is archived. The 2024 label is
 * kept on `deals.name` (only when the deal has none): once its card is gone,
 * nothing else says which wave that 100 004 € belongs to, and both deals would
 * otherwise render the same derived title.
 *
 * The transactions follow on their own: they carry a `dealId`, never a company,
 * so the pointed movements stay attached without being touched.
 *
 * Idempotent & guarded: both cards are anchored by their prod `_id` and
 * cross-checked on their exact current name; the deal is cross-checked on its
 * `paidAmount`, and accepted BOTH on its source card and on the canonical one
 * (same rule as `reassignClimateHouseCofoDeals`), so a second run reports
 * nothing to do rather than failing. The canonical card is itself verified to
 * carry the 2021 deal — that is what makes it the survivor. A card that still
 * carries a reference is reported, not archived.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/mergeBillivCalte:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/mergeBillivCalte:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** The surviving card — the one carrying the oldest deal (31/12/2021). */
const CANONICAL = {
  id: 'jx7aqyk12f19aqae93jdfq7cp987rjft',
  expectedName: 'SIDE ASTERION BILLIV',
  /** 25 000 € signed 31/12/2021 — the reason this card is the survivor. */
  anchorDealId: 'k57as8nrd9pnyqxa695pf3z3z987rj79',
  anchorPaidAmount: 25_000_00,
}

/** The card being emptied then archived. */
const DUPLICATE = {
  id: 'jx7e7sde3nbxky1jw3en14jh5x87sfff',
  expectedName: 'SIDE ASTERION - Projet BILLIV 2024 T2',
}

/** The deal to move — 100 004 € signed 25/03/2024. */
const MOVE = {
  dealId: 'k57c4mq8f5129h8w9r8ga4kpen87sm5q',
  expectedPaidAmount: 100_004_00,
  /** Written to `deals.name` only when the deal has none. */
  dealName: 'Projet BILLIV 2024 T2',
}

async function getOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError('calte_org_absent')
  return org
}

/**
 * Everything that can still name a card. The duplicate goes only when it
 * scores zero on all of it — same inventory as the sibling migrations.
 */
async function refs(ctx: Ctx, orgId: Id<'organizations'>, id: Id<'companies'>) {
  const [
    asTarget,
    asInvestor,
    allDeals,
    relParent,
    relChild,
    docs,
    reports,
    intel,
    links,
    banks,
    kpis,
    todos,
    transfers,
    inbox,
  ] = await Promise.all([
    ctx.db
      .query('deals')
      .withIndex('by_org_target', (q) =>
        q.eq('orgId', orgId).eq('targetCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org_investor', (q) =>
        q.eq('orgId', orgId).eq('investorCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_parent', (q) =>
        q.eq('orgId', orgId).eq('parentCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_child', (q) =>
        q.eq('orgId', orgId).eq('childCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('documents')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyEmailLinks')
      .withIndex('by_company_and_sentAt', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('bankAccounts')
      .withIndex('by_owner', (q) =>
        q.eq('orgId', orgId).eq('ownerCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('kpiSnapshots')
      .withIndex('by_company_metric', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('todos')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
    ctx.db
      .query('transfers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
    // Bounded on purpose: only the queue still shown to a human can name an
    // archived card, and the full table carries every rawContent/cleanedHtml
    // (cf. CLAUDE.md, « un gros champ texte sur une ligne lue en liste »).
    ctx.db
      .query('inboundEmails')
      .withIndex('by_status', (q) => q.eq('status', 'needs_review'))
      .collect(),
  ])
  return {
    deals:
      asTarget.length +
      asInvestor.length +
      allDeals.filter((d) => d.viaSpvCompanyId === id).length,
    relations: relParent.length + relChild.length,
    documents: docs.length,
    reports: reports.length,
    intelligence: intel.length,
    emailLinks: links.length,
    bankAccounts: banks.length,
    kpiSnapshots: kpis.length,
    todos: todos.filter((t) => t.companyId === id).length,
    transfers: transfers.filter((t) => t.ownerCompanyId === id).length,
    inbox: inbox.filter((e) =>
      (e.matchedCompanies ?? []).some((m) => m.companyId === id),
    ).length,
  }
}

const total = (r: Record<string, number>) =>
  Object.values(r).reduce((s, n) => s + n, 0)

const nonZero = (r: Record<string, number>) =>
  Object.fromEntries(Object.entries(r).filter(([, n]) => n > 0))

/**
 * Loads and cross-checks the two cards and the deal to move. Accepts the deal
 * BOTH on the duplicate and on the canonical card, so a second run is a no-op
 * rather than a failure.
 */
async function resolve(ctx: Ctx, orgId: Id<'organizations'>) {
  const canonical = await ctx.db.get(
    'companies',
    CANONICAL.id as Id<'companies'>,
  )
  if (!canonical || canonical.orgId !== orgId) {
    throw new ConvexError('canonical_card_absent')
  }
  if (canonical.name !== CANONICAL.expectedName) {
    throw new ConvexError(`canonical_name_mismatch:${canonical.name}`)
  }
  if (canonical.archivedAt != null) throw new ConvexError('canonical_archived')

  // The oldest deal is what designates the survivor: check it is still there.
  const anchor = await ctx.db.get(
    'deals',
    CANONICAL.anchorDealId as Id<'deals'>,
  )
  if (
    !anchor ||
    anchor.orgId !== orgId ||
    anchor.targetCompanyId !== canonical._id ||
    anchor.paidAmount !== CANONICAL.anchorPaidAmount
  ) {
    throw new ConvexError('canonical_anchor_deal_mismatch')
  }

  const duplicate = await ctx.db.get(
    'companies',
    DUPLICATE.id as Id<'companies'>,
  )
  if (!duplicate || duplicate.orgId !== orgId) {
    throw new ConvexError('duplicate_card_absent')
  }
  if (duplicate.name !== DUPLICATE.expectedName) {
    throw new ConvexError(`duplicate_name_mismatch:${duplicate.name}`)
  }

  const deal = await ctx.db.get('deals', MOVE.dealId as Id<'deals'>)
  if (!deal || deal.orgId !== orgId) throw new ConvexError('deal_absent')
  if (deal.paidAmount !== MOVE.expectedPaidAmount) {
    throw new ConvexError(`deal_paid_amount_mismatch:${deal.paidAmount}`)
  }
  const onCanonical = deal.targetCompanyId === canonical._id
  const onDuplicate = deal.targetCompanyId === duplicate._id
  if (!onCanonical && !onDuplicate) {
    throw new ConvexError('deal_points_at_a_third_company')
  }

  return { canonical, duplicate, deal, alreadyMoved: onCanonical }
}

// ─── dryRun ──────────────────────────────────────────────────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const { canonical, duplicate, deal, alreadyMoved } = await resolve(
      ctx,
      orgId,
    )

    const cardRefs = await refs(ctx, orgId, duplicate._id)
    // The deal itself still counts as a reference until it moves.
    const after = alreadyMoved
      ? cardRefs
      : { ...cardRefs, deals: cardRefs.deals - 1 }

    return {
      org: { slug: org.slug, id: orgId },
      canonical: { name: canonical.name, id: canonical._id },
      duplicate: {
        name: duplicate.name,
        id: duplicate._id,
        archivedAt: duplicate.archivedAt ?? null,
      },
      move: {
        paidAmount: deal.paidAmount,
        currentName: deal.name ?? null,
        willMove: !alreadyMoved,
        willSetName: deal.name == null || deal.name.trim() === '',
      },
      willArchiveDuplicate: duplicate.archivedAt == null && total(after) === 0,
      ...(total(after) > 0 ? { archiveBlockedBy: nonZero(after) } : {}),
    }
  },
})

// ─── apply ───────────────────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const { canonical, duplicate, deal, alreadyMoved } = await resolve(
      ctx,
      orgId,
    )

    let moved = false
    let named = false
    if (!alreadyMoved) {
      const setName = deal.name == null || deal.name.trim() === ''
      // `manuallyEditedFields` keeps a later Airtable re-import from putting
      // the duplicate card back as the target (cf. convex/airtableImport.ts).
      const edited = new Set(deal.manuallyEditedFields ?? [])
      edited.add('targetCompanyId')
      if (setName) edited.add('name')
      await ctx.db.patch('deals', deal._id, {
        targetCompanyId: canonical._id,
        ...(setName ? { name: MOVE.dealName } : {}),
        manuallyEditedFields: [...edited],
      })
      moved = true
      named = setName
    }

    let archived = false
    let blockedBy: Record<string, number> | null = null
    if (duplicate.archivedAt == null) {
      const cardRefs = await refs(ctx, orgId, duplicate._id)
      if (total(cardRefs) > 0) {
        blockedBy = nonZero(cardRefs)
      } else {
        await ctx.db.patch('companies', duplicate._id, {
          archivedAt: Date.now(),
        })
        archived = true
      }
    }

    return {
      moved: moved
        ? `${(deal.paidAmount ?? 0) / 100} € : ${DUPLICATE.expectedName} → ${CANONICAL.expectedName}`
        : 'already on the canonical card',
      dealNamed: named ? MOVE.dealName : null,
      archived,
      ...(blockedBy ? { archiveBlockedBy: blockedBy } : {}),
    }
  },
})
