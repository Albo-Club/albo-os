/// <reference types="vite/client" />
/**
 * Regression: the inert-tables purge counts without touching anything in
 * dry-run mode, empties all four tables when applied, and stays replayable
 * (convex/migrations/purgeInertTables.ts).
 *
 * A table left with a single row would block the schema PR dropping it — a
 * deploy refuses to drop a table that still holds documents.
 */
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'

/**
 * Reached through `anyApi`, not `internal`: `convex/_generated/api.d.ts` is
 * committed and only regenerates against a real deployment, so a module added
 * without Convex credentials is absent from the typed tree (cf.
 * KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer lui-même
 * hors déploiement »). Prod is unaffected — the CLI calls it by path.
 */
const run = anyApi.migrations.purgeInertTables.run

type Result = {
  dryRun: boolean
  rows: Record<string, number>
  total: number
}

async function seed(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  await t.run(async (ctx) => {
    const now = Date.now()
    await ctx.db.insert('userEmailAliases', {
      userId: user.userId,
      email: 'benjamin@perso.test',
      addedBy: user.userId,
      addedAt: now,
    })
    await ctx.db.insert('gmailAccounts', {
      orgId: org.orgId,
      userId: user.userId,
      email: 'benjamin@test.dev',
      refreshToken: 'secret',
      status: 'connected',
      createdAt: now,
    })
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('gmailOAuthStates', {
        orgId: org.orgId,
        userId: user.userId,
        state: `state-${i}`,
        returnTo: '/app/albo',
        createdAt: now,
      })
    }
    await ctx.db.insert('vascoConnections', {
      orgId: org.orgId,
      clientSlug: 'parallel',
      label: 'Parallel — Albo',
      username: 'albo@test.dev',
      password: 'secret',
      active: true,
      createdAt: now,
    })
  })
}

const EXPECTED = {
  userEmailAliases: 1,
  gmailAccounts: 1,
  gmailOAuthStates: 3,
  vascoConnections: 1,
}

describe('purgeInertTables', () => {
  test('dry run counts every table and deletes nothing', async () => {
    const t = setupHarness()
    await seed(t)
    const res: Result = await t.mutation(run, { dryRun: true })
    expect(res).toEqual({ dryRun: true, rows: EXPECTED, total: 6 })
    // Nothing was touched: a second dry run sees the same rows.
    const again: Result = await t.mutation(run, { dryRun: true })
    expect(again.total).toBe(6)
  })

  test('apply empties all four tables, and a replay finds nothing', async () => {
    const t = setupHarness()
    await seed(t)
    const res: Result = await t.mutation(run, { dryRun: false })
    expect(res).toEqual({ dryRun: false, rows: EXPECTED, total: 6 })
    const replay: Result = await t.mutation(run, { dryRun: false })
    expect(replay.total).toBe(0)
    expect(Object.values(replay.rows)).toEqual([0, 0, 0, 0])
  })
})
