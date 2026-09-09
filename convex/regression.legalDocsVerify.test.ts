/// <reference types="vite/client" />
/**
 * Regression: the duplicate audit of the legal-docs import reads the text of
 * REAL documents only (convex/migrations/legalDocsImport.ts `duplicateExcerpt`).
 *
 * `verify` reports same-company/same-title collisions so a human can arbitrate
 * them, and the excerpt is what makes that possible: two files of different
 * sizes under one name are a signed and an unsigned copy, or two months of the
 * same invoice, and only the text says which.
 *
 * The images exclusion is not cosmetic, it IS the read budget. Inline email
 * pictures — logos, Outlook signatures, charts pasted in a body — are four
 * fifths of the collisions on the CALTE org and carry nothing to arbitrate.
 * Convex hands back whole rows, so reading their `documentTexts` would turn a
 * bounded audit into a walk over the corpus, the exact fault `vectorize`'s
 * backfill was cured of. Drop the filter and this test goes red.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

/** Mirrors EXCERPT_CHARS in convex/migrations/legalDocsImport.ts. */
const EXCERPT_CHARS = 200

async function setup(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'calte', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Tiny Home')
  return { orgId: org.orgId, companyId }
}

/** A document plus the text the reading produced for its blob. */
async function addDocument(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  opts: { title: string; contentType: string; size: number; text?: string },
): Promise<Id<'documents'>> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(['blob'], { type: opts.contentType }),
    )
    if (opts.text !== undefined) {
      await ctx.db.insert('documentTexts', {
        storageId,
        text: opts.text,
        truncated: false,
      })
    }
    return await ctx.db.insert('documents', {
      orgId,
      companyId,
      title: opts.title,
      kind: 'legal',
      storageId,
      contentType: opts.contentType,
      size: opts.size,
      source: 'upload',
      uploadedAt: Date.now(),
      ocrState: 'extracted',
    })
  })
}

function verify(t: Harness) {
  return t.query(internal.migrations.legalDocsImport.verify, {
    orgSlug: 'calte',
  })
}

describe('legalDocsImport.verify — duplicate excerpts', () => {
  test('two same-named documents come back with the text that tells them apart', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    await addDocument(t, orgId, companyId, {
      title: 'Tiny home invoice 2022',
      contentType: 'application/pdf',
      size: 18_901,
      text: 'Facture 2022 — exemplaire signé le 14 mars 2023',
    })
    await addDocument(t, orgId, companyId, {
      title: 'Tiny home invoice 2022',
      contentType: 'application/pdf',
      size: 161_185,
      text: 'Facture 2022 — projet non signé',
    })

    const { duplicates } = await verify(t)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].rows.map((r) => r.excerpt)).toEqual(
      expect.arrayContaining([
        'Facture 2022 — exemplaire signé le 14 mars 2023',
        'Facture 2022 — projet non signé',
      ]),
    )
  })

  test('an image collision is reported but its text is never read', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    // Both carry a text row: only the images filter can keep it out.
    for (const size of [19_940, 20_353]) {
      await addDocument(t, orgId, companyId, {
        title: 'Outlook-signature_.png',
        contentType: 'image/png',
        size,
        text: 'du texte qui ne sert à rien',
      })
    }

    const { duplicates } = await verify(t)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].rows.map((r) => r.excerpt)).toEqual([null, null])
  })

  test('the excerpt is flattened and capped', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    // A PDF's text arrives with the newlines of its layout; unflattened, the
    // useful words would sit past the cap.
    const text = `${'ligne\n'.repeat(50)}FIN`
    for (const size of [1_000, 2_000]) {
      await addDocument(t, orgId, companyId, {
        title: 'BS Lyon Vaise',
        contentType: 'application/pdf',
        size,
        text,
      })
    }

    const { duplicates } = await verify(t)
    const excerpt = duplicates[0].rows[0].excerpt
    expect(excerpt).not.toBeNull()
    expect(excerpt!.length).toBe(EXCERPT_CHARS)
    expect(excerpt).not.toContain('\n')
    expect(excerpt!.startsWith('ligne ligne ')).toBe(true)
  })

  test('a document with no reading yet reports no excerpt', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    for (const size of [1_000, 2_000]) {
      await addDocument(t, orgId, companyId, {
        title: 'BS Bellevilles',
        contentType: 'application/pdf',
        size,
      })
    }

    const { duplicates } = await verify(t)
    expect(duplicates[0].rows.map((r) => r.excerpt)).toEqual([null, null])
  })
})
