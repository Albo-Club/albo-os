/// <reference types="vite/client" />
/**
 * Regression: capital events (`capitalEvents`, ALB-248 lot 1).
 *
 * - An operation is created and removed by an org member, never by an
 *   outsider; its values are validated (positive price, integer counts).
 * - A source document must be filed under the company (directly or through
 *   a deal targeting it); a document cited by an operation refuses deletion.
 * - A company holding operations refuses deletion.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function setup(slug = 'org-capital') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  const target = await createPortfolioCompany(t, org.orgId, 'ACT Running')
  return { t, user, org, target }
}

const december = {
  asOf: Date.UTC(2025, 11, 10),
  kind: 'round' as const,
  pricePerShare: 80_00,
  sharesIssued: 2_500,
  totalSharesAfter: 40_000,
}

describe('capitalEvents: create, list, remove', () => {
  test('a member records an operation and reads it back with its source', async () => {
    const { t, user, target } = await setup()
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'Rapport du Président 2025.12.10',
      kind: 'legal',
      storageId,
    })
    const eventId = await user.as.mutation(api.capitalEvents.create, {
      companyId: target,
      ...december,
      roundSize: 200_000_00,
      roundType: 'seed',
      documentId,
      notes: '  2 500 actions O à 80 €  ',
    })
    const rows = await user.as.query(api.capitalEvents.listByCompany, {
      companyId: target,
    })
    expect(rows).toEqual([
      {
        _id: eventId,
        asOf: december.asOf,
        kind: 'round',
        pricePerShare: 80_00,
        sharesIssued: 2_500,
        totalSharesAfter: 40_000,
        roundSize: 200_000_00,
        roundType: 'seed',
        notes: '2 500 actions O à 80 €',
        document: { _id: documentId, title: 'Rapport du Président 2025.12.10' },
      },
    ])

    await user.as.mutation(api.capitalEvents.remove, { eventId })
    expect(
      await user.as.query(api.capitalEvents.listByCompany, {
        companyId: target,
      }),
    ).toEqual([])
  })

  test('the values are validated before anything is written', async () => {
    const { user, target } = await setup('org-capital-validate')
    await expectConvexError(
      user.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
        pricePerShare: 0,
      }),
      'invalid_price',
    )
    await expectConvexError(
      user.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
        totalSharesAfter: 40_000.5,
      }),
      'invalid_shares',
    )
    await expectConvexError(
      user.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
        sharesIssued: -1,
      }),
      'invalid_shares',
    )
    await expectConvexError(
      user.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
        roundSize: -5,
      }),
      'invalid_amount',
    )
    expect(
      await user.as.query(api.capitalEvents.listByCompany, {
        companyId: target,
      }),
    ).toEqual([])
  })

  test('an outsider can neither read, write nor remove', async () => {
    const { t, user, target } = await setup('org-capital-tenant')
    const eventId = await user.as.mutation(api.capitalEvents.create, {
      companyId: target,
      ...december,
    })
    const stranger = await createUser(t, 'stranger@test.dev')
    await createOrg(t, 'other-org', [
      { userId: stranger.userId, role: 'owner' },
    ])
    await expectConvexError(
      stranger.as.query(api.capitalEvents.listByCompany, { companyId: target }),
      'not_a_member',
    )
    await expectConvexError(
      stranger.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
      }),
      'not_a_member',
    )
    await expectConvexError(
      stranger.as.mutation(api.capitalEvents.remove, { eventId }),
      'not_a_member',
    )
  })
})

describe('capitalEvents: the source document and the company are held', () => {
  test('a document of another company is refused as source', async () => {
    const { t, user, org, target } = await setup('org-capital-doc')
    const other = await createPortfolioCompany(t, org.orgId, 'Other')
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      companyId: other,
      title: 'Pacte Other',
      kind: 'pacte',
      storageId,
    })
    await expectConvexError(
      user.as.mutation(api.capitalEvents.create, {
        companyId: target,
        ...december,
        documentId,
      }),
      'document_not_found',
    )
  })

  test('a document cited by an operation refuses deletion until the operation goes', async () => {
    const { t, user, target } = await setup('org-capital-guard')
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'PV décembre',
      kind: 'legal',
      storageId,
    })
    const eventId = await user.as.mutation(api.capitalEvents.create, {
      companyId: target,
      ...december,
      documentId,
    })
    await expectConvexError(
      user.as.mutation(api.documents.remove, { documentId }),
      'document_cited_by_capital_event',
    )
    // The company holding the operation is held too.
    await expectConvexError(
      user.as.mutation(api.companies.remove, { id: target }),
      'company_has_references',
    )
    await user.as.mutation(api.capitalEvents.remove, { eventId })
    await user.as.mutation(api.documents.remove, { documentId })
    await user.as.mutation(api.companies.remove, { id: target })
  })
})
