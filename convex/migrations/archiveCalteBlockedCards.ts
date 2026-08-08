/**
 * Finishes `cleanupCalteOrphanCompanies` on the three cards its guard refused.
 *
 * Context. `cleanupCalteOrphanCompanies:apply` archived 38 of the 41 cards and
 * refused 3, because each still carried a reference and the guard would rather
 * report than orphan a row. What each was holding:
 *
 *   - `SERENDIP INVEST` and `Calte SASU` — one `companyEmailLinks` row each.
 *     That table is LEGACY, «declared but inert», read by nothing (cf.
 *     convex/schema.ts): a leftover of the retired e-mail feature, and the only
 *     reference the app offers no way to clear. Dropping the row loses nothing.
 *   - `Upcyclea` — a 2025 annual report, its PDF, its `companyIntelligence`
 *     slot and the 17 KPI snapshots that report sourced. NOT a dealflow card as
 *     first read: Upcyclea is an `albo` holding, whose card there already
 *     carries THE SAME report (same e-mail, same PDF, same 17 snapshots) plus
 *     the Q3 and Q4 2025 ones. The CALTE side is a fan-out duplicate, nothing
 *     unique.
 *
 * The report is NOT detached here: `reportInbox.detachCompany` already does it,
 * tested, and does more than a migration reasonably should re-implement (it
 * also corrects the source `inboundEmails` row so a replay does not put the
 * report back, and drops the semantic-index entry). Re-implementing that
 * cascade to save one click would be the worse trade. Hence the two steps
 * below, in that order.
 *
 * What this migration does — and only that:
 *   1. Deletes the legacy `companyEmailLinks` rows of the three cards.
 *   2. Deletes the leftover `companyIntelligence` row (derived data, rebuilt on
 *      demand — same call as `cleanupCalteImport`, which drops it rather than
 *      leave it on an archived card; `detachCompany` only clears its pointer).
 *   3. Archives a card once, and only once, NOTHING points at it any more.
 *
 * Idempotent & guarded, like its siblings: cards are anchored by their prod
 * `_id` and cross-checked on their exact current name, an already-archived card
 * is a no-op, and a card that still carries anything else is reported instead
 * of archived. Nothing is hard-deleted except the two row kinds named above.
 *
 * Execution order (prod, manual):
 *   # 1. In the app, org calte, Upcyclea card → Documents & rapports →
 *   #    detach the «2025 SUMMARY» report. The albo card keeps its copy.
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/archiveCalteBlockedCards:dryRun
 *   # STOP: `ready: true` on the three cards, then and only then:
 *   pnpm exec convex run --prod migrations/archiveCalteBlockedCards:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/**
 * The three cards `cleanupCalteOrphanCompanies` reported as blocked, with what
 * blocked each — kept in the code so the next reader does not re-derive it.
 */
const CARDS: Array<{ id: string; expectedName: string; blockedBy: string }> = [
  {
    id: 'jx76pjqehg2t0acyj10mds5z5d87rc9e',
    expectedName: 'SERENDIP INVEST',
    blockedBy: '1 legacy e-mail link',
  },
  {
    id: 'jx7e0eyv2gmzmh1mcsrcez09pd87rarm',
    expectedName: 'Calte SASU',
    blockedBy: '1 legacy e-mail link',
  },
  {
    id: 'jx76b6ed08sra315psj5dcmdq587skx8',
    expectedName: 'Upcyclea',
    blockedBy:
      '1 report + 1 document + 17 KPI snapshots + 1 intelligence row, all duplicates of the albo card',
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

/**
 * Everything that can still name a card, split in two: what this migration is
 * allowed to clear (`clearable`) and what it is not (`blocking`). A card is
 * archived only when `blocking` is empty — the report and its KPI snapshots
 * land there on purpose, so a forgotten detach stops the run instead of
 * silently archiving a card that still carries live data.
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
    clearable: { emailLinks: links, intelligence: intel },
    blocking: {
      deals:
        asTarget.length +
        asInvestor.length +
        allDeals.filter((d) => d.viaSpvCompanyId === id).length,
      relations: relParent.length + relChild.length,
      documents: docs.length,
      reports: reports.length,
      kpiSnapshots: kpis.length,
      bankAccounts: banks.length,
      todos: todos.filter((t) => t.companyId === id).length,
      transfers: transfers.filter((t) => t.ownerCompanyId === id).length,
      inbox: inbox.filter((e) =>
        (e.matchedCompanies ?? []).some((m) => m.companyId === id),
      ).length,
    },
  }
}

const totalBlocking = (b: Record<string, number>) =>
  Object.values(b).reduce((s, n) => s + n, 0)

const stillBlocking = (b: Record<string, number>) =>
  Object.fromEntries(Object.entries(b).filter(([, n]) => n > 0))

// ─── dryRun ──────────────────────────────────────────────────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id

    const cards = await Promise.all(
      CARDS.map(async (spec) => {
        const company = await ctx.db.get('companies', spec.id as Id<'companies'>)
        if (!company) return { name: spec.expectedName, skip: 'not_found' }
        if (company.orgId !== orgId)
          return { name: spec.expectedName, skip: 'wrong_org' }
        if (company.archivedAt != null)
          return { name: spec.expectedName, skip: 'already_archived' }
        if (company.name !== spec.expectedName) {
          return {
            name: spec.expectedName,
            skip: `name_mismatch (${company.name})`,
          }
        }
        const r = await refs(ctx, orgId, company._id)
        const blocked = totalBlocking(r.blocking) > 0
        return {
          name: spec.expectedName,
          wasBlockedBy: spec.blockedBy,
          willDelete: {
            emailLinks: r.clearable.emailLinks.length,
            intelligence: r.clearable.intelligence.length,
          },
          ready: !blocked,
          ...(blocked ? { stillBlockedBy: stillBlocking(r.blocking) } : {}),
        }
      }),
    )

    return {
      org: { slug: org.slug, id: orgId },
      cards,
      totals: {
        ready: cards.filter((c) => 'ready' in c && c.ready).length,
        blocked: cards.filter((c) => 'ready' in c && !c.ready).length,
        alreadyDone: cards.filter(
          (c) => 'skip' in c && c.skip === 'already_archived',
        ).length,
      },
      // The one manual step this migration deliberately does not do.
      reminder:
        'Detach the Upcyclea «2025 SUMMARY» report from the CALTE card in the app first — the albo card keeps its own copy.',
    }
  },
})

// ─── apply ───────────────────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const archived: Array<string> = []
    const skipped: Array<string> = []
    let emailLinksDeleted = 0
    let intelligenceDeleted = 0

    for (const spec of CARDS) {
      const company = await ctx.db.get('companies', spec.id as Id<'companies'>)
      if (!company) {
        skipped.push(`${spec.expectedName}: anchor not found`)
        continue
      }
      if (company.archivedAt != null) continue // already archived
      if (company.orgId !== orgId) {
        skipped.push(`${spec.expectedName}: wrong org`)
        continue
      }
      if (company.name !== spec.expectedName) {
        skipped.push(`${spec.expectedName}: name mismatch (${company.name})`)
        continue
      }

      const r = await refs(ctx, orgId, company._id)
      // Nothing is cleared on a card that would stay blocked anyway: a
      // forgotten detach must leave the card exactly as it was found.
      if (totalBlocking(r.blocking) > 0) {
        skipped.push(
          `${spec.expectedName}: still referenced (${Object.entries(
            stillBlocking(r.blocking),
          )
            .map(([k, n]) => `${n} ${k}`)
            .join(', ')})`,
        )
        continue
      }

      for (const link of r.clearable.emailLinks) {
        await ctx.db.delete('companyEmailLinks', link._id)
        emailLinksDeleted += 1
      }
      for (const row of r.clearable.intelligence) {
        await ctx.db.delete('companyIntelligence', row._id)
        intelligenceDeleted += 1
      }
      await ctx.db.patch('companies', company._id, { archivedAt: Date.now() })
      archived.push(spec.expectedName)
    }

    return { archived, emailLinksDeleted, intelligenceDeleted, skipped }
  },
})
