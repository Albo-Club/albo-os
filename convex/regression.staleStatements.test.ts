/// <reference types="vite/client" />
/**
 * Regression: the « statement getting old » To-do signal — `convex/todo.ts`.
 *
 * Three invariants are pinned here, all of them deliberate choices that a
 * later refactor could undo without any test noticing:
 *
 * 1. The threshold is read on the STATEMENT's date, never on the import's.
 *    A statement drawn in August and uploaded in November is three months
 *    old either way, and judging the upload would reset the clock for free.
 * 2. ONE line per statement reader, not per account. A Natixis PDF covers
 *    three accounts at once; three lines would be three reminders for a
 *    single upload.
 * 3. An org that has never imported a statement says NOTHING. The signal
 *    reads a habit, like the missing-rent one: with no habit there is
 *    nothing to renew, and a tab that shouts on day one gets ignored.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'

import type { Id } from './_generated/dataModel'
import type { Harness, TestOrg } from './regression.setup'

const DAY_MS = 24 * 60 * 60 * 1000

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'statements@test.dev')
  const org = await createOrg(t, 'org-statements', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

/**
 * An imported statement, `daysAgo` old. `importedDaysAgo` defaults to the
 * same day — test 1 is the one that pulls them apart.
 */
async function importedStatement(
  t: Harness,
  org: TestOrg,
  userId: Id<'users'>,
  {
    daysAgo,
    importedDaysAgo = daysAgo,
    bankName = 'Natixis Wealth Management',
    accountsCount = 1,
  }: {
    daysAgo: number
    importedDaysAgo?: number
    bankName?: string
    accountsCount?: number
  },
) {
  const now = Date.now()
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(['pdf']))
    await ctx.db.insert('statementImports', {
      orgId: org.orgId,
      source: 'natixis_wm',
      statementDate: now - daysAgo * DAY_MS,
      bankName,
      storageId,
      accountsCount,
      positionsCount: accountsCount * 4,
      totalValuation: 600_000_000,
      importedBy: userId,
      importedAt: now - importedDaysAgo * DAY_MS,
    })
  })
}

describe('stale securities statements', () => {
  test('a statement older than 90 days is flagged, one of 89 days is not', async () => {
    const fresh = await orgSetup()
    await importedStatement(fresh.t, fresh.org, fresh.user.userId, {
      daysAgo: 89,
    })
    const quiet = await fresh.user.as.query(api.todo.getTodo, {
      orgId: fresh.org.orgId,
    })
    expect(quiet.staleStatements).toEqual([])

    const old = await orgSetup()
    await importedStatement(old.t, old.org, old.user.userId, { daysAgo: 91 })
    const loud = await old.user.as.query(api.todo.getTodo, {
      orgId: old.org.orgId,
    })
    expect(loud.staleStatements.map((row) => row.bankName)).toEqual([
      'Natixis Wealth Management',
    ])
  })

  test('the STATEMENT date decides, not the import date', async () => {
    // Uploaded yesterday, but drawn six months ago: still stale. Reading
    // `importedAt` here would let a late upload silence the signal.
    const { t, user, org } = await orgSetup()
    await importedStatement(t, org, user.userId, {
      daysAgo: 180,
      importedDaysAgo: 1,
    })
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.staleStatements).toHaveLength(1)
    expect(todo.staleStatements[0].lastStatementDate).toBeLessThan(
      Date.now() - 90 * DAY_MS,
    )
  })

  test('only the LATEST statement of a reader is judged', async () => {
    // A year of history plus a fresh one must not keep crying: the old rows
    // stay in the table, and only the most recent date answers the question.
    const { t, user, org } = await orgSetup()
    await importedStatement(t, org, user.userId, { daysAgo: 400 })
    await importedStatement(t, org, user.userId, { daysAgo: 200 })
    await importedStatement(t, org, user.userId, { daysAgo: 10 })
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.staleStatements).toEqual([])
  })

  test('one line per reader, whatever the number of accounts it covers', async () => {
    const { t, user, org } = await orgSetup()
    await importedStatement(t, org, user.userId, {
      daysAgo: 120,
      accountsCount: 3,
    })
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.staleStatements).toHaveLength(1)
  })

  test('an org that never imported a statement says nothing', async () => {
    const { user, org } = await orgSetup()
    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.staleStatements).toEqual([])
  })

  test("another org's statement never leaks into this one", async () => {
    const { t, user, org } = await orgSetup()
    const other = await createUser(t, 'other@test.dev')
    const otherOrg = await createOrg(t, 'org-other-statements', [
      { userId: other.userId, role: 'owner' },
    ])
    await importedStatement(t, otherOrg, other.userId, { daysAgo: 300 })

    const todo = await user.as.query(api.todo.getTodo, { orgId: org.orgId })
    expect(todo.staleStatements).toEqual([])
  })
})
