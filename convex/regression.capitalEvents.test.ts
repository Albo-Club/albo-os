/// <reference types="vite/client" />
/**
 * Regression: capital events (`capitalEvents`, ALB-248 lot 1).
 *
 * - An operation is created and removed by an org member, never by an
 *   outsider; its values are validated (positive price, integer counts).
 * - A source document must be filed under the company (directly or through
 *   a deal targeting it); a document cited by an operation refuses deletion.
 * - A company holding operations refuses deletion.
 * - Lot 2: a proposal read from a legal document is listed as such, silent
 *   in the journal until confirmed, hidden and remembered when refused;
 *   the extractor reads a legal document of a share participation once,
 *   never a BP nor a company without a share deal; the classification and a
 *   human re-filing both schedule the read; both AI facades carry the same
 *   read and the same write, the writes asking first.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { capitalTools } from './agentToolsCapital'
import { mcpTools } from './mcp/registry'
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
        status: null,
        evidence: null,
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

// ─── Lot 2: proposals read from a legal document ──────────────────────────

const DEC_2025 = Date.UTC(2025, 11, 10)

async function setupWithShareDeal(slug: string) {
  const base = await setup(slug)
  const dealId = await base.user.as.mutation(api.deals.create, {
    orgId: base.org.orgId,
    investorCompanyId: base.org.rootCompanyId,
    targetCompanyId: base.target,
    instrumentKind: 'share',
    committedAmount: 25_040_00,
  })
  await base.user.as.mutation(api.deals.update, {
    id: dealId,
    patch: {
      sharesAcquired: 313,
      pricePerShare: 80_00,
      postMoneyValuation: 3_000_000_00,
      closingDate: Date.UTC(2025, 8, 5),
    },
  })
  return { ...base, dealId }
}

async function dropLegalDoc(
  base: Awaited<ReturnType<typeof setup>>,
  title: string,
  text: string,
) {
  const storageId = await base.t.run(async (ctx) =>
    ctx.storage.store(new Blob([text], { type: 'application/pdf' })),
  )
  const documentId = await base.user.as.mutation(api.documents.create, {
    companyId: base.target,
    title,
    kind: 'legal',
    storageId,
  })
  await base.t.run(async (ctx) => {
    await ctx.db.insert('documentTexts', { storageId, text, truncated: false })
  })
  return documentId
}

const proposal = {
  asOf: DEC_2025,
  kind: 'round' as const,
  pricePerShare: 80_00,
  sharesIssued: 2_500,
  totalSharesAfter: 40_000,
  evidence: 'DU 10 DECEMBRE 2025 — 80 euros — 40.000',
}

describe('capitalEvents: proposals confirmed or refused on the sheet', () => {
  test('a proposal is listed as such, confirmed under the user, then counts', async () => {
    const base = await setupWithShareDeal('org-capital-proposal')
    const { t, user, target } = base
    const documentId = await dropLegalDoc(base, 'Rapport President', 'x')

    const { inserted } = await t.mutation(
      internal.capitalEventsExtract.applyProposals,
      { documentId, proposals: [proposal] },
    )
    expect(inserted).toBe(1)

    const listed = await user.as.query(api.capitalEvents.listByCompany, {
      companyId: target,
    })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      status: 'proposed',
      evidence: proposal.evidence,
      document: { title: 'Rapport President' },
    })
    // Not a gesture yet: the journal is silent.
    const before = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.event.kind === 'capital_event_added')
    expect(before).toHaveLength(0)

    await user.as.mutation(api.capitalEvents.confirm, {
      eventId: listed[0]._id,
    })
    const after = await user.as.query(api.capitalEvents.listByCompany, {
      companyId: target,
    })
    expect(after[0].status).toBeNull()
    const journal = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.event.kind === 'capital_event_added')
    expect(journal).toHaveLength(1)
    expect(journal[0].actor.kind).toBe('user')

    // Confirming twice is refused.
    await expectConvexError(
      user.as.mutation(api.capitalEvents.confirm, { eventId: listed[0]._id }),
      'not_proposed',
    )
  })

  test('a refused proposal disappears from the sheet and is never re-proposed', async () => {
    const base = await setupWithShareDeal('org-capital-refuse')
    const { t, user, target } = base
    const documentId = await dropLegalDoc(base, 'Rapport President', 'x')
    await t.mutation(internal.capitalEventsExtract.applyProposals, {
      documentId,
      proposals: [proposal],
    })
    const [row] = await user.as.query(api.capitalEvents.listByCompany, {
      companyId: target,
    })
    await user.as.mutation(api.capitalEvents.reject, { eventId: row._id })
    expect(
      await user.as.query(api.capitalEvents.listByCompany, {
        companyId: target,
      }),
    ).toEqual([])

    // The same round from another document (three days apart): known.
    const other = await dropLegalDoc(base, 'PV constatation', 'y')
    const again = await t.mutation(
      internal.capitalEventsExtract.applyProposals,
      {
        documentId: other,
        proposals: [{ ...proposal, asOf: DEC_2025 + 3 * 86_400_000 }],
      },
    )
    expect(again.inserted).toBe(0)
    // Removing the refused row is still possible and stays out of the journal.
    await user.as.mutation(api.capitalEvents.remove, { eventId: row._id })
  })
})

describe('capitalEventsExtract: which documents are read', () => {
  test('the target carries our entry as a known point and skips a cited document', async () => {
    const base = await setupWithShareDeal('org-capital-target')
    const { t } = base
    const documentId = await dropLegalDoc(base, 'Rapport', 'texte du rapport')
    const target = await t.query(internal.capitalEventsExtract.getTarget, {
      documentId,
    })
    expect(target).toMatchObject({
      companyId: base.target,
      title: 'Rapport',
      text: 'texte du rapport',
      entryPoints: [{ asOf: Date.UTC(2025, 8, 5), pricePerShareCents: 80_00 }],
      existingPoints: [],
    })

    await t.mutation(internal.capitalEventsExtract.applyProposals, {
      documentId,
      proposals: [proposal],
    })
    // Already read once: the rows are the memory.
    expect(
      await t.query(internal.capitalEventsExtract.getTarget, { documentId }),
    ).toBeNull()
  })

  test('a company without a share deal, or a non-legal document, is not read', async () => {
    const base = await setup('org-capital-noshare')
    const documentId = await dropLegalDoc(base, 'Pacte', 'texte')
    expect(
      await base.t.query(internal.capitalEventsExtract.getTarget, {
        documentId,
      }),
    ).toBeNull()

    const withDeal = await setupWithShareDeal('org-capital-bp')
    const storageId = await withDeal.t.run(async (ctx) =>
      ctx.storage.store(new Blob(['bp'], { type: 'application/pdf' })),
    )
    const bp = await withDeal.user.as.mutation(api.documents.create, {
      companyId: withDeal.target,
      title: 'BP 2026',
      kind: 'bp',
      storageId,
    })
    expect(
      await withDeal.t.query(internal.capitalEventsExtract.getTarget, {
        documentId: bp,
      }),
    ).toBeNull()
  })

  test('the automatic classification and a human re-filing both schedule the read', async () => {
    const base = await setupWithShareDeal('org-capital-trigger')
    const { t, user, target } = base
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['pv'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'pv-decembre.pdf',
      kind: 'other',
      storageId,
    })
    const scheduledRuns = async () =>
      (
        await t.run(async (ctx) =>
          ctx.db.system.query('_scheduled_functions').collect(),
        )
      ).filter((row) => row.name === 'capitalEventsExtract:run').length

    const before = await scheduledRuns()
    await t.mutation(internal.documentsClassify.apply, {
      documentId,
      kind: 'legal',
      period: undefined,
    })
    expect(await scheduledRuns()).toBe(before + 1)

    // A human moving another document to `pacte` is the same signal;
    // saving it unchanged is not.
    const otherStorage = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['pacte'], { type: 'application/pdf' })),
    )
    const other = await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'pacte.pdf',
      kind: 'other',
      storageId: otherStorage,
    })
    await user.as.mutation(api.documents.update, {
      documentId: other,
      title: 'pacte.pdf',
      kind: 'pacte',
    })
    expect(await scheduledRuns()).toBe(before + 2)
    await user.as.mutation(api.documents.update, {
      documentId: other,
      title: 'pacte.pdf',
      kind: 'pacte',
    })
    expect(await scheduledRuns()).toBe(before + 2)
  })
})

describe('capital operations on both AI facades', () => {
  async function asksApproval(name: string): Promise<boolean> {
    const tool = (capitalTools as Record<string, { needsApproval?: unknown }>)[
      name
    ]
    expect(tool).toBeDefined()
    const predicate = tool.needsApproval
    expect(typeof predicate).toBe('function')
    return await (predicate as (a: unknown, b: unknown) => Promise<boolean>)(
      {},
      {},
    )
  }

  test('the agent writes ask first, the read does not', async () => {
    expect(await asksApproval('addCapitalEvent')).toBe(true)
    expect(await asksApproval('confirmCapitalEvent')).toBe(true)
    expect(await asksApproval('listCapitalEvents')).toBe(false)
    expect(
      Object.keys(capitalTools).filter((n) =>
        /^(delete|remove|reject)/i.test(n),
      ),
    ).toEqual([])
  })

  test('the MCP server exposes the same read and marks the write as a write', () => {
    const list = mcpTools.find((row) => row.name === 'listCapitalEvents')
    const add = mcpTools.find((row) => row.name === 'addCapitalEvent')
    expect(list?.annotations.readOnlyHint).toBe(true)
    expect(add?.annotations.readOnlyHint).toBe(false)
  })

  test('the internals re-check the membership and journal as viaAgent', async () => {
    const base = await setupWithShareDeal('org-capital-agent')
    const { t, user, org, target } = base
    const created = await t.mutation(internal.capitalEvents.createInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      companyId: target,
      asOf: proposal.asOf,
      kind: proposal.kind,
      pricePerShare: proposal.pricePerShare,
      sharesIssued: proposal.sharesIssued,
      totalSharesAfter: proposal.totalSharesAfter,
    })
    expect(created._id).toBeDefined()
    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.event.kind === 'capital_event_added')
    expect(rows[0].actor).toMatchObject({ kind: 'user', viaAgent: true })

    const stranger = await createUser(t, 'stranger-agent@test.dev')
    await expectConvexError(
      t.query(internal.capitalEvents.listInternal, {
        orgId: org.orgId,
        actorUserId: stranger.userId,
        companyId: target,
      }),
      'agent_tools_forbidden',
    )
  })
})
