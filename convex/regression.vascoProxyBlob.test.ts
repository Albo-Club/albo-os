/// <reference types="vite/client" />
/**
 * Regression: the Parallel download proxy is a COURIER, not an archive
 * (convex/vasco.ts, ALB-234).
 *
 * A portal document lives behind an authenticated endpoint, so opening one
 * from the app makes the server fetch the bytes, put them in Convex storage
 * and hand the browser a URL for that copy. Nothing ever referenced that copy
 * — and until 09/2026 nothing deleted it either. One click, one permanent
 * duplicate of a file the base usually already had, for ever.
 *
 * The audit priced it: 501 MB, 28 % of file storage, 86 % of all the wasted
 * bytes, growing ~45 blobs a day and accelerating. The 3.9 MB Ouisub board
 * deck existed in SEVEN copies — three real documents and four clicks.
 *
 * So the copy is now discarded on a schedule. The property that matters is not
 * that it disappears, it is that it disappears ONLY while still unclaimed: a
 * `documents` row pointing at it turns the courier into an archive, and
 * deleting it then would blank a document a user can see.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { setupHarness } from './regression.setup'

describe('vasco download proxy — discardProxyBlob', () => {
  test('jette la copie que personne ne réclame', async () => {
    const t = setupHarness()
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' })),
    )

    await t.mutation(internal.vasco.discardProxyBlob, { storageId })

    const meta = await t.run(async (ctx) => ctx.db.system.get('_storage', storageId))
    expect(meta).toBeNull()
  })

  test('épargne la copie qu une fiche a réclamée entre-temps', async () => {
    // The whole point: between the download and the scheduled discard, the
    // blob may have become a real document. Deleting it then is data loss.
    // No auth helpers here: `discardProxyBlob` is internal and reads nothing
    // but the blob and its claim, so the rows are inserted straight in.
    const t = setupHarness()
    const storageId = await t.run(async (ctx) => {
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
      const id = await ctx.storage.store(
        new Blob(['pdf'], { type: 'application/pdf' }),
      )
      await ctx.db.insert('documents', {
        orgId,
        companyId,
        title: 'Board Ouisub',
        kind: 'reporting' as const,
        storageId: id,
        contentType: 'application/pdf',
        size: 3_900_000,
        source: 'upload' as const,
        uploadedAt: Date.now(),
      })
      return id
    })

    await t.mutation(internal.vasco.discardProxyBlob, { storageId })

    const meta = await t.run(async (ctx) => ctx.db.system.get('_storage', storageId))
    expect(meta).not.toBeNull()
  })

  test('est idempotente : rejouée sur une copie déjà jetée, elle ne casse pas', async () => {
    // The scheduler can fire twice; a crash here would poison the queue.
    const t = setupHarness()
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' })),
    )
    await t.mutation(internal.vasco.discardProxyBlob, { storageId })
    await expect(
      t.mutation(internal.vasco.discardProxyBlob, { storageId }),
    ).resolves.toBeNull()
  })
})
