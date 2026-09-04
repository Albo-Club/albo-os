/// <reference types="vite/client" />
/**
 * Regression: `migrations/seedGroupCapTables`.
 *
 * The script runs ONCE against prod, so its invariants are worth pinning: it
 * is IDEMPOTENT (a second run writes nothing), it FILLS an absent share on an
 * existing position without touching the rest of it, and it NEVER overwrites
 * a share that contradicts the table — such a row is reported instead.
 */
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'

/**
 * Addressed by path, not through `internal.*`: `_generated/api.d.ts` only
 * learns about a new module when a Convex deployment regenerates it, and that
 * file is never edited by hand (CLAUDE.md § Anti-patterns).
 */
type ApplyResult = {
  created: Array<string>
  filled: Array<string>
  conflicts: Array<string>
}

type InspectResult = {
  totals: {
    create: number
    fillOwnership: number
    skip: number
    conflict: number
    amountMismatch: number
  }
  orgs: Array<{
    orgSlug: string
    ownershipSumBps: number
    amountSumCents: number
    rootIncorporationDate: number | null
    rows: Array<{
      holder: string
      action: string
      ownershipBps: number
      existingOwnershipBps: number | null
      amountCents: number
      existingAmountCents: number | null
    }>
  }>
}

const applyRef = makeFunctionReference<
  'mutation',
  Record<string, never>,
  ApplyResult
>('migrations/seedGroupCapTables:apply')

const inspectRef = makeFunctionReference<
  'query',
  Record<string, never>,
  InspectResult
>('migrations/seedGroupCapTables:inspect')

/** The nine orgs the table writes into. */
const ORG_SLUGS = [
  'calte',
  'albo',
  'caltimo',
  'rdb',
  'relais-chapelle',
  'sci-chapelle',
  'sci-chapelle-2',
  'sci-upload',
  'banco-2',
]

async function groupSetup() {
  const t = setupHarness()
  const owner = await createUser(t, 'owner@test.dev')
  for (const slug of ORG_SLUGS) {
    await createOrg(t, slug, [{ userId: owner.userId, role: 'owner' }])
  }
  return { t, owner }
}

const positionsOf = (t: Harness, slug: string) =>
  t.run(async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    return await ctx.db
      .query('equityPositions')
      .withIndex('by_org', (q) => q.eq('orgId', org!._id))
      .collect()
  })

describe('seedGroupCapTables: apply', () => {
  test('writes each cap table in full, holder org or free label', async () => {
    const { t } = await groupSetup()

    const { created, filled, conflicts } = await t.mutation(applyRef, {})
    expect(created).toHaveLength(14)
    expect(filled).toHaveLength(0)
    expect(conflicts).toHaveLength(0)

    // A wholly-owned subsidiary: the holder is the CALTE ORG, not a label.
    const caltimo = await positionsOf(t, 'caltimo')
    expect(caltimo).toHaveLength(1)
    expect(caltimo[0].ownershipBps).toBe(10_000)
    expect(caltimo[0].amountCents).toBe(100_000)
    expect(caltimo[0].shares).toBe(10_000)
    expect(caltimo[0].holderOrgId).not.toBeUndefined()
    expect(caltimo[0].holderLabel).toBeUndefined()

    // A shared one: both sides recorded, and the two add up to 100 %.
    const chapelle = await positionsOf(t, 'sci-chapelle')
    expect(chapelle).toHaveLength(2)
    expect(chapelle.reduce((sum, p) => sum + (p.ownershipBps ?? 0), 0)).toBe(
      10_000,
    )
    expect(chapelle.reduce((sum, p) => sum + p.amountCents, 0)).toBe(100_000)
    const felisa = chapelle.find((p) => p.holderOrgId == null)
    expect(felisa?.holderLabel).toBe('Felisa Carmen Mendoza Garcia')
    expect(felisa?.shares).toBe(5_000)

    // Banco 2: no deed states the share count, so none is invented.
    const banco = await positionsOf(t, 'banco-2')
    expect(banco).toHaveLength(2)
    expect(banco.every((p) => p.shares === undefined)).toBe(true)
    expect(banco.every((p) => p.ownershipBps === 5_000)).toBe(true)
  })

  test('is idempotent — a second run writes nothing', async () => {
    const { t } = await groupSetup()
    await t.mutation(applyRef, {})
    const second = await t.mutation(applyRef, {})

    expect(second.created).toHaveLength(0)
    expect(second.filled).toHaveLength(0)
    expect(second.conflicts).toHaveLength(0)

    const chapelle = await positionsOf(t, 'sci-chapelle')
    expect(chapelle).toHaveLength(2)

    const report = await t.query(inspectRef, {})
    expect(report.totals).toMatchObject({
      create: 0,
      fillOwnership: 0,
      skip: 14,
      conflict: 0,
    })
  })

  test('fills an absent share without touching the rest of the position', async () => {
    const { t } = await groupSetup()
    // The Albo case: the positions exist since the initial seed, possibly
    // without their share — and with an effective date of their own.
    const seeded = Date.parse('2024-10-31T00:00:00.000Z')
    await t.run(async (ctx) => {
      const albo = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'albo'))
        .unique()
      const calte = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
        .unique()
      await ctx.db.insert('equityPositions', {
        orgId: albo!._id,
        holderOrgId: calte!._id,
        type: 'capital_social',
        amountCents: 242_500_000,
        effectiveDate: seeded,
      })
    })

    const { created, filled } = await t.mutation(applyRef, {})
    expect(filled).toEqual(['albo/calte'])
    // The Benjamin line is still missing, so it IS created.
    expect(created).toContain('albo/Benjamin Bouquet')

    const albo = await positionsOf(t, 'albo')
    expect(albo).toHaveLength(2)
    const calteLine = albo.find((p) => p.holderOrgId != null)!
    expect(calteLine.ownershipBps).toBe(9_700)
    expect(calteLine.amountCents).toBe(242_500_000)
    expect(calteLine.effectiveDate).toBe(seeded)
  })

  test('never overwrites a share that contradicts the table', async () => {
    const { t } = await groupSetup()
    await t.run(async (ctx) => {
      const caltimo = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'caltimo'))
        .unique()
      const calte = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
        .unique()
      await ctx.db.insert('equityPositions', {
        orgId: caltimo!._id,
        holderOrgId: calte!._id,
        type: 'capital_social',
        amountCents: 100_000,
        ownershipBps: 5_100,
        effectiveDate: Date.parse('2023-12-07T00:00:00.000Z'),
      })
    })

    const report = await t.query(inspectRef, {})
    expect(report.totals.conflict).toBe(1)

    const { conflicts } = await t.mutation(applyRef, {})
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('caltimo/calte')

    const caltimo = await positionsOf(t, 'caltimo')
    expect(caltimo).toHaveLength(1)
    expect(caltimo[0].ownershipBps).toBe(5_100)
  })
})

describe('seedGroupCapTables: inspect', () => {
  test('reports a complete cap table per org, before anything is written', async () => {
    const { t } = await groupSetup()
    const report = await t.query(inspectRef, {})

    expect(report.totals).toMatchObject({ create: 14, skip: 0, conflict: 0 })
    // Every entity's table adds up to 100 % — a missing holder shows here.
    expect(report.orgs.every((org) => org.ownershipSumBps === 10_000)).toBe(
      true,
    )

    const chapelle2 = report.orgs.find(
      (org) => org.orgSlug === 'sci-chapelle-2',
    )!
    expect(chapelle2.amountSumCents).toBe(100_000)
    expect(chapelle2.rows.map((r) => r.ownershipBps).sort()).toEqual([
      100, 9900,
    ])

    // Nothing was written by the read-only pass.
    expect(await positionsOf(t, 'caltimo')).toHaveLength(0)
  })
})
