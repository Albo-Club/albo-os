/**
 * Cap tables of the group entities — the equity positions of CALTE, its seven
 * subsidiaries and Albo Club (ALB-128 follow-up).
 *
 * Since `createSubsidiaryOrgs` each subsidiary is an org of its own, but their
 * Passif is empty: nothing says who holds their capital. The ownership share
 * lives in exactly ONE place — the issuing company's own cap table
 * (`equityPositions.ownershipBps`, SPEC D33) — and CALTE's side READS it from
 * there (`liabilities:getOwnershipForCompany`, matched by SIREN). So filling
 * the subsidiary cap tables is also what makes the share show up on the CALTE
 * company sheet.
 *
 * Every row below is a FACT taken from a deed, with its source in the
 * `source` field. Two rows are declarative and marked as such — Banco 2's
 * split, which no document in the Drive states.
 *
 * Each entity's cap table is entered in FULL (every shareholder, group or
 * not): a table showing only CALTE's 50 % would leave the other half of the
 * capital nowhere, indistinguishable from a missing entry.
 *
 * Strictly ADDITIVE and idempotent: creates a position when the holder has
 * none, fills `ownershipBps` when an existing position carries none, and
 * touches nothing else. A position whose share or amount CONTRADICTS the
 * table is reported, never overwritten — a divergence is a decision, not a
 * merge.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/seedGroupCapTables:inspect
 *   # STOP: read the report — every row's `action`, and `ownershipSumBps` per org
 *   pnpm exec convex run --prod migrations/seedGroupCapTables:apply
 *   pnpm exec convex run --prod migrations/seedGroupCapTables:inspect  # all 'skip'
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Midnight UTC of a YYYY-MM-DD day — dates are ms epoch, always UTC. */
function day(iso: string) {
  return Date.parse(`${iso}T00:00:00.000Z`)
}

/**
 * One row = one shareholder's stake in one group entity. The holder is EITHER
 * a group org (`holderOrgSlug`) OR an outside party (`holderLabel`) — never
 * both, mirroring `liabilities:createEquityPosition`.
 *
 * `amountCents` is the holder's OWN subscribed amount, not the company's
 * capital (the pattern the Albo rows already follow: 2 425 000 € + 75 000 €).
 * `shares` is left out where no deed states it.
 */
type CapTableRow = {
  orgSlug: string
  holderOrgSlug?: string
  holderLabel?: string
  amountCents: number
  shares?: number
  ownershipBps: number
  effectiveDate: number
  source: string
}

const CAP_TABLES: ReadonlyArray<CapTableRow> = [
  // ── CALTE — SAS à associé unique, capital 1 450 710 € ────────────────────
  {
    orgSlug: 'calte',
    holderLabel: 'Clément Alteresco',
    amountCents: 145_071_000,
    shares: 145_071,
    ownershipBps: 10_000,
    effectiveDate: day('2014-06-01'),
    source:
      'Kbis CALTE 10/05/2026 (capital) ; nombre d’actions communiqué par Clément (nominale 10 €)',
  },

  // ── CALTIMO — SASU, capital 1 000 € en 10 000 actions de 0,10 € ──────────
  {
    orgSlug: 'caltimo',
    holderOrgSlug: 'calte',
    amountCents: 100_000,
    shares: 10_000,
    ownershipBps: 10_000,
    effectiveDate: day('2023-12-07'),
    source:
      'Statuts constitutifs 07/12/2023 art. 7-8 + Kbis 10/02/2026 ; confirmé par l’annexe « Filiales et participations » des comptes CALTE 2024 (100 %)',
  },

  // ── RDB — SASU, capital 1 000 € en 10 000 actions de 0,10 € ──────────────
  {
    orgSlug: 'rdb',
    holderOrgSlug: 'calte',
    amountCents: 100_000,
    shares: 10_000,
    ownershipBps: 10_000,
    effectiveDate: day('2026-01-16'),
    source: 'Statuts à jour 06/03/2026 art. 7-8 + Kbis 22/03/2026',
  },

  // ── Relais Chapelle — SASU, capital 1 000 € ──────────────────────────────
  {
    orgSlug: 'relais-chapelle',
    holderOrgSlug: 'calte',
    amountCents: 100_000,
    shares: 10_000,
    ownershipBps: 10_000,
    effectiveDate: day('2022-12-13'),
    source:
      'Kbis 19/01/2026 (associé unique) + annexe « Filiales et participations » des comptes CALTE 2024 (100 %) ; nombre d’actions communiqué par Benjamin',
  },

  // ── SCI Chapelle — capital 1 000 € en 10 000 parts de 0,10 € ─────────────
  {
    orgSlug: 'sci-chapelle',
    holderOrgSlug: 'calte',
    amountCents: 50_000,
    shares: 5_000,
    ownershipBps: 5_000,
    effectiveDate: day('2021-03-31'),
    source:
      'Statuts constitutifs art. 7 (CALTE 5 000 parts / 500 €) + annexe des comptes CALTE 2024 (50 %)',
  },
  {
    orgSlug: 'sci-chapelle',
    holderLabel: 'Felisa Carmen Mendoza Garcia',
    amountCents: 50_000,
    shares: 5_000,
    ownershipBps: 5_000,
    effectiveDate: day('2021-03-31'),
    source: 'Statuts constitutifs art. 7 (5 000 parts / 500 €)',
  },

  // ── SCI Chapelle 2 — capital 1 000 € en 10 000 parts de 0,10 € ───────────
  {
    orgSlug: 'sci-chapelle-2',
    holderOrgSlug: 'calte',
    amountCents: 99_000,
    shares: 9_900,
    ownershipBps: 9_900,
    effectiveDate: day('2023-08-23'),
    source:
      'Statuts constitutifs art. 7 (CALTE 9 900 parts / 990 €) + Kbis 29/08/2023 + annexe des comptes CALTE 2024 (99 %)',
  },
  {
    orgSlug: 'sci-chapelle-2',
    holderLabel: 'Felisa Carmen Mendoza Garcia',
    amountCents: 1_000,
    shares: 100,
    ownershipBps: 100,
    effectiveDate: day('2023-08-23'),
    source: 'Statuts constitutifs art. 7 (100 parts / 10 €)',
  },

  // ── SCI Upload — capital 1 000 € en 10 000 parts de 0,10 € ───────────────
  {
    orgSlug: 'sci-upload',
    holderOrgSlug: 'calte',
    amountCents: 50_000,
    shares: 5_000,
    ownershipBps: 5_000,
    effectiveDate: day('2025-06-06'),
    source:
      'Statuts signés art. 7 (CALTE 5 000 parts / 500 €) + Kbis 18/06/2025',
  },
  {
    orgSlug: 'sci-upload',
    holderLabel: 'MATRIX SARL',
    amountCents: 50_000,
    shares: 5_000,
    ownershipBps: 5_000,
    effectiveDate: day('2025-06-06'),
    source:
      'Statuts signés art. 7 (5 000 parts / 500 €) ; MATRIX SARL, RCS Paris 821 912 268',
  },

  // ── Banco 2 — SAS, capital 9 840 476,487 € en 65 643 actions ─────────────
  //
  // ⚠ Le 50/50 est DÉCLARATIF : aucun document du Drive ne donne la
  // répartition. Les statuts à jour du 28/05/2024 donnent le capital et le
  // nombre d'actions, pas les porteurs ; le traité d'apport du 24/07/2023
  // ne couvre que 26 183 actions émises à CALTE, soit une PARTIE de sa
  // position. À confirmer par le registre des mouvements de titres, puis
  // corriger ces deux lignes (et y ajouter `shares`).
  //
  // Le capital ne tombe pas au centime (984 047 648,7 cents pour une
  // nominale de 149,909 €) : chaque moitié est arrondie au centime
  // inférieur, d'où 0,7 centime non réparti. C'est `ownershipBps` qui porte
  // la vérité — c'est lui que lit la fiche société côté CALTE.
  {
    orgSlug: 'banco-2',
    holderOrgSlug: 'calte',
    amountCents: 492_023_824,
    ownershipBps: 5_000,
    effectiveDate: day('2023-06-28'),
    source:
      'Statuts à jour 28/05/2024 art. 7 (capital + 65 643 actions) ; répartition 50/50 déclarative, à confirmer par le registre des mouvements de titres',
  },
  {
    orgSlug: 'banco-2',
    holderLabel: 'Nexity + salariés Morning',
    amountCents: 492_023_824,
    ownershipBps: 5_000,
    effectiveDate: day('2023-06-28'),
    source:
      'Statuts à jour 28/05/2024 art. 7 ; dont 1 Action de Préférence A détenue par Nexity (51 % des droits de vote sur la gouvernance). Répartition déclarative',
  },

  // ── Albo Club — SAS, capital 2 500 000 € (positions DÉJÀ en base) ────────
  //
  // Les deux lignes existent depuis le seed initial ; seules leurs parts
  // pouvaient manquer. Présentes ici pour que `apply` complète
  // `ownershipBps` s'il est absent — et pour que `inspect` le dise s'il
  // diverge.
  {
    orgSlug: 'albo',
    holderOrgSlug: 'calte',
    amountCents: 242_500_000,
    ownershipBps: 9_700,
    effectiveDate: day('2024-10-31'),
    source: 'Position existante en base + Kbis Albo Club (capital 2 500 000 €)',
  },
  {
    orgSlug: 'albo',
    holderLabel: 'Benjamin Bouquet',
    amountCents: 7_500_000,
    ownershipBps: 300,
    effectiveDate: day('2024-10-31'),
    source: 'Position existante en base',
  },
]

/** What `apply` would do with one row. */
type Action =
  /** No position for this holder yet — insert it. */
  | 'create'
  /** Position exists without a share — fill `ownershipBps`, touch nothing else. */
  | 'fill_ownership'
  /** Position exists and already carries the expected share — leave it alone. */
  | 'skip'
  /** Position exists with a DIFFERENT share — report, never overwrite. */
  | 'conflict'

type PlannedRow = {
  row: CapTableRow
  orgId: Id<'organizations'>
  holderOrgId: Id<'organizations'> | null
  holder: string
  action: Action
  positionId: Id<'equityPositions'> | null
  existingOwnershipBps: number | null
  /** Existing amount differing from the table: reported, never rewritten. */
  existingAmountCents: number | null
}

/** The position of `holder` in `orgId`, or null. Bounded: a handful of rows. */
function findPosition(
  positions: Array<Doc<'equityPositions'>>,
  holderOrgId: Id<'organizations'> | null,
  holderLabel: string | undefined,
) {
  return (
    positions.find((position) =>
      holderOrgId
        ? position.holderOrgId === holderOrgId
        : position.holderOrgId == null && position.holderLabel === holderLabel,
    ) ?? null
  )
}

/**
 * Read-only plan, shared by `inspect` and `apply`. Throws when an org or a
 * holder org is missing, and when the table itself is inconsistent — a half
 * applied cap table is worse than none.
 */
async function buildPlan(ctx: Ctx) {
  // A row names exactly one holder, and no org's shares may exceed 100 %.
  const sumByOrg = new Map<string, number>()
  for (const row of CAP_TABLES) {
    if (!row.holderOrgSlug === !row.holderLabel) {
      throw new ConvexError(`ambiguous_holder:${row.orgSlug}`)
    }
    sumByOrg.set(
      row.orgSlug,
      (sumByOrg.get(row.orgSlug) ?? 0) + row.ownershipBps,
    )
  }
  for (const [orgSlug, sum] of sumByOrg) {
    if (sum > 10_000) throw new ConvexError(`ownership_over_100:${orgSlug}`)
  }

  const orgBySlug = new Map<string, Doc<'organizations'>>()
  const orgOf = async (slug: string) => {
    const cached = orgBySlug.get(slug)
    if (cached) return cached
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!org) throw new ConvexError(`org_not_found:${slug}`)
    orgBySlug.set(slug, org)
    return org
  }

  // Existing positions, read once per org (quasi-static table, a few rows).
  const positionsByOrg = new Map<string, Array<Doc<'equityPositions'>>>()
  const positionsOf = async (slug: string) => {
    const cached = positionsByOrg.get(slug)
    if (cached) return cached
    const org = await orgOf(slug)
    const positions = await ctx.db
      .query('equityPositions')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    positionsByOrg.set(slug, positions)
    return positions
  }

  const planned: Array<PlannedRow> = []
  for (const row of CAP_TABLES) {
    const holderOrg = row.holderOrgSlug ? await orgOf(row.holderOrgSlug) : null
    const existing = findPosition(
      (await positionsOf(row.orgSlug)).filter(
        (position) => position.type === 'capital_social',
      ),
      holderOrg?._id ?? null,
      row.holderLabel,
    )

    const action: Action =
      existing === null
        ? 'create'
        : existing.ownershipBps == null
          ? 'fill_ownership'
          : existing.ownershipBps === row.ownershipBps
            ? 'skip'
            : 'conflict'

    planned.push({
      row,
      orgId: (await orgOf(row.orgSlug))._id,
      holderOrgId: holderOrg?._id ?? null,
      holder: holderOrg?.name ?? row.holderLabel ?? '',
      action,
      positionId: existing?._id ?? null,
      existingOwnershipBps: existing?.ownershipBps ?? null,
      existingAmountCents:
        existing && existing.amountCents !== row.amountCents
          ? existing.amountCents
          : null,
    })
  }

  return { planned, sumByOrg }
}

/**
 * Read-only report: what `apply` would write, per org. Run it first, and
 * again after `apply` — every row should then read 'skip'.
 *
 * `incorporationDate` of the org's `group_root` is echoed beside the row's
 * `effectiveDate` so the two can be compared by eye: the table dates each
 * position at the entity's constitution, and the company sheet holds that
 * same date on its own.
 */
export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { planned, sumByOrg } = await buildPlan(ctx)

    const orgs = await Promise.all(
      [...sumByOrg.keys()].map(async (slug) => {
        const org = await ctx.db
          .query('organizations')
          .withIndex('by_slug', (q) => q.eq('slug', slug))
          .unique()
        const root = org
          ? await ctx.db
              .query('companies')
              .withIndex('by_org_kind', (q) =>
                q.eq('orgId', org._id).eq('kind', 'group_root'),
              )
              .first()
          : null
        const rows = planned.filter((p) => p.row.orgSlug === slug)
        return {
          orgSlug: slug,
          // 10000 = the cap table adds up to 100 %. Below that, a holder is
          // missing from the table — deliberate or not, it shows here.
          ownershipSumBps: sumByOrg.get(slug) ?? 0,
          amountSumCents: rows.reduce((sum, r) => sum + r.row.amountCents, 0),
          rootIncorporationDate: root?.incorporationDate ?? null,
          rows: rows.map((r) => ({
            holder: r.holder,
            action: r.action,
            ownershipBps: r.row.ownershipBps,
            existingOwnershipBps: r.existingOwnershipBps,
            amountCents: r.row.amountCents,
            existingAmountCents: r.existingAmountCents,
            effectiveDate: r.row.effectiveDate,
            source: r.row.source,
          })),
        }
      }),
    )

    return {
      totals: {
        create: planned.filter((p) => p.action === 'create').length,
        fillOwnership: planned.filter((p) => p.action === 'fill_ownership')
          .length,
        skip: planned.filter((p) => p.action === 'skip').length,
        // Any conflict is a STOP: read it before applying anything.
        conflict: planned.filter((p) => p.action === 'conflict').length,
        amountMismatch: planned.filter((p) => p.existingAmountCents !== null)
          .length,
      },
      orgs,
    }
  },
})

/**
 * Writes the cap tables. Creates the missing positions, fills an absent
 * `ownershipBps` on an existing one, and leaves everything else untouched —
 * a conflicting share or amount is skipped and returned, not overwritten.
 */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { planned } = await buildPlan(ctx)

    const created: Array<string> = []
    const filled: Array<string> = []
    const conflicts: Array<string> = []

    for (const plan of planned) {
      const label = `${plan.row.orgSlug}/${plan.holder}`
      if (plan.action === 'conflict') {
        conflicts.push(
          `${label}: ${plan.existingOwnershipBps} bps en base vs ${plan.row.ownershipBps} attendus`,
        )
        continue
      }
      if (plan.action === 'skip') continue

      if (plan.action === 'fill_ownership' && plan.positionId) {
        await ctx.db.patch('equityPositions', plan.positionId, {
          ownershipBps: plan.row.ownershipBps,
        })
        filled.push(label)
        continue
      }

      await ctx.db.insert('equityPositions', {
        orgId: plan.orgId,
        holderOrgId: plan.holderOrgId ?? undefined,
        holderLabel: plan.row.holderLabel,
        type: 'capital_social',
        amountCents: plan.row.amountCents,
        shares: plan.row.shares,
        ownershipBps: plan.row.ownershipBps,
        effectiveDate: plan.row.effectiveDate,
      })
      created.push(label)
    }

    return { created, filled, conflicts }
  },
})
