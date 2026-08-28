/// <reference types="vite/client" />
/**
 * Regression: `migrations/createSubsidiaryOrgs` (ALB-128).
 *
 * The script runs ONCE against prod, so its two invariants are worth pinning:
 * it is strictly ADDITIVE (no existing row is modified — the source company
 * keeps its kind, its deals and its bank accounts) and it is IDEMPOTENT (a
 * second run creates nothing).
 */
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

/**
 * Addressed by path, not through `internal.*`: `_generated/api.d.ts` only
 * learns about a new module when a Convex deployment regenerates it, and that
 * file is never edited by hand (CLAUDE.md § Anti-patterns). The prod runbook
 * uses the same path form (`convex run migrations/…:inspect`).
 */
type ApplyResult = {
  created: Array<{
    slug: string
    org: boolean
    rootCompany: boolean
    memberships: number
  }>
}

type InspectResult = {
  sourceOrg: { slug: string; name: string }
  memberCount: number
  subsidiaries: Array<{
    slug: string
    name: string
    kindInCalte: string
    orgToCreate: boolean
    rootCompanyToCreate: boolean
    membershipsToAdd: number
    dealsAsInvestor: number
    bankAccountsOwned: number
  }>
}

const applyRef = makeFunctionReference<
  'mutation',
  Record<string, never>,
  ApplyResult
>('migrations/createSubsidiaryOrgs:apply')

const inspectRef = makeFunctionReference<
  'query',
  Record<string, never>,
  InspectResult
>('migrations/createSubsidiaryOrgs:inspect')

/** The seven source companies the migration carves the orgs out of. */
const SOURCES: Array<{
  name: string
  kind: 'group_operating' | 'group_sci' | 'group_manco'
}> = [
  { name: 'Caltimo', kind: 'group_operating' },
  { name: 'RDB', kind: 'group_operating' },
  { name: 'Relais Chapelle', kind: 'group_operating' },
  { name: 'SCI Chapelle', kind: 'group_sci' },
  { name: 'SCI Chapelle 2', kind: 'group_sci' },
  { name: 'SCI Upload', kind: 'group_sci' },
  { name: 'Banco 2', kind: 'group_manco' },
]

/** An org `calte` holding the seven subsidiaries as group entities. */
async function calteSetup() {
  const t = setupHarness()
  const owner = await createUser(t, 'owner@test.dev')
  const member = await createUser(t, 'member@test.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: owner.userId, role: 'owner' },
    { userId: member.userId, role: 'member' },
  ])
  const sourceIds = new Map<string, Id<'companies'>>()
  await t.run(async (ctx) => {
    for (const source of SOURCES) {
      sourceIds.set(
        source.name,
        await ctx.db.insert('companies', {
          orgId: calte.orgId,
          name: source.name,
          legalName: `${source.name} SAS`,
          kind: source.kind,
          siren: '123456789',
          legalForm: 'SAS',
          attioCompanyId: `attio-${source.name}`,
        }),
      )
    }
  })
  return { t, owner, member, calte, sourceIds }
}

const orgBySlug = (t: Harness, slug: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique(),
  )

describe('createSubsidiaryOrgs: apply', () => {
  test('creates the seven orgs, their root company and mirrors the memberships', async () => {
    const { t, owner, member } = await calteSetup()

    const { created } = await t.mutation(applyRef, {})
    expect(created).toHaveLength(7)
    expect(created.every((c) => c.org && c.rootCompany)).toBe(true)

    const caltimo = await orgBySlug(t, 'caltimo')
    expect(caltimo?.name).toBe('Caltimo')

    await t.run(async (ctx) => {
      const roots = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', caltimo!._id).eq('kind', 'group_root'),
        )
        .collect()
      expect(roots).toHaveLength(1)
      // Legal identity is cloned…
      expect(roots[0].legalName).toBe('Caltimo SAS')
      expect(roots[0].siren).toBe('123456789')
      // …but never the anchors that identify one single row.
      expect(roots[0].attioCompanyId).toBeUndefined()

      // Both members of `calte`, each keeping their role.
      const members = await ctx.db
        .query('organizationMembers')
        .withIndex('by_org', (q) => q.eq('orgId', caltimo!._id))
        .collect()
      expect(members.map((m) => [m.userId, m.role]).sort()).toEqual(
        [
          [owner.userId, 'owner'],
          [member.userId, 'member'],
        ].sort(),
      )
    })
  })

  test('leaves the source companies untouched', async () => {
    const { t, calte } = await calteSetup()
    await t.mutation(applyRef, {})

    await t.run(async (ctx) => {
      const companies = await ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', calte.orgId))
        .collect()
      // The org's own root + the seven sources — nothing added, nothing moved.
      expect(companies).toHaveLength(8)
      const caltimo = companies.find((c) => c.name === 'Caltimo')
      expect(caltimo?.kind).toBe('group_operating')
      expect(caltimo?.attioCompanyId).toBe('attio-Caltimo')
    })
  })

  test('is idempotent — a second run creates nothing', async () => {
    const { t } = await calteSetup()
    await t.mutation(applyRef, {})
    const second = await t.mutation(applyRef, {})

    expect(second.created.every((c) => !c.org && !c.rootCompany)).toBe(true)
    expect(second.created.every((c) => c.memberships === 0)).toBe(true)

    await t.run(async (ctx) => {
      const orgs = await ctx.db.query('organizations').collect()
      // `calte` + the seven subsidiaries, no duplicate.
      expect(orgs).toHaveLength(8)
      const caltimo = orgs.find((o) => o.slug === 'caltimo')!
      const roots = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', caltimo._id).eq('kind', 'group_root'),
        )
        .collect()
      expect(roots).toHaveLength(1)
    })
  })
})

describe('createSubsidiaryOrgs: inspect', () => {
  test('reports what still ties a source line to calte', async () => {
    const { t, calte, sourceIds } = await calteSetup()
    const caltimoSource = sourceIds.get('Caltimo')!

    await t.run(async (ctx) => {
      const target = await ctx.db.insert('companies', {
        orgId: calte.orgId,
        name: 'Cible',
        kind: 'portfolio',
      })
      await ctx.db.insert('deals', {
        orgId: calte.orgId,
        investorCompanyId: caltimoSource,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'active',
      })
      await ctx.db.insert('bankAccounts', {
        orgId: calte.orgId,
        ownerCompanyId: caltimoSource,
        bankName: 'Test Bank',
        label: 'Compte Caltimo',
        currency: 'EUR',
      })
    })

    const report = await t.query(inspectRef, {})
    const caltimo = report.subsidiaries.find((s) => s.slug === 'caltimo')!
    expect(caltimo.orgToCreate).toBe(true)
    expect(caltimo.dealsAsInvestor).toBe(1)
    expect(caltimo.bankAccountsOwned).toBe(1)

    const rdb = report.subsidiaries.find((s) => s.slug === 'rdb')!
    expect(rdb.dealsAsInvestor).toBe(0)
    expect(rdb.bankAccountsOwned).toBe(0)
  })
})
