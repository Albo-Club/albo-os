/// <reference types="vite/client" />
/**
 * Regression: emptying the retired email timeline walks both tables to the
 * end and stays replayable (convex/migrations/purgeCompanyEmails.ts).
 *
 * A purge that stopped after its first page would leave rows that block the
 * schema PR dropping the tables — a deploy refuses to drop a table that
 * still holds documents — and would keep pinning attachments in file
 * storage. So: every row goes, and a second pass finds nothing.
 */
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'

/**
 * Reached through `anyApi`, not `internal`: `convex/_generated/api.d.ts` is
 * committed and only regenerates against a real deployment, so a module added
 * without Convex credentials is absent from the typed tree (cf.
 * KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer lui-même
 * hors déploiement »). Prod is unaffected — the script calls it by path.
 */
const scanPage = anyApi.migrations.purgeCompanyEmails.scanPage
const purgeBatch = anyApi.migrations.purgeCompanyEmails.purgeBatch

async function seed(t: Harness, emails: number, linksPerEmail: number) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Ouisub')
  await t.run(async (ctx) => {
    for (let i = 0; i < emails; i++) {
      const emailId = await ctx.db.insert('companyEmails', {
        headerMessageId: `<msg-${i}@test.dev>`,
        subject: `Reporting ${i}`,
        bodyText: 'Le chiffre d’affaires progresse.',
        fromEmail: 'ceo@ouisub.test',
        toEmails: ['benjamin@test.dev'],
        ccEmails: [],
        sentAt: Date.now() - i,
        direction: 'incoming',
        accountEmails: ['benjamin@test.dev'],
      })
      for (let j = 0; j < linksPerEmail; j++) {
        await ctx.db.insert('companyEmailLinks', {
          companyId,
          orgId: org.orgId,
          emailId,
          sentAt: Date.now() - i,
        })
      }
    }
  })
}

async function countRows(t: Harness, table: string) {
  let seen = 0
  let cursor: string | null = null
  for (;;) {
    const page: { seen: number; cursor: string; isDone: boolean } =
      await t.query(scanPage, { table, cursor, numItems: 2 })
    seen += page.seen
    if (page.isDone) return seen
    cursor = page.cursor
  }
}

async function purgeAll(t: Harness, table: string) {
  let deleted = 0
  for (;;) {
    const res = await t.mutation(purgeBatch, { table, numItems: 2 })
    deleted += res.deleted
    if (res.isDone) return deleted
  }
}

describe('purgeCompanyEmails', () => {
  test('counts every row of both tables, page after page', async () => {
    const t = setupHarness()
    await seed(t, 3, 2)
    expect(await countRows(t, 'companyEmails')).toBe(3)
    expect(await countRows(t, 'companyEmailLinks')).toBe(6)
  })

  test('deletes every row, in pages, and a replay finds nothing', async () => {
    const t = setupHarness()
    await seed(t, 3, 2)

    expect(await purgeAll(t, 'companyEmailLinks')).toBe(6)
    expect(await purgeAll(t, 'companyEmails')).toBe(3)

    expect(await countRows(t, 'companyEmails')).toBe(0)
    expect(await countRows(t, 'companyEmailLinks')).toBe(0)
    expect(await purgeAll(t, 'companyEmails')).toBe(0)
  })
})
