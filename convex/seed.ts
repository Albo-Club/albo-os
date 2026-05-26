/**
 * Seed du groupe Calte — données du family office (9 entités + 8 relations
 * capitalistiques). Idempotent : relançable sans créer de doublons (upsert
 * par `name` dans l'org).
 *
 * Personnes physiques (Clément, Felisa, Benjamin) et sociétés externes
 * (MATRIX, Nexity) ne sont PAS modélisées comme `companies` — elles vivent
 * dans les `notes`.
 *
 * Lancer (dev) :
 *   pnpm exec convex run seed:seedCalteFamilyOffice   # org + 9 entités
 *   pnpm exec convex run seed:seedExampleDeals         # deals d'exemple
 * Ou cibler une org existante :
 *   pnpm exec convex run seed:seedGroup '{"orgId":"<id>"}'
 */

import { ConvexError, v } from 'convex/values'

import { internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const ORG_NAME = 'Calte Family Office'
const ORG_SLUG = 'calte-family-office'

// UTC ms epoch — dates de constitution (source : Notion « Architecture BDD »).
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day)

type GroupKind =
  | 'group_root'
  | 'group_operating'
  | 'group_sci'
  | 'group_manco'

type SeedCompany = {
  name: string
  legalName: string
  kind: GroupKind
  holdingScope: 'albo' | 'calte'
  siren: string
  legalForm: string
  incorporationDate: number
  notes?: string
}

const COMPANIES: Array<SeedCompany> = [
  {
    name: 'CALTE',
    legalName: 'CALTE',
    kind: 'group_root',
    holdingScope: 'calte',
    siren: '802824052',
    legalForm: 'SAS',
    incorporationDate: d(2014, 6, 1),
    notes: 'Holding principale, 100% Clément Alteresco (PP, hors système).',
  },
  {
    name: 'Albo Club',
    legalName: 'Albo Club SAS',
    kind: 'group_root',
    holdingScope: 'albo',
    siren: '934657909',
    legalForm: 'SAS',
    incorporationDate: d(2024, 10, 18),
    notes:
      'Filiale CALTE 97% + Benjamin Bouquet (PP, hors système) 3%. Vue ' +
      'séparée car portefeuille impact piloté par Benjamin.',
  },
  {
    name: 'Caltimo',
    legalName: 'CALTIMO SASU',
    kind: 'group_operating',
    holdingScope: 'calte',
    siren: '982380032',
    legalForm: 'SASU',
    incorporationDate: d(2023, 12, 7),
  },
  {
    name: 'RDB',
    legalName: 'RDB SASU',
    kind: 'group_operating',
    holdingScope: 'calte',
    siren: '100056290',
    legalForm: 'SASU',
    incorporationDate: d(2026, 1, 16),
  },
  {
    name: 'Relais Chapelle',
    legalName: 'Relais Chapelle SASU',
    kind: 'group_operating',
    holdingScope: 'calte',
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
    holdingScope: 'calte',
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
    holdingScope: 'calte',
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
    holdingScope: 'calte',
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
    holdingScope: 'calte',
    siren: '953956737',
    legalForm: 'SAS',
    incorporationDate: d(2023, 6, 28),
    notes:
      'ManCo Morning/Ubiq. 50% CALTE / 50% Nexity + salariés Morning ' +
      '(hors système). Action de Préférence A détenue par Nexity = 51% ' +
      'droits de vote gouvernance. Détient 8% de Morning via BAP.',
  },
]

// Détention : parent toujours CALTE.
const RELATIONS: Array<{ child: string; ownershipPct: number }> = [
  { child: 'Albo Club', ownershipPct: 97 },
  { child: 'Caltimo', ownershipPct: 100 },
  { child: 'RDB', ownershipPct: 100 },
  { child: 'Relais Chapelle', ownershipPct: 100 },
  { child: 'SCI Chapelle', ownershipPct: 50 },
  { child: 'SCI Chapelle 2', ownershipPct: 99 },
  { child: 'SCI Upload', ownershipPct: 50 },
  { child: 'Banco 2', ownershipPct: 50 },
]

async function upsertGroup(ctx: MutationCtx, orgId: Id<'organizations'>) {
  const byName = new Map<string, Id<'companies'>>()

  for (const c of COMPANIES) {
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
      holdingScope: c.holdingScope,
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

  const calteId = byName.get('CALTE')!
  for (const r of RELATIONS) {
    const childId = byName.get(r.child)!
    const existing = await ctx.db
      .query('companyRelations')
      .withIndex('by_parent', (q) =>
        q.eq('orgId', orgId).eq('parentCompanyId', calteId),
      )
      .filter((q) => q.eq(q.field('childCompanyId'), childId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { ownershipPct: r.ownershipPct })
    } else {
      await ctx.db.insert('companyRelations', {
        orgId,
        parentCompanyId: calteId,
        childCompanyId: childId,
        ownershipPct: r.ownershipPct,
      })
    }
  }

  return { companies: COMPANIES.length, relations: RELATIONS.length }
}

/** Seed les 9 entités + 8 relations dans une org existante. */
export const seedGroup = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId)
    if (!org) throw new ConvexError('org_not_found')
    return upsertGroup(ctx, orgId)
  },
})

/**
 * Bootstrap dev : crée (si absente) l'org "Calte Family Office", y rattache
 * le compte super-admin comme owner, puis seed le groupe. Renvoie l'orgId.
 */
export const seedCalteFamilyOffice = internalMutation({
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

    let org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
      .first()

    if (!org) {
      const orgId = await ctx.db.insert('organizations', {
        slug: ORG_SLUG,
        name: ORG_NAME,
        createdBy: owner._id,
        createdAt: Date.now(),
      })
      org = await ctx.db.get(orgId)
    }
    const orgId = org!._id

    const member = await ctx.db
      .query('organizationMembers')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', orgId).eq('userId', owner._id),
      )
      .unique()
    if (!member) {
      await ctx.db.insert('organizationMembers', {
        orgId,
        userId: owner._id,
        role: 'owner',
        joinedAt: Date.now(),
      })
    }

    const result = await upsertGroup(ctx, orgId)
    return { orgId, slug: ORG_SLUG, owner: owner.email, ...result }
  },
})

// ─── Deals d'exemple (illustratifs, tirés de la Notion) ─────────────────────
// Montants en cents EUR, taux en bps. Upsert par `attioDealId` synthétique
// (`seed-example:<clé>`) → idempotent.

type ExtraCompany = {
  name: string
  kind: 'portfolio' | 'group_spv'
  holdingScope?: 'albo' | 'calte'
  sector?: string
  notes?: string
}

const EXAMPLE_COMPANIES: Array<ExtraCompany> = [
  { name: 'Eben Home', kind: 'portfolio', sector: 'Mobilier/déco B2B' },
  { name: 'Hectarea', kind: 'portfolio', sector: 'AgTech / foncier' },
  { name: 'Parallel', kind: 'portfolio', sector: 'Dette immobilière' },
  { name: 'Via Sana', kind: 'portfolio', sector: 'Proptech santé' },
  {
    name: 'SPV Eben Home',
    kind: 'group_spv',
    holdingScope: 'albo',
    notes: 'SPV Albo pour syndiquer des co-investisseurs sur Eben Home.',
  },
  {
    name: 'SPV Hectarea',
    kind: 'group_spv',
    holdingScope: 'albo',
    notes: 'SPV Albo pour syndiquer des co-investisseurs sur Hectarea.',
  },
]

// Part d'Albo DANS chaque SPV (régime mère-fille à traiter plus tard).
const SPV_RELATIONS: Array<{ spv: string; ownershipPct: number }> = [
  { spv: 'SPV Eben Home', ownershipPct: 40 },
  { spv: 'SPV Hectarea', ownershipPct: 35 },
]

type ExampleDeal = {
  key: string
  investor: string
  target: string
  via?: string
  instrumentKind: string
  committedAmount?: number
  paidAmount?: number
  interestRate?: number
  maturityDate?: number
  signedDate?: number
  notes?: string
}

const EXAMPLE_DEALS: Array<ExampleDeal> = [
  {
    key: 'eben-direct',
    investor: 'Albo Club',
    target: 'Eben Home',
    instrumentKind: 'share',
    committedAmount: 2_000_000, // 20 000 €
    paidAmount: 2_000_000,
    signedDate: d(2025, 3, 12),
    notes: 'Ticket equity direct Albo + place au board.',
  },
  {
    key: 'eben-spv',
    investor: 'Albo Club',
    target: 'Eben Home',
    via: 'SPV Eben Home',
    instrumentKind: 'spv_share',
    committedAmount: 5_000_000, // 50 000 €
    paidAmount: 5_000_000,
    signedDate: d(2025, 6, 18),
    notes: 'Investissement via SPV pour embarquer des co-investisseurs.',
  },
  {
    key: 'hectarea-spv',
    investor: 'Albo Club',
    target: 'Hectarea',
    via: 'SPV Hectarea',
    instrumentKind: 'spv_share',
    committedAmount: 3_000_000, // 30 000 €
    paidAmount: 3_000_000,
    signedDate: d(2025, 9, 4),
    notes: 'Investissement via SPV + place au board.',
  },
  {
    key: 'parallel-os',
    investor: 'CALTE',
    target: 'Parallel',
    instrumentKind: 'os',
    committedAmount: 20_000_000, // 200 000 €
    paidAmount: 20_000_000,
    interestRate: 1100, // 11 %
    maturityDate: d(2026, 12, 31),
    signedDate: d(2025, 1, 20),
    notes: 'Obligation simple ~11 % sur 18/24 mois.',
  },
  {
    key: 'viasana-share',
    investor: 'CALTE',
    target: 'Via Sana',
    instrumentKind: 'share',
    committedAmount: 10_000_000, // 100 000 €
    paidAmount: 10_000_000,
    signedDate: d(2024, 11, 8),
    notes: 'Equity + board (synergie SCI Upload qui loue un local à Via Sana).',
  },
]

async function companyIdByName(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  name: string,
) {
  const c = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .filter((q) => q.eq(q.field('name'), name))
    .first()
  return c?._id ?? null
}

/** Seed quelques deals d'exemple dans l'org "Calte Family Office". */
export const seedExampleDeals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
      .first()
    if (!org) throw new ConvexError('org_not_found_run_seedCalteFamilyOffice')
    const orgId = org._id

    // 1) Portfolio + SPV companies (upsert par name).
    const ids = new Map<string, Id<'companies'>>()
    for (const c of EXAMPLE_COMPANIES) {
      const existing = await companyIdByName(ctx, orgId, c.name)
      const fields = {
        orgId,
        name: c.name,
        kind: c.kind,
        holdingScope: c.holdingScope,
        sector: c.sector,
        notes: c.notes,
        countryCode: 'FR',
      }
      if (existing) {
        await ctx.db.patch(existing, fields)
        ids.set(c.name, existing)
      } else {
        ids.set(c.name, await ctx.db.insert('companies', fields))
      }
    }

    // 2) Part d'Albo dans chaque SPV (companyRelations Albo → SPV).
    const alboId = await companyIdByName(ctx, orgId, 'Albo Club')
    if (alboId) {
      for (const r of SPV_RELATIONS) {
        const spvId = ids.get(r.spv)!
        const existing = await ctx.db
          .query('companyRelations')
          .withIndex('by_parent', (q) =>
            q.eq('orgId', orgId).eq('parentCompanyId', alboId),
          )
          .filter((q) => q.eq(q.field('childCompanyId'), spvId))
          .first()
        if (existing) {
          await ctx.db.patch(existing._id, { ownershipPct: r.ownershipPct })
        } else {
          await ctx.db.insert('companyRelations', {
            orgId,
            parentCompanyId: alboId,
            childCompanyId: spvId,
            ownershipPct: r.ownershipPct,
          })
        }
      }
    }

    // 3) Deals (upsert par attioDealId synthétique).
    for (const dl of EXAMPLE_DEALS) {
      const investorCompanyId = await companyIdByName(ctx, orgId, dl.investor)
      const targetCompanyId = ids.get(dl.target) ?? null
      if (!investorCompanyId || !targetCompanyId) continue
      const investor = await ctx.db.get(investorCompanyId)
      const holdingScope = investor?.holdingScope
      if (!holdingScope) continue

      const attioDealId = `seed-example:${dl.key}`
      const fields = {
        orgId,
        investorCompanyId,
        targetCompanyId,
        viaSpvCompanyId: dl.via ? ids.get(dl.via) : undefined,
        instrumentKind: dl.instrumentKind as never,
        holdingScope,
        currency: 'EUR',
        committedAmount: dl.committedAmount,
        paidAmount: dl.paidAmount,
        interestRate: dl.interestRate,
        maturityDate: dl.maturityDate,
        signedDate: dl.signedDate,
        status: 'active' as const,
        attioDealId,
        notes: dl.notes,
      }
      const existing = await ctx.db
        .query('deals')
        .withIndex('by_attio_deal_id', (q) => q.eq('attioDealId', attioDealId))
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, fields)
      } else {
        await ctx.db.insert('deals', fields)
      }
    }

    return {
      orgId,
      companies: EXAMPLE_COMPANIES.length,
      deals: EXAMPLE_DEALS.length,
    }
  },
})
