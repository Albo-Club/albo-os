/**
 * The two silent failures of ALB-127, pinned.
 *
 * Both were invisible rather than loud, which is what makes them regression
 * material: nothing threw, nothing turned red, the app looked healthy.
 *
 *  1. A document whose reading never came back stayed 'pending' forever. The
 *     Hectarea PV d'AG sat there for four months while every question about
 *     that AG was answered from a redacted extract — the wrong version
 *     silently holding authority.
 *  2. The import's duplicate detector shared its key with the import's
 *     idempotency guard, so it could only ever report duplicates the guard had
 *     already blocked. It reported nothing while four twins sat in the fiche.
 *
 * The sweep is asserted WITHOUT running the scheduled reading: convex-test
 * leaves scheduled jobs queued, and `documentsExtract.run` would reach for the
 * OCR provider. What is pinned here is the state machine — relaunch once, then
 * fail visibly — not the extraction itself.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { groupDuplicateDocuments } from './lib/duplicates'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'

import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

const HOUR = 60 * 60 * 1000

async function addDocument(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  opts: {
    title: string
    size?: number
    uploadedAt?: number
    ocrState?: 'pending' | 'extracted' | 'skipped' | 'failed'
    ocrDetail?: string
  },
): Promise<Id<'documents'>> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(['pdf'], { type: 'application/pdf' }),
    )
    return await ctx.db.insert('documents', {
      orgId,
      companyId,
      title: opts.title,
      kind: 'legal',
      storageId,
      contentType: 'application/pdf',
      size: opts.size ?? 1_000,
      source: 'upload',
      uploadedAt: opts.uploadedAt ?? Date.now(),
      ocrState: opts.ocrState,
      ocrDetail: opts.ocrDetail,
    })
  })
}

const readDocument = (t: Harness, documentId: Id<'documents'>) =>
  t.run(async (ctx) => ctx.db.get('documents', documentId))

async function setupCompany(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Hectarea')
  return { orgId: org.orgId, companyId }
}

describe('sweepStalePending', () => {
  test('relaunches an abandoned reading once, then fails it visibly', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setupCompany(t)
    const documentId = await addDocument(t, orgId, companyId, {
      title: 'PV dAG augmentation de capital',
      uploadedAt: Date.now() - 4 * HOUR,
      ocrState: 'pending',
    })

    const first = await t.mutation(
      internal.documentsExtract.sweepStalePending,
      {},
    )
    expect(first).toEqual({ relaunched: 1, abandoned: 0 })
    const afterFirst = await readDocument(t, documentId)
    // Still pending: the reading was re-scheduled, not resolved.
    expect(afterFirst?.ocrState).toBe('pending')
    expect(afterFirst?.ocrDetail).toBe('sweep_retry')

    // The relaunch died too — the row must stop being invisible.
    const second = await t.mutation(
      internal.documentsExtract.sweepStalePending,
      {},
    )
    expect(second).toEqual({ relaunched: 0, abandoned: 1 })
    const afterSecond = await readDocument(t, documentId)
    expect(afterSecond?.ocrState).toBe('failed')
    expect(afterSecond?.ocrDetail).toBe('stuck_pending')

    // And it stays put: no third verdict, no retry loop on a billed OCR call.
    expect(
      await t.mutation(internal.documentsExtract.sweepStalePending, {}),
    ).toEqual({ relaunched: 0, abandoned: 0 })
  })

  test('leaves a reading that is legitimately in flight alone', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setupCompany(t)
    const documentId = await addDocument(t, orgId, companyId, {
      title: 'Pacte Version Finale',
      uploadedAt: Date.now() - 5_000,
      ocrState: 'pending',
    })

    expect(
      await t.mutation(internal.documentsExtract.sweepStalePending, {}),
    ).toEqual({ relaunched: 0, abandoned: 0 })
    expect((await readDocument(t, documentId))?.ocrDetail).toBeUndefined()
  })

  test('never revisits a document that reached a verdict', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setupCompany(t)
    const old = Date.now() - 30 * 24 * HOUR
    const extracted = await addDocument(t, orgId, companyId, {
      title: 'Extrait PV dAG',
      uploadedAt: old,
      ocrState: 'extracted',
    })
    const failed = await addDocument(t, orgId, companyId, {
      title: 'Board deck',
      uploadedAt: old,
      ocrState: 'failed',
      ocrDetail: 'ocr_failed',
    })

    expect(
      await t.mutation(internal.documentsExtract.sweepStalePending, {}),
    ).toEqual({ relaunched: 0, abandoned: 0 })
    expect((await readDocument(t, extracted))?.ocrState).toBe('extracted')
    expect((await readDocument(t, failed))?.ocrDetail).toBe('ocr_failed')
  })
})

describe('groupDuplicateDocuments', () => {
  // Real ids from the Hectarea fiche — two companies, so a same-named
  // document on a different participation stays out of the group.
  const HECTAREA = 'jx79z9rcha003f9910kh88f64s87rs51' as Id<'companies'>
  const OTHER = 'jx75dbb7q4zp0p1234ayc6zy8187wq18' as Id<'companies'>
  const doc = (companyId: Id<'companies'>, title: string, size: number) => ({
    companyId,
    title,
    size,
  })

  test('catches the twins the idempotency guard is meant to let through', () => {
    // The real Hectarea pair: two naming conventions, 5 bytes of PDF metadata
    // apart. Neither half of the guard's key — title AND size — ever matched,
    // which is why the guard was right to deposit both and why a detector
    // sharing that key reported nothing.
    const underscore = doc(
      HECTAREA,
      '20260402_-_HECTAREA_-_Pacte_Version_Finale',
      1_781_079,
    )
    const spaced = doc(
      HECTAREA,
      '20260402 - HECTAREA - Pacte Version Finale',
      1_781_084,
    )

    const groups = groupDuplicateDocuments([underscore, spaced])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual([underscore, spaced])
  })

  test('catches the three other Hectarea pairs, and only those', () => {
    const groups = groupDuplicateDocuments([
      doc(HECTAREA, '20260402_-_HECTAREA_-_BS__(ALBO)', 625_597),
      doc(HECTAREA, '20260402 - HECTAREA - BS (ALBO)', 625_598),
      doc(HECTAREA, '20260402_-_HECTAREA_-_Plan_BSA', 181_729),
      doc(HECTAREA, '20260402 - HECTAREA - Plan BSA', 181_724),
      doc(HECTAREA, '20260402_-_HECTAREA_-_Ouverture_ABSA', 313_652),
      doc(HECTAREA, '20260402 - HECTAREA - Ouverture ABSA', 313_647),
      // Genuinely distinct neighbours from the same lot.
      doc(HECTAREA, '202606_BA283_rs', 156_698),
      doc(HECTAREA, '202606_BA283_rg', 8_273_779),
      doc(HECTAREA, '20260402_-_HECTAREA_-_Statuts_(Pre-Closing)_VF', 328_964),
      doc(HECTAREA, '20260430_-_HECTAREA_-_Statuts_(Post-Closing)_VF', 329_108),
    ])
    expect(groups).toHaveLength(3)
    expect(groups.map((group) => group.length)).toEqual([2, 2, 2])
  })

  test('keeps same-named documents of different companies apart', () => {
    expect(
      groupDuplicateDocuments([
        doc(HECTAREA, 'Pacte Version Finale', 1_000),
        doc(OTHER, 'Pacte_Version_Finale', 1_000),
      ]),
    ).toEqual([])
  })

  test('is not fooled by case or accents alone', () => {
    const groups = groupDuplicateDocuments([
      doc(HECTAREA, "Procès-Verbal d'AG", 1_000),
      doc(HECTAREA, 'proces verbal d ag', 1_000),
    ])
    expect(groups).toHaveLength(1)
  })
})
