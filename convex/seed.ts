/**
 * Seed du groupe Calte — modèle MULTI-ORG.
 *
 * Albo et Calte sont deux organisations Better Auth distinctes. Chaque org
 * porte ses propres entités juridiques (`companies`). Une nouvelle entité
 * d'invest = une nouvelle org (apparaît d'office dans la vue agrégée).
 *
 * Idempotent : upsert org par slug, companies par name, relations par couple
 * parent/child. Personnes physiques et sociétés externes vivent dans `notes`.
 *
 * Lancer (prod, dev supprimé) :
 *   npx convex export --prod                          # snapshot de secours
 *   npx convex run --prod seed:cleanupLegacy          # purge l'ancienne org combinée
 *   npx convex run --prod seed:seedAll '{"ownerEmail":"benjamin@alboteam.com"}'
 */

import { ConvexError, v } from 'convex/values'

import { internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const LEGACY_SLUG = 'calte-family-office'

// UTC ms epoch — dates de constitution (source : Notion « Architecture BDD »).
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day)

type GroupKind = 'group_root' | 'group_operating' | 'group_sci' | 'group_manco'

type SeedCompany = {
  name: string
  legalName: string
  kind: GroupKind
  siren: string
  legalForm: string
  incorporationDate: number
  notes?: string
}

// ─── Org Calte ──────────────────────────────────────────────────────────────

const CALTE_COMPANIES: Array<SeedCompany> = [
  {
    name: 'CALTE',
    legalName: 'CALTE',
    kind: 'group_root',
    siren: '802824052',
    legalForm: 'SAS',
    incorporationDate: d(2014, 6, 1),
    notes: 'Holding principale, 100% Clément Alteresco (PP, hors système).',
  },
  {
    name: 'Caltimo',
    legalName: 'CALTIMO SASU',
    kind: 'group_operating',
    siren: '982380032',
    legalForm: 'SASU',
    incorporationDate: d(2023, 12, 7),
  },
  {
    name: 'RDB',
    legalName: 'RDB SASU',
    kind: 'group_operating',
    siren: '100056290',
    legalForm: 'SASU',
    incorporationDate: d(2026, 1, 16),
  },
  {
    name: 'Relais Chapelle',
    legalName: 'Relais Chapelle SASU',
    kind: 'group_operating',
    siren: '922536636',
    legalForm: 'SASU',
    incorporationDate: d(2022, 12, 13),
    notes:
      'Associé unique CALTE. Présidence Felisa Mendoza Garcia ' +
      '(dirigeante non-associée).',
  },
  {
    name: 'SCI Chapelle',
    legalName: 'SCI Chapelle',
    kind: 'group_sci',
    siren: '897979605',
    legalForm: 'SCI',
    incorporationDate: d(2021, 3, 31),
    notes:
      '50% CALTE / 50% Felisa Mendoza Garcia (PP, hors système). ' +
      'Murs domaine Chapelle.',
  },
  {
    name: 'SCI Chapelle 2',
    legalName: 'SCI Chapelle 2',
    kind: 'group_sci',
    siren: '978810299',
    legalForm: 'SCI',
    incorporationDate: d(2023, 8, 23),
    notes:
      '99% CALTE / 1% Felisa Mendoza Garcia (PP, hors système). ' +
      'Murs maison adjacente.',
  },
  {
    name: 'SCI Upload',
    legalName: 'SCI Upload',
    kind: 'group_sci',
    siren: '987965852',
    legalForm: 'SCI',
    incorporationDate: d(2025, 6, 6),
    notes:
      '50% CALTE / 50% MATRIX SARL (RCS Paris 821 912 268, hors système). ' +
      'Local loué à Via Sana.',
  },
  {
    name: 'Banco 2',
    legalName: 'Banco 2 SAS',
    kind: 'group_manco',
    siren: '953956737',
    legalForm: 'SAS',
    incorporationDate: d(2023, 6, 28),
    notes:
      'ManCo Morning/Ubiq. 50% CALTE / 50% Nexity + salariés Morning ' +
      '(hors système). Action de Préférence A détenue par Nexity = 51% ' +
      'droits de vote gouvernance. Détient 8% de Morning via BAP.',
  },
]

// Détention intra-org Calte : parent toujours CALTE.
const CALTE_RELATIONS: Array<{ child: string; ownershipPct: number }> = [
  { child: 'Caltimo', ownershipPct: 100 },
  { child: 'RDB', ownershipPct: 100 },
  { child: 'Relais Chapelle', ownershipPct: 100 },
  { child: 'SCI Chapelle', ownershipPct: 50 },
  { child: 'SCI Chapelle 2', ownershipPct: 99 },
  { child: 'SCI Upload', ownershipPct: 50 },
  { child: 'Banco 2', ownershipPct: 50 },
]

// ─── Org Albo ────────────────────────────────────────────────────────────────

const ALBO_COMPANIES: Array<SeedCompany> = [
  {
    name: 'Albo Club',
    legalName: 'Albo Club SAS',
    kind: 'group_root',
    siren: '934657909',
    legalForm: 'SAS',
    incorporationDate: d(2024, 10, 18),
    notes:
      'Holding d\'investissement impact. Filiale CALTE 97% + Benjamin ' +
      'Bouquet 3% (hors système ; détention inter-org non modélisée).',
  },
]

const ALBO_RELATIONS: Array<{ child: string; ownershipPct: number }> = []

// ─── Helpers ──────────────────────────────────────────────────────────────

async function upsertGroup(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  companies: Array<SeedCompany>,
  relations: Array<{ child: string; ownershipPct: number }>,
  rootName: string,
) {
  const byName = new Map<string, Id<'companies'>>()
  for (const c of companies) {
    const existing = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .filter((q) => q.eq(q.field('name'), c.name))
      .first()
    const fields = {
      orgId,
      name: c.name,
      legalName: c.legalName,
      kind: c.kind,
      siren: c.siren,
      countryCode: 'FR',
      legalForm: c.legalForm,
      incorporationDate: c.incorporationDate,
      notes: c.notes,
      archivedAt: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      byName.set(c.name, existing._id)
    } else {
      byName.set(c.name, await ctx.db.insert('companies', fields))
    }
  }

  if (relations.length > 0) {
    const rootId = byName.get(rootName)!
    for (const r of relations) {
      const childId = byName.get(r.child)!
      const existing = await ctx.db
        .query('companyRelations')
        .withIndex('by_parent', (q) =>
          q.eq('orgId', orgId).eq('parentCompanyId', rootId),
        )
        .filter((q) => q.eq(q.field('childCompanyId'), childId))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, { ownershipPct: r.ownershipPct })
      } else {
        await ctx.db.insert('companyRelations', {
          orgId,
          parentCompanyId: rootId,
          childCompanyId: childId,
          ownershipPct: r.ownershipPct,
        })
      }
    }
  }

  return { companies: companies.length, relations: relations.length }
}

/** Upsert une org par slug (réutilise l'existante, maj le nom) + owner membre. */
async function ensureOrg(
  ctx: MutationCtx,
  slug: string,
  name: string,
  ownerId: Id<'users'>,
): Promise<Id<'organizations'>> {
  let org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first()
  if (org) {
    if (org.name !== name) await ctx.db.patch(org._id, { name })
  } else {
    const id = await ctx.db.insert('organizations', {
      slug,
      name,
      createdBy: ownerId,
      createdAt: Date.now(),
    })
    org = await ctx.db.get(id)
  }
  const orgId = org!._id
  const member = await ctx.db
    .query('organizationMembers')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', ownerId),
    )
    .unique()
  if (!member) {
    await ctx.db.insert('organizationMembers', {
      orgId,
      userId: ownerId,
      role: 'owner',
      joinedAt: Date.now(),
    })
  }
  return orgId
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Crée/maj les orgs Calte + Albo, rattache l'owner (super-admin) aux deux,
 * et seed leurs entités. Idempotent.
 */
export const seedAll = internalMutation({
  args: { ownerEmail: v.optional(v.string()) },
  handler: async (ctx, { ownerEmail }) => {
    const owner = ownerEmail
      ? await ctx.db
          .query('users')
          .withIndex('by_email', (q) => q.eq('email', ownerEmail))
          .first()
      : await ctx.db
          .query('users')
          .filter((q) => q.eq(q.field('superAdmin'), true))
          .first()
    if (!owner) throw new ConvexError('owner_user_not_found')

    const calteId = await ensureOrg(ctx, 'calte', 'Calte', owner._id)
    const alboId = await ensureOrg(ctx, 'albo', 'Albo', owner._id)

    const calte = await upsertGroup(
      ctx,
      calteId,
      CALTE_COMPANIES,
      CALTE_RELATIONS,
      'CALTE',
    )
    const albo = await upsertGroup(
      ctx,
      alboId,
      ALBO_COMPANIES,
      ALBO_RELATIONS,
      'Albo Club',
    )

    return {
      owner: owner.email,
      calte: { orgId: calteId, ...calte },
      albo: { orgId: alboId, ...albo },
    }
  },
})

/** Supprime l'ancienne org combinée "Calte Family Office" et toutes ses lignes. */
export const cleanupLegacy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', LEGACY_SLUG))
      .first()
    if (!org) return { deleted: false, reason: 'legacy_org_absent' }
    const orgId = org._id

    let n = 0
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of deals) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const valuations = await ctx.db
      .query('valuations')
      .withIndex('by_org_asof', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of valuations) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const kpis = await ctx.db
      .query('kpiSnapshots')
      .withIndex('by_org_period', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of kpis) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const relations = await ctx.db
      .query('companyRelations')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of relations) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of companies) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const invitations = await ctx.db
      .query('invitations')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of invitations) {
      await ctx.db.delete(r._id)
      n += 1
    }
    const members = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const r of members) {
      await ctx.db.delete(r._id)
      n += 1
    }
    await ctx.db.delete(orgId)

    return { deleted: true, orgId, rowsDeleted: n }
  },
})
