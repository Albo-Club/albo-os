/// <reference types="vite/client" />
/**
 * Regression: a document without a company (`documents.companyId` optional).
 *
 * Convex accepts widening a field (required → optional) and refuses narrowing
 * it, so this change deploys without a murmur — which is exactly what makes
 * it dangerous: every read that assumed `companyId` was present kept
 * compiling and would break at runtime on the first unfiled row
 * (KNOWN_ISSUES.md « Un document ne peut se rattacher qu'à une société »).
 *
 * These tests pin the four things that must survive an unfiled document:
 * company sheets, the org-wide reads, the duplicate detector, and the
 * tenancy of the creation path — whose org is now resolved from the anchor
 * rather than from the company.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { groupDuplicateDocuments } from './lib/duplicates'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
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
  const user = await createUser(t, 'docs@test.dev')
  const org = await createOrg(t, 'org-docs', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Portfolio Co')
  const loanId = await user.as.mutation(api.loans.create, {
    orgId: org.orgId,
    ...palatine,
  })
  return { t, user, org, companyId, loanId }
}

/** Uploads a blob and returns its storage id. */
async function blob(t: Awaited<ReturnType<typeof setup>>['t'], text: string) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob([text])))
}

describe('documents: a row can hang off a loan instead of a company', () => {
  test('creating a loan deed needs no company at all', async () => {
    const { t, user, loanId, org } = await setup()
    const storageId = await blob(t, 'offre de prêt')
    const documentId = await user.as.mutation(api.documents.create, {
      loanId,
      title: 'Offre de prêt.pdf',
      kind: 'acte_pret',
      storageId,
    })
    const stored = await t.run(async (ctx) =>
      ctx.db.get('documents', documentId),
    )
    expect(stored?.companyId).toBeUndefined()
    // The org is resolved from the anchor, never from an argument.
    expect(stored?.orgId).toBe(org.orgId)
    expect(stored?.loanId).toBe(loanId)
  })

  test('the loan sheet lists it, the company sheet does not', async () => {
    const { t, user, loanId, companyId } = await setup()
    await user.as.mutation(api.documents.create, {
      loanId,
      title: "Tableau d'amortissement.pdf",
      kind: 'acte_pret',
      storageId: await blob(t, 'tableau'),
    })
    await user.as.mutation(api.documents.create, {
      companyId,
      title: 'Reporting Q2.pdf',
      kind: 'reporting',
      storageId: await blob(t, 'reporting'),
    })

    const onLoan = await user.as.query(api.documents.listByLoan, { loanId })
    expect(onLoan.map((doc) => doc.title)).toEqual([
      "Tableau d'amortissement.pdf",
    ])
    // `by_company` never matches a missing value — the unfiled row is
    // deliberately absent from the company timeline, not lost.
    const onCompany = await user.as.query(api.documents.listByCompany, {
      companyId,
    })
    expect(onCompany.map((doc) => doc.title)).toEqual(['Reporting Q2.pdf'])
  })

  test('a property and a guarantee are anchors too, with the SAME shape', async () => {
    // The three anchored lists feed one front component, so a field missing
    // from one of them is a field the component cannot use on any of them.
    const { t, user, org, loanId } = await setup()
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      name: '18 rue de la Chapelle',
      address: 'Paris 18e',
      propertyType: 'immeuble',
      usage: 'locatif_nu',
      costBasis: [],
    })
    const guaranteeId = await user.as.mutation(api.guarantees.create, {
      loanId,
      pledgorOrgId: org.orgId,
      subjectKind: 'property',
      subjectPropertyId: propertyId,
      form: 'ppd',
      pledgedAmountCents: 300_000_00,
    })

    await user.as.mutation(api.documents.create, {
      loanId,
      title: 'Offre de prêt.pdf',
      kind: 'acte_pret',
      storageId: await blob(t, 'offre'),
    })
    await user.as.mutation(api.documents.create, {
      propertyId,
      title: 'Acte de vente.pdf',
      kind: 'legal',
      period: utc(2019, 2, 9),
      storageId: await blob(t, 'vente'),
    })
    await user.as.mutation(api.documents.create, {
      guaranteeId,
      title: 'Acte de PPD.pdf',
      kind: 'acte_garantie',
      storageId: await blob(t, 'ppd'),
    })

    const onProperty = await user.as.query(api.documents.listByProperty, {
      propertyId,
    })
    const onGuarantee = await user.as.query(api.documents.listByGuarantee, {
      guaranteeId,
    })
    expect(onProperty.map((doc) => doc.title)).toEqual(['Acte de vente.pdf'])
    expect(onGuarantee.map((doc) => doc.title)).toEqual(['Acte de PPD.pdf'])
    // Same keys on all three: the shared section reads `period`, `size`,
    // `contentType` and the reading state, whatever the anchor.
    const onLoanKeys = Object.keys(
      (
        await user.as.query(api.documents.listByLoan, { loanId })
      )[0] ?? {},
    ).sort()
    expect(Object.keys(onProperty[0]).sort()).toEqual(onLoanKeys)
    expect(Object.keys(onGuarantee[0]).sort()).toEqual(onLoanKeys)
    expect(onProperty[0].period).toBe(utc(2019, 2, 9))
    // And neither carries a company, which is the whole point.
    const rows = await t.run(async (ctx) =>
      ctx.db.query('documents').collect(),
    )
    expect(rows.every((row) => row.companyId === undefined)).toBe(true)
  })

  test('a document with no anchor at all is refused', async () => {
    const { t, user } = await setup()
    await expectConvexError(
      user.as.mutation(api.documents.create, {
        title: 'Orphelin.pdf',
        kind: 'other',
        storageId: await blob(t, 'orphelin'),
      }),
      'missing_anchor',
    )
  })

  test('an unfiled document is still readable and deletable by id', async () => {
    const { t, user, loanId } = await setup()
    const documentId = await user.as.mutation(api.documents.create, {
      loanId,
      title: 'Acte.pdf',
      kind: 'acte_pret',
      storageId: await blob(t, 'acte'),
    })
    // Auth on these paths goes through `orgId`, never through the company.
    await user.as.mutation(api.documents.update, {
      documentId,
      title: 'Acte de prêt.pdf',
      kind: 'acte_pret',
    })
    expect(
      await user.as.query(api.documents.getExtractedText, { documentId }),
    ).toBeNull()
    await user.as.mutation(api.documents.remove, { documentId })
    const rows = await t.run(async (ctx) =>
      ctx.db.query('documents').collect(),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('documents: tenancy of the anchor-resolved org', () => {
  test('a non-member cannot file a document against another org’s loan', async () => {
    const { t, loanId } = await setup()
    const outsider = await createUser(t, 'outsider@test.dev')
    await createOrg(t, 'org-outsider', [
      { userId: outsider.userId, role: 'owner' },
    ])
    await expectConvexError(
      outsider.as.mutation(api.documents.create, {
        loanId,
        title: 'Intrus.pdf',
        kind: 'acte_pret',
        storageId: await blob(t, 'intrus'),
      }),
      'not_a_member',
    )
  })

  test('anchors from two different orgs are refused', async () => {
    const { t, user, loanId } = await setup()
    const otherOrg = await createOrg(t, 'org-other', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreignCompany = await createPortfolioCompany(
      t,
      otherOrg.orgId,
      'Ailleurs',
    )
    // The company wins the org resolution; the loan then fails the check.
    await expectConvexError(
      user.as.mutation(api.documents.create, {
        companyId: foreignCompany,
        loanId,
        title: 'Mélange.pdf',
        kind: 'acte_pret',
        storageId: await blob(t, 'melange'),
      }),
      'not_found',
    )
  })
})

describe('duplicates: unfiled documents never collapse into one bucket', () => {
  const doc = (companyId: Id<'companies'> | undefined, title: string) => ({
    companyId,
    title,
  })

  test('two same-named documents of DIFFERENT companies stay apart', () => {
    const a = 'company_a' as Id<'companies'>
    const b = 'company_b' as Id<'companies'>
    expect(
      groupDuplicateDocuments([doc(a, 'Pacte.pdf'), doc(b, 'Pacte.pdf')]),
    ).toEqual([])
  })

  test('two same-named UNFILED documents are reported as duplicates', () => {
    const groups = groupDuplicateDocuments([
      doc(undefined, 'Acte de prêt.pdf'),
      doc(undefined, 'acte de pret.pdf'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  test('an unfiled document is never a duplicate of a filed one', () => {
    const a = 'company_a' as Id<'companies'>
    expect(
      groupDuplicateDocuments([
        doc(a, 'Acte de prêt.pdf'),
        doc(undefined, 'Acte de prêt.pdf'),
      ]),
    ).toEqual([])
  })
})
