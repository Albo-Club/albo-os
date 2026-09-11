/// <reference types="vite/client" />
/**
 * Regression: the orphan purge cannot eat a file someone is uploading
 * (convex/migrations/storagePurge.ts, ALB-234).
 *
 * 501 MB — 28 % of file storage — were held by nothing, and deleting them is
 * the point. But "held by nothing" is also what a legitimate upload looks like
 * for a few seconds: the browser PUTs the bytes FIRST, and only then does the
 * mutation create the row pointing at them. A purge that ignores age deletes
 * the file a user is uploading right now, and the failure is silent on the
 * server — it surfaces as a broken document on their screen.
 *
 * Hence two floors, both re-checked at delete time rather than trusted from
 * the sweep that selected the batch minutes earlier: the blob must be older
 * than a day, and no `documents` row may have claimed it since.
 */
import { anyApi } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { setupHarness } from './regression.setup'
import type { Id } from './_generated/dataModel'

/**
 * Reached through `anyApi`, not `internal`: `convex/_generated/api.d.ts` is
 * committed and only regenerates against a real deployment, so a module added
 * without Convex credentials is absent from the typed tree (cf.
 * KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer lui-même
 * hors déploiement »). Prod is unaffected — the script calls it by path
 * through `convex run` — but a test importing `internal.migrations.storagePurge`
 * fails to compile. `anyApi` is Convex's own escape hatch for that.
 */
const deleteOrphans = anyApi.migrations.storagePurge.deleteOrphans

const DAY = 24 * 60 * 60 * 1000

/** A stored blob, plus the rows a caller asks for around it. */
async function seedBlob(
  t: ReturnType<typeof setupHarness>,
  opts: { claimed?: boolean; withText?: boolean } = {},
): Promise<Id<'_storage'>> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(['pdf'], { type: 'application/pdf' }),
    )
    if (opts.withText) {
      await ctx.db.insert('documentTexts', {
        storageId,
        text: 'texte extrait',
        truncated: false,
      })
    }
    if (opts.claimed) {
      const userId = await ctx.db.insert('users', {
        betterAuthId: 'ba-test',
        email: 'benjamin@example.test',
        superAdmin: false,
        createdAt: Date.now(),
      })
      const orgId = await ctx.db.insert('organizations', {
        slug: 'albo',
        name: 'albo',
        createdBy: userId,
        createdAt: Date.now(),
      })
      const companyId = await ctx.db.insert('companies', {
        orgId,
        name: 'Ouisub',
        kind: 'portfolio' as const,
      })
      await ctx.db.insert('documents', {
        orgId,
        companyId,
        title: 'Board Ouisub',
        kind: 'reporting' as const,
        storageId,
        contentType: 'application/pdf',
        size: 3_900_000,
        source: 'upload' as const,
        uploadedAt: Date.now(),
      })
    }
    return storageId
  })
}

const exists = (t: ReturnType<typeof setupHarness>, id: Id<'_storage'>) =>
  t.run(async (ctx) => (await ctx.db.system.get('_storage', id)) !== null)

/**
 * Push the clock past the age floor. `_creationTime` is set by the backend at
 * insert and cannot be back-dated, so the only way to test the OTHER guard is
 * to move the present instead — otherwise every case would pass on the age
 * floor alone and prove nothing.
 */
function ageBlobsPastFloor() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(Date.now() + 2 * DAY))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('purge des fichiers orphelins', () => {
  test('ÉPARGNE un fichier trop jeune — un upload en cours', async () => {
    // The blob is seconds old and unheld: that is an upload mid-flight, not an
    // orphan. This is the test that protects a user's file.
    const t = setupHarness()
    const storageId = await seedBlob(t)

    const res = await t.mutation(deleteOrphans, {
      storageIds: [storageId],
      dryRun: false,
    })

    expect(res.deleted).toBe(0)
    expect(res.spared).toBe(1)
    expect(await exists(t, storageId)).toBe(true)
  })

  test('supprime un orphelin assez vieux, et son texte extrait avec', async () => {
    const t = setupHarness()
    const storageId = await seedBlob(t, { withText: true })
    ageBlobsPastFloor()

    const res = await t.mutation(deleteOrphans, {
      storageIds: [storageId],
      dryRun: false,
    })

    expect(res.deleted).toBe(1)
    expect(res.bytes).toBeGreaterThan(0)
    expect(await exists(t, storageId)).toBe(false)
    const text = await t.run(async (ctx) =>
      ctx.db
        .query('documentTexts')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first(),
    )
    expect(text).toBeNull()
  })

  test('épargne un fichier qu une fiche réclame, même assez vieux', async () => {
    // Age is no longer what spares it — the claim is. Without the clock jump
    // this test would pass on the age floor and prove nothing.
    const t = setupHarness()
    const storageId = await seedBlob(t, { claimed: true })
    ageBlobsPastFloor()

    const res = await t.mutation(deleteOrphans, {
      storageIds: [storageId],
      dryRun: false,
    })

    expect(res.deleted).toBe(0)
    expect(res.spared).toBe(1)
    expect(await exists(t, storageId)).toBe(true)
  })

  test('dryRun compte sans rien supprimer', async () => {
    const t = setupHarness()
    const storageId = await seedBlob(t, { withText: true })
    ageBlobsPastFloor()

    const res = await t.mutation(deleteOrphans, {
      storageIds: [storageId],
      dryRun: true,
    })

    expect(res.deleted).toBe(1)
    expect(await exists(t, storageId)).toBe(true)
  })

  test('rejouée, la purge ne retrouve rien à faire', async () => {
    const t = setupHarness()
    const storageId = await seedBlob(t)
    ageBlobsPastFloor()
    const args = { storageIds: [storageId], dryRun: false }

    const first = await t.mutation(deleteOrphans, args)
    const second = await t.mutation(deleteOrphans, args)

    expect(first.deleted).toBe(1)
    expect(second).toEqual({ deleted: 0, bytes: 0, spared: 0 })
  })

  test('un fichier déjà disparu ne fait pas échouer le lot', async () => {
    // Replays and concurrent deletions must not poison the batch.
    const t = setupHarness()
    const storageId = await seedBlob(t)
    await t.run(async (ctx) => ctx.storage.delete(storageId))

    const res = await t.mutation(deleteOrphans, {
      storageIds: [storageId],
      dryRun: false,
    })

    expect(res.deleted).toBe(0)
    expect(res.spared).toBe(0)
  })

  test('un lot vide est un no-op', async () => {
    const t = setupHarness()
    const res = await t.mutation(deleteOrphans, {
      storageIds: [],
      dryRun: false,
    })
    expect(res).toEqual({ deleted: 0, bytes: 0, spared: 0 })
  })
})
