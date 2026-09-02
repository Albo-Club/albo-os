/// <reference types="vite/client" />
/**
 * Regression: the automatic classification of an uploaded document (ALB-239).
 *
 * The add form no longer asks for a type, so the type now comes from a model
 * reading the file. What must never break is the ARBITRATION around that
 * reading, which is code's job and is what these tests pin:
 *   - a kind is only accepted from the vocabulary of the document's anchor;
 *   - `reporting` is refused everywhere — it is an aiguillage into the report
 *     pipeline, and a document filed under it was never analysed;
 *   - a kind a human already chose is never overwritten.
 *
 * The model call itself is out of scope here: it is the one part that has no
 * deterministic answer.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { parsePeriod } from './documentsClassify'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'

import type { Id } from './_generated/dataModel'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

const palatine = {
  label: 'Prêt Palatine 2021',
  lenderName: 'Banque Palatine',
  principalCents: 500_000_00,
  signedDate: utc(2021, 6, 14),
  firstPaymentDate: utc(2021, 7, 5),
  durationMonths: 240,
  amortizationKind: 'constant_annuity' as const,
  rateBps: 185,
  rateKind: 'fixed' as const,
  paymentFrequency: 'monthly' as const,
}

async function setup() {
  const t = setupHarness()
  const user = await createUser(t, 'classify@test.dev')
  const org = await createOrg(t, 'org-classify', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Portfolio Co')
  const loanId = await user.as.mutation(api.loans.create, {
    orgId: org.orgId,
    ...palatine,
  })
  return { t, user, org, companyId, loanId }
}

type Harness = Awaited<ReturnType<typeof setup>>['t']

/** A freshly dropped document: file name as title, `other` as kind — exactly
 * what `AddFilesDialog` sends. */
async function drop(
  { t, user }: { t: Harness; user: Awaited<ReturnType<typeof setup>>['user'] },
  anchor: { companyId: Id<'companies'> } | { loanId: Id<'loans'> },
  title: string,
) {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob([title])),
  )
  return await user.as.mutation(api.documents.create, {
    ...anchor,
    title,
    kind: 'other',
    storageId,
  })
}

function read(t: Harness, documentId: Id<'documents'>) {
  return t.run(async (ctx) => ctx.db.get('documents', documentId))
}

describe('documentsClassify: what the model says is arbitrated by code', () => {
  test('a kind of the anchor vocabulary is applied, with the period', async () => {
    const { t, user, companyId } = await setup()
    const documentId = await drop({ t, user }, { companyId }, 'pacte-2024.pdf')

    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'pacte',
      period: utc(2024, 3, 12),
    })

    const stored = await read(t, documentId)
    expect(stored?.kind).toBe('pacte')
    expect(stored?.period).toBe(utc(2024, 3, 12))
    // The title is the uploader's file name and stays theirs.
    expect(stored?.title).toBe('pacte-2024.pdf')
  })

  test('`reporting` never lands: it is a pipeline, not a label', async () => {
    const { t, user, companyId } = await setup()
    const documentId = await drop({ t, user }, { companyId }, 'update-q1.pdf')

    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'reporting',
      period: undefined,
    })

    expect((await read(t, documentId))?.kind).toBe('other')
  })

  test('a company kind is refused on a loan deed', async () => {
    const { t, user, loanId } = await setup()
    const documentId = await drop({ t, user }, { loanId }, 'offre.pdf')

    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'pacte',
      period: undefined,
    })
    expect((await read(t, documentId))?.kind).toBe('other')

    // …and its own vocabulary is accepted.
    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'acte_pret',
      period: undefined,
    })
    expect((await read(t, documentId))?.kind).toBe('acte_pret')
  })

  test('a kind chosen by a human is never overwritten', async () => {
    const { t, user, companyId } = await setup()
    const documentId = await drop({ t, user }, { companyId }, 'statuts.pdf')

    // The classification runs while the document is already editable: the
    // user got there first.
    await user.as.mutation(api.documents.update, {
      documentId,
      title: 'Statuts',
      kind: 'legal',
    })
    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'pacte',
      period: utc(2024, 1, 1),
    })

    const stored = await read(t, documentId)
    expect(stored?.kind).toBe('legal')
    expect(stored?.period).toBeUndefined()
  })

  test('a document with no text is not even a target', async () => {
    const { t, user, companyId } = await setup()
    const documentId = await drop({ t, user }, { companyId }, 'scan.png')
    // Nothing was extracted (`documentTexts` empty) — a classification run
    // over an unread file would be a guess on the file name alone.
    expect(
      await t.query(internal.documentsClassify.getTarget, { documentId }),
    ).toBeNull()
  })
})

describe('parsePeriod: a date the document does not carry is never invented', () => {
  test('a month lands on its first day, UTC', () => {
    expect(parsePeriod('2024-03')).toBe(utc(2024, 3, 1))
    expect(parsePeriod('2024-03-12')).toBe(utc(2024, 3, 12))
  })

  test('anything else is dropped rather than approximated', () => {
    expect(parsePeriod(null)).toBeUndefined()
    expect(parsePeriod('mars 2024')).toBeUndefined()
    expect(parsePeriod('2024')).toBeUndefined()
    expect(parsePeriod('2024-13')).toBeUndefined()
    expect(parsePeriod('2024-03-00')).toBeUndefined()
  })
})
