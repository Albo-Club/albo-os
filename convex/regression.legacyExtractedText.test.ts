/// <reference types="vite/client" />
/**
 * Regression: emptying the legacy `documents.extractedText` field never loses
 * a text (convex/migrations/legacyExtractedText.ts).
 *
 * The field is dead weight on every read, and removing it is the point. But
 * some rows carry the only copy of their file's text — put there before
 * `documentTexts` existed — and losing it means paying an OCR pass again. So
 * the migration must move that text over when the blob has none, leave the
 * live copy alone when it has one, and stay replayable.
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
import type { Id } from './_generated/dataModel'

/**
 * Reached through `anyApi`, not `internal`: `convex/_generated/api.d.ts` is
 * committed and only regenerates against a real deployment, so a module added
 * without Convex credentials is absent from the typed tree (cf.
 * KNOWN_ISSUES.md « Un nouveau module Convex ne peut pas se citer lui-même
 * hors déploiement »). Prod is unaffected — the script calls it by path.
 */
const scanPage = anyApi.migrations.legacyExtractedText.scanPage
const migrateBatch = anyApi.migrations.legacyExtractedText.migrateBatch

async function setup(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Ouisub')
  return { orgId: org.orgId, companyId }
}

async function storeBlob(t: Harness): Promise<Id<'_storage'>> {
  return await t.run((ctx) =>
    ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' })),
  )
}

async function createDocument(
  t: Harness,
  ids: { orgId: Id<'organizations'>; companyId: Id<'companies'> },
  storageId: Id<'_storage'>,
  legacy?: { extractedText: string; vectorState?: 'skipped' },
): Promise<Id<'documents'>> {
  return await t.run((ctx) =>
    ctx.db.insert('documents', {
      orgId: ids.orgId,
      companyId: ids.companyId,
      title: 'Pacte',
      kind: 'legal',
      storageId,
      contentType: 'application/pdf',
      size: 3,
      source: 'upload',
      uploadedAt: Date.now(),
      ...legacy,
    }),
  )
}

async function migrateAll(t: Harness, documentIds: Array<Id<'documents'>>) {
  return await t.mutation(migrateBatch, { documentIds })
}

describe('legacyExtractedText', () => {
  test('lists only the rows still carrying the field, with their size', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const legacyId = await createDocument(t, ids, await storeBlob(t), {
      extractedText: 'abcde',
    })
    await createDocument(t, ids, await storeBlob(t))

    const page = await t.query(scanPage, { cursor: null, numItems: 50 })
    expect(page.seen).toBe(2)
    expect(page.isDone).toBe(true)
    expect(page.legacy).toEqual([{ documentId: legacyId, chars: 5 }])
  })

  test('moves the only copy of a text to documentTexts and re-opens indexing', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const storageId = await storeBlob(t)
    const documentId = await createDocument(t, ids, storageId, {
      extractedText: 'Le pacte prévoit une clause de liquidité.',
      vectorState: 'skipped',
    })

    expect(await migrateAll(t, [documentId])).toEqual({
      copied: 1,
      dropped: 0,
      skipped: 0,
    })

    const doc = await t.run((ctx) => ctx.db.get('documents', documentId))
    expect(doc?.extractedText).toBeUndefined()
    expect(doc?.ocrState).toBe('extracted')
    expect(doc?.ocrChars).toBe(41)
    expect(doc?.vectorState).toBeUndefined()
    const text = await t.run((ctx) =>
      ctx.db
        .query('documentTexts')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .collect(),
    )
    expect(text).toHaveLength(1)
    expect(text[0].text).toBe('Le pacte prévoit une clause de liquidité.')
    expect(text[0].truncated).toBe(false)
  })

  test('leaves the live text alone when the blob already has one', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const storageId = await storeBlob(t)
    await t.run((ctx) =>
      ctx.db.insert('documentTexts', {
        storageId,
        text: 'texte vivant',
        truncated: false,
      }),
    )
    const documentId = await createDocument(t, ids, storageId, {
      extractedText: 'vieille copie',
    })

    expect(await migrateAll(t, [documentId])).toEqual({
      copied: 0,
      dropped: 1,
      skipped: 0,
    })

    const doc = await t.run((ctx) => ctx.db.get('documents', documentId))
    expect(doc?.extractedText).toBeUndefined()
    expect(doc?.ocrState).toBeUndefined()
    const texts = await t.run((ctx) => ctx.db.query('documentTexts').collect())
    expect(texts.map((r) => r.text)).toEqual(['texte vivant'])
  })

  test('a fan-out sharing one blob copies the text once, then drops the duplicates', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const storageId = await storeBlob(t)
    const first = await createDocument(t, ids, storageId, {
      extractedText: 'même fichier',
    })
    const second = await createDocument(t, ids, storageId, {
      extractedText: 'même fichier',
    })

    expect(await migrateAll(t, [first, second])).toEqual({
      copied: 1,
      dropped: 1,
      skipped: 0,
    })

    const texts = await t.run((ctx) => ctx.db.query('documentTexts').collect())
    expect(texts).toHaveLength(1)
  })

  test('an empty legacy text is dropped without creating a text row', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const documentId = await createDocument(t, ids, await storeBlob(t), {
      extractedText: '',
    })

    expect(await migrateAll(t, [documentId])).toEqual({
      copied: 0,
      dropped: 1,
      skipped: 0,
    })
    expect(
      await t.run((ctx) => ctx.db.query('documentTexts').collect()),
    ).toHaveLength(0)
  })

  test('a replayed batch finds nothing left to do', async () => {
    const t = setupHarness()
    const ids = await setup(t)
    const documentId = await createDocument(t, ids, await storeBlob(t), {
      extractedText: 'une fois',
    })

    await migrateAll(t, [documentId])
    expect(await migrateAll(t, [documentId])).toEqual({
      copied: 0,
      dropped: 0,
      skipped: 1,
    })
    expect(
      await t.run((ctx) => ctx.db.query('documentTexts').collect()),
    ).toHaveLength(1)
  })
})
