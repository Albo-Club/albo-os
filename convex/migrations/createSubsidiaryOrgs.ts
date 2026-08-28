/**
 * One org per legal entity — creation of the seven CALTE subsidiary orgs
 * (ALB-128).
 *
 * Until now a subsidiary existed only as a `group_*` company INSIDE the
 * `calte` org: no bank accounts of its own, no balance sheet, no VAT of its
 * own (`getVatPosition` sums the whole org, i.e. the eight companies at
 * once). The model of an org — investments + cash + equity — is the model of
 * a legal entity, and the liability tables already assume it
 * (`intercompanyLoans` links two ORGS and rejects `same_org`, which is why the
 * CALTE → subsidiaries current accounts cannot be booked at all today).
 *
 * This migration gives each subsidiary its own org, on the pattern Albo Club
 * already follows: an org, its `group_root` company inside it, and a line in
 * CALTE. Strictly ADDITIVE — it creates orgs, memberships and root companies,
 * and never touches an existing row. In particular the source company stays a
 * `group_*` entity of `calte` with its deals and its bank accounts untouched;
 * reclassifying it as a `portfolio` line is a separate decision, which
 * `inspect` documents (a source company that still carries deals as investor
 * or owns bank accounts cannot be reclassified without moving those first).
 *
 * The root company is a CLONE of the source's legal identity (legalName,
 * siren, legalForm, incorporationDate, notes). SIREN uniqueness is enforced
 * per org (`by_org_siren`), so the same SIREN legitimately appears in the
 * source line and in the new org's root. The Attio / Airtable anchors
 * (`attioCompanyId`, `airtableId`) are deliberately NOT cloned: they identify
 * one row, and duplicating them would break the lookups keyed on them.
 *
 * Idempotent: an org, a membership or a root company that already exists is
 * reused, never duplicated.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/createSubsidiaryOrgs:inspect
 *   # STOP: read the report — `dealsAsInvestor` / `bankAccountsOwned` per row, then
 *   pnpm exec convex run --prod migrations/createSubsidiaryOrgs:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>
type MutCtx = GenericMutationCtx<DataModel>

/** The org the subsidiaries are carved out of. */
const SOURCE_ORG_SLUG = 'calte'

/**
 * One row per subsidiary: the org slug to create, and the name of the
 * `group_*` company it is carved out of inside `calte`. Slugs follow
 * `organizations.ts` SLUG_RE (`^[a-z0-9-]{3,40}$`).
 */
const SUBSIDIARIES: ReadonlyArray<{ slug: string; sourceName: string }> = [
  { slug: 'caltimo', sourceName: 'Caltimo' },
  { slug: 'rdb', sourceName: 'RDB' },
  { slug: 'relais-chapelle', sourceName: 'Relais Chapelle' },
  { slug: 'sci-chapelle', sourceName: 'SCI Chapelle' },
  { slug: 'sci-chapelle-2', sourceName: 'SCI Chapelle 2' },
  { slug: 'sci-upload', sourceName: 'SCI Upload' },
  { slug: 'banco-2', sourceName: 'Banco 2' },
]

type Plan = {
  slug: string
  sourceName: string
  sourceCompanyId: Id<'companies'>
  sourceKind: Doc<'companies'>['kind']
  orgId: Id<'organizations'> | null // null = to be created
  rootCompanyId: Id<'companies'> | null // null = to be created
  missingMemberIds: Array<Id<'users'>>
  /**
   * What still ties the source line to `calte` as a group entity. Both must
   * be 0 before the line can ever be reclassified as a `portfolio`
   * participation — a deal's investor and a bank account's owner must be a
   * `group_*` entity of their org.
   */
  dealsAsInvestor: number
  bankAccountsOwned: number
}

/** Members of the source org, mirrored into every subsidiary org. */
async function sourceMembers(ctx: Ctx, orgId: Id<'organizations'>) {
  return await ctx.db
    .query('organizationMembers')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
}

/**
 * Read-only plan, shared by `inspect` and `apply`. Throws when the source org
 * or one of the seven source companies is missing — a partial run would leave
 * a half-built group.
 */
async function buildPlan(ctx: Ctx) {
  const sourceOrg = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', SOURCE_ORG_SLUG))
    .unique()
  if (!sourceOrg)
    throw new ConvexError(`source_org_not_found:${SOURCE_ORG_SLUG}`)

  const members = await sourceMembers(ctx, sourceOrg._id)
  if (members.length === 0) throw new ConvexError('source_org_has_no_member')
  const owner = members.find((m) => m.role === 'owner') ?? members[0]

  // Deals of the source org, read once: the investor side has no dedicated
  // index, and this is a one-shot script.
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_org', (q) => q.eq('orgId', sourceOrg._id))
    .collect()

  const plans: Array<Plan> = []
  for (const sub of SUBSIDIARIES) {
    const source = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', sourceOrg._id))
      .filter((q) => q.eq(q.field('name'), sub.sourceName))
      .first()
    if (!source) {
      throw new ConvexError(`source_company_not_found:${sub.sourceName}`)
    }

    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', sub.slug))
      .unique()

    const root = org
      ? await ctx.db
          .query('companies')
          .withIndex('by_org_kind', (q) =>
            q.eq('orgId', org._id).eq('kind', 'group_root'),
          )
          .first()
      : null

    const existingMemberIds = new Set<Id<'users'>>(
      org ? (await sourceMembers(ctx, org._id)).map((m) => m.userId) : [],
    )

    const bankAccounts = await ctx.db
      .query('bankAccounts')
      .withIndex('by_owner', (q) =>
        q.eq('orgId', sourceOrg._id).eq('ownerCompanyId', source._id),
      )
      .collect()

    plans.push({
      slug: sub.slug,
      sourceName: sub.sourceName,
      sourceCompanyId: source._id,
      sourceKind: source.kind,
      orgId: org?._id ?? null,
      rootCompanyId: root?._id ?? null,
      missingMemberIds: members
        .map((m) => m.userId)
        .filter((id) => !existingMemberIds.has(id)),
      dealsAsInvestor: deals.filter((d) => d.investorCompanyId === source._id)
        .length,
      bankAccountsOwned: bankAccounts.length,
    })
  }

  return { sourceOrg, members, owner, plans }
}

/**
 * Read-only report: what `apply` would create, and what still ties each
 * source line to `calte`. Run this first, in prod.
 */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { sourceOrg, members, plans } = await buildPlan(ctx)
    return {
      sourceOrg: { slug: sourceOrg.slug, name: sourceOrg.name },
      memberCount: members.length,
      subsidiaries: plans.map((p) => ({
        slug: p.slug,
        name: p.sourceName,
        kindInCalte: p.sourceKind,
        orgToCreate: p.orgId === null,
        rootCompanyToCreate: p.rootCompanyId === null,
        membershipsToAdd: p.missingMemberIds.length,
        // Both at 0 = the CALTE line holds nothing and could later become a
        // plain participation line. Non-zero = those rows would have to move
        // to the new org first, which is NOT what this migration does.
        dealsAsInvestor: p.dealsAsInvestor,
        bankAccountsOwned: p.bankAccountsOwned,
      })),
    }
  },
})

/** Create (or complete) the seven orgs. Additive and idempotent. */
export const apply = internalMutation({
  args: {},
  handler: async (ctx: MutCtx) => {
    const { owner, members, plans } = await buildPlan(ctx)
    // Each member keeps, in the subsidiary, the role they hold in `calte`.
    const roleByUser = new Map(members.map((m) => [m.userId, m.role]))

    const created: Array<{
      slug: string
      org: boolean
      rootCompany: boolean
      memberships: number
    }> = []

    for (const plan of plans) {
      const source = await ctx.db.get('companies', plan.sourceCompanyId)
      if (!source) throw new ConvexError(`source_company_gone:${plan.slug}`)

      let orgId = plan.orgId
      const orgCreated = orgId === null
      if (orgId === null) {
        orgId = await ctx.db.insert('organizations', {
          slug: plan.slug,
          name: source.name,
          createdBy: owner.userId,
          createdAt: Date.now(),
        })
      }

      for (const userId of plan.missingMemberIds) {
        await ctx.db.insert('organizationMembers', {
          orgId,
          userId,
          role: roleByUser.get(userId) ?? 'member',
          joinedAt: Date.now(),
        })
      }

      const rootCreated = plan.rootCompanyId === null
      if (rootCreated) {
        await ctx.db.insert('companies', {
          orgId,
          name: source.name,
          legalName: source.legalName,
          kind: 'group_root',
          siren: source.siren,
          registrationNumber: source.registrationNumber,
          countryCode: source.countryCode,
          legalForm: source.legalForm,
          incorporationDate: source.incorporationDate,
          notes: source.notes,
        })
      }

      created.push({
        slug: plan.slug,
        org: orgCreated,
        rootCompany: rootCreated,
        memberships: plan.missingMemberIds.length,
      })
    }

    return { created }
  },
})
