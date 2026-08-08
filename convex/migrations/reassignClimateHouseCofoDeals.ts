/**
 * Splits the Climate House co-founders' vehicle out of the Climate House card,
 * and stops presenting two natural persons as portfolio companies.
 *
 * Context. `Cofo Climate House` is a legal person of its own, distinct from
 * `CLIMATE HOUSE`. The `calte` portfolio conflated the two:
 *
 *   - CALTE's entry into the co-founders' vehicle (10 000 €, 17/11/2025) was
 *     booked as a deal ON the Climate House card. The signed 31/12/2025
 *     accounts carry it separately — « TP LES COFOS DE LA CLIMATE HOUSE »
 *     at 10 000 €, new in 2025 — next to « TP CLIMATE HOUSE (2,22 %) » at
 *     20 100 €. Two lines, two entities.
 *   - On 18/05/2026 CALTE bought back, from two co-founders, the shares they
 *     held in that vehicle. The Airtable import read the SELLER as the
 *     investment target, so the portfolio gained a card for
 *     `EL IDRISSI MOHAMED` and one for `KUHANATHAN Ano Sujithan`, 2 000 € each
 *     — two people presented as companies one can invest in. The asset bought
 *     is the co-founders' vehicle, in both cases.
 *
 * What this migration does:
 *   1. Creates the `Cofo Climate House` card (reuses it if it already exists,
 *      so a second run is a no-op).
 *   2. Moves the three deals onto it — the 10 000 € entry and the two 2 000 €
 *      buy-backs — for 14 000 € total. `CLIMATE HOUSE` keeps its 20 000 € of
 *      shares and its 90 000 € current account.
 *   3. Names each buy-back after its seller. Without it the card would carry
 *      two indistinguishable 2 000 € deals signed the same day.
 *   4. Archives the two person cards, once nothing points at them.
 *
 * The transactions follow on their own: they carry a `dealId`, never a company,
 * so the pointed movements stay attached without being touched.
 *
 * Idempotent & guarded: every row is anchored by its prod `_id` and
 * cross-checked on its exact current name and amount. A deal is accepted BOTH
 * on its source card and on the canonical one (same rule as
 * `consolidateRewattCalte`), so a second run reports nothing to do rather than
 * failing. A card that still carries a reference is reported, not archived.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/reassignClimateHouseCofoDeals:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/reassignClimateHouseCofoDeals:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** The card to create — the co-founders' vehicle, a legal person of its own. */
const COFO_NAME = 'Cofo Climate House'

/** The card the three deals are leaving (only the 10 000 € one sits there). */
const CLIMATE_HOUSE = {
  id: 'jx76a4fwc5wd7gtvmjdw5wwcmx87r51v',
  expectedName: 'CLIMATE HOUSE',
}

type Move = {
  dealId: string
  /** The card the deal sits on today. */
  fromCardId: string
  expectedFrom: string
  expectedPaidAmount: number
  /** Set when `fromCardId` is a person to archive once the deal has left. */
  archiveFrom: boolean
  /** Set on the buy-backs, to tell two same-day 2 000 € deals apart. */
  dealName?: string
}

const MOVES: Array<Move> = [
  {
    // « TP LES COFOS DE LA CLIMATE HOUSE » — 10 000 € at 31/12/2025.
    dealId: 'k57djgtgqtqs7kfm610h9z6atx8c0hj6',
    fromCardId: CLIMATE_HOUSE.id,
    expectedFrom: CLIMATE_HOUSE.expectedName,
    expectedPaidAmount: 10_000_00,
    archiveFrom: false,
  },
  {
    dealId: 'k578cxnqm7sakmmqnwdwpx7x7x87rm4f',
    fromCardId: 'jx74kg82br0c99ny4pxgen1tth87s35p',
    expectedFrom: 'EL IDRISSI MOHAMED',
    expectedPaidAmount: 2_000_00,
    archiveFrom: true,
    dealName: 'Rachat titres cofondateur — El Idrissi',
  },
  {
    dealId: 'k572jqq4ev9y5rrtxhvcb0rgax87rnr2',
    fromCardId: 'jx7exx1ad319pjpkaqkgk25wfs87s9qs',
    expectedFrom: 'KUHANATHAN Ano Sujithan',
    expectedPaidAmount: 2_000_00,
    archiveFrom: true,
    dealName: 'Rachat titres cofondateur — Kuhanathan',
  },
]

async function getOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError('calte_org_absent')
  return org
}

/** The `Cofo Climate House` card if a previous run already created it. */
async function findCofo(ctx: Ctx, orgId: Id<'organizations'>) {
  const rows = await ctx.db
    .query('companies')
    .withIndex('by_org_kind', (q) => q.eq('orgId', orgId).eq('kind', 'portfolio'))
    .collect()
  return rows.find((c) => c.name === COFO_NAME && c.archivedAt == null) ?? null
}

/**
 * Everything that can still name a card. A person card goes only when it scores
 * zero on all of it — same inventory as the sibling migrations.
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
 * Resolves one move, accepting BOTH the source card and the canonical one so a
 * second run is a no-op rather than a failure. `cofo` is null on the first
 * `dryRun`, when the card does not exist yet.
 */
async function resolve(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: Move,
  cofo: Doc<'companies'> | null,
) {
  const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
  if (!deal || deal.orgId !== orgId) return { skip: 'deal not found' }
  if (deal.paidAmount !== spec.expectedPaidAmount) {
    return { skip: `paidAmount changed (${deal.paidAmount})` }
  }
  const from = await ctx.db.get('companies', spec.fromCardId as Id<'companies'>)
  if (!from || from.orgId !== orgId) return { skip: 'source card not found' }
  if (from.name !== spec.expectedFrom) {
    return { skip: `source name mismatch (${from.name})` }
  }
  const onCofo = cofo != null && deal.targetCompanyId === cofo._id
  const onSource = deal.targetCompanyId === from._id
  if (!onCofo && !onSource) return { skip: 'deal points at a third company' }
  return { deal, from, alreadyMoved: onCofo }
}

// ─── dryRun ──────────────────────────────────────────────────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id

    const ch = await ctx.db.get('companies', CLIMATE_HOUSE.id as Id<'companies'>)
    if (!ch || ch.orgId !== orgId) throw new ConvexError('climate_house_absent')
    if (ch.name !== CLIMATE_HOUSE.expectedName) {
      throw new ConvexError(`climate_house_name_mismatch:${ch.name}`)
    }

    const cofo = await findCofo(ctx, orgId)

    const moves = await Promise.all(
      MOVES.map(async (spec) => {
        const r = await resolve(ctx, orgId, spec, cofo)
        if ('skip' in r) return { from: spec.expectedFrom, skip: r.skip }
        const base = {
          from: spec.expectedFrom,
          paidAmount: r.deal.paidAmount,
          dealName: spec.dealName ?? null,
          willMove: !r.alreadyMoved,
        }
        if (!spec.archiveFrom) return base
        const cardRefs = await refs(ctx, orgId, r.from._id)
        // The deal itself still counts as a reference until it moves.
        const after = r.alreadyMoved
          ? cardRefs
          : { ...cardRefs, deals: cardRefs.deals - 1 }
        return {
          ...base,
          willArchiveCard: r.from.archivedAt == null && total(after) === 0,
          ...(total(after) > 0 ? { cardBlockedBy: nonZero(after) } : {}),
        }
      }),
    )

    const chDeals = await ctx.db
      .query('deals')
      .withIndex('by_org_target', (q) =>
        q.eq('orgId', orgId).eq('targetCompanyId', ch._id),
      )
      .collect()

    return {
      org: { slug: org.slug, id: orgId },
      cofoCard: cofo
        ? { status: 'exists', id: cofo._id }
        : { status: 'will_be_created', name: COFO_NAME },
      climateHouse: {
        dealsNow: chDeals.length,
        dealsAfter: chDeals.length - (cofo ? 0 : 1),
      },
      moves,
      totals: {
        willMove: moves.filter((m) => 'willMove' in m && m.willMove).length,
        willArchiveCard: moves.filter(
          (m) => 'willArchiveCard' in m && m.willArchiveCard,
        ).length,
        blocked: moves.filter(
          (m) =>
            'skip' in m || ('willArchiveCard' in m && !m.willArchiveCard),
        ).length,
      },
    }
  },
})

// ─── apply ───────────────────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const moved: Array<string> = []
    const archived: Array<string> = []
    const skipped: Array<string> = []

    const ch = await ctx.db.get('companies', CLIMATE_HOUSE.id as Id<'companies'>)
    if (!ch || ch.orgId !== orgId) throw new ConvexError('climate_house_absent')
    if (ch.name !== CLIMATE_HOUSE.expectedName) {
      throw new ConvexError(`climate_house_name_mismatch:${ch.name}`)
    }

    let cofo = await findCofo(ctx, orgId)
    let created = false
    if (!cofo) {
      const id = await ctx.db.insert('companies', {
        orgId,
        name: COFO_NAME,
        kind: 'portfolio',
        countryCode: 'FR',
      })
      cofo = await ctx.db.get('companies', id)
      created = true
    }
    if (!cofo) throw new ConvexError('cofo_card_absent')

    for (const spec of MOVES) {
      const r = await resolve(ctx, orgId, spec, cofo)
      if ('skip' in r) {
        skipped.push(`${spec.expectedFrom}: ${r.skip}`)
        continue
      }
      const needsName = spec.dealName != null && r.deal.name !== spec.dealName
      if (!r.alreadyMoved || needsName) {
        // `manuallyEditedFields` keeps a later Airtable re-import from putting
        // the source card back as the target (cf. convex/airtableImport.ts).
        const edited = new Set(r.deal.manuallyEditedFields ?? [])
        edited.add('targetCompanyId')
        if (spec.dealName != null) edited.add('name')
        await ctx.db.patch('deals', r.deal._id, {
          targetCompanyId: cofo._id,
          ...(spec.dealName != null ? { name: spec.dealName } : {}),
          manuallyEditedFields: [...edited],
        })
        moved.push(
          `${(r.deal.paidAmount ?? 0) / 100} € : ${spec.expectedFrom} → ${COFO_NAME}`,
        )
      }

      if (!spec.archiveFrom) continue
      if (r.from.archivedAt != null) continue // already archived
      const cardRefs = await refs(ctx, orgId, r.from._id)
      if (total(cardRefs) > 0) {
        skipped.push(
          `${spec.expectedFrom}: card still referenced (${Object.entries(
            nonZero(cardRefs),
          )
            .map(([k, n]) => `${n} ${k}`)
            .join(', ')})`,
        )
        continue
      }
      await ctx.db.patch('companies', r.from._id, { archivedAt: Date.now() })
      archived.push(spec.expectedFrom)
    }

    return { cofoCardCreated: created, moved, archived, skipped }
  },
})
