/// <reference types="vite/client" />
/**
 * Regression: the agent's write tools on debt, guarantees and real estate
 * (lot 7).
 *
 * The invariant that matters most here is not what the tools write — it is
 * that **every one of them asks first**. `needsApproval: true` stops the
 * generation and puts Confirm / Refuse in front of the user (SPEC D34, repo
 * rule). A write tool that lost the flag would change the books silently,
 * and nothing else in the stack would notice.
 *
 * The second invariant is tenancy: the streaming action carries no auth
 * identity, so each internal re-checks membership from the thread scope.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { debtTools } from './agentToolsDebt'
import { mcpTools } from './mcp/registry'
import {
  createOrg,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const iso = (y: number, m: number, d: number) =>
  new Date(utc(y, m, d)).toISOString().slice(0, 10)

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'debtwrite@test.dev')
  const org = await createOrg(t, 'org-debtwrite', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

const palatineArgs = {
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

/** Tools that write, and therefore must ask before they do. */
const WRITE_TOOLS = [
  'createLoan',
  'addLoanRate',
  'addLoanAmendment',
  'createGuarantee',
  'releaseGuarantee',
  'createProperty',
  'setPropertyCostSource',
  'addPropertyValuation',
] as const

/**
 * The AI SDK normalizes `needsApproval` to a PREDICATE, whether it was given
 * a boolean or nothing at all. So the flag cannot be read back as a boolean:
 * it has to be CALLED. Asserting on `=== true` silently passes on every tool
 * (a function is not `true`), which is exactly the kind of green test that
 * protects nothing.
 */
async function asksApproval(name: string): Promise<boolean> {
  const tool = (debtTools as Record<string, { needsApproval?: unknown }>)[name]
  expect(tool).toBeDefined()
  const predicate = tool.needsApproval
  expect(typeof predicate).toBe('function')
  return await (predicate as (a: unknown, b: unknown) => Promise<boolean>)(
    {},
    {},
  )
}

describe('every debt write tool asks before writing (D34)', () => {
  test.each(WRITE_TOOLS)('%s asks for approval', async (name) => {
    expect(await asksApproval(name)).toBe(true)
  })

  test('the read tools do NOT ask — they would only add friction', async () => {
    for (const name of [
      'listLoans',
      'getLoanSchedule',
      'listGuarantees',
      'getPledgesOnDeal',
      'listProperties',
    ]) {
      expect(await asksApproval(name)).toBe(false)
    }
  })

  test('no deletion tool exists on this domain', () => {
    // Deleting a loan, a guarantee or a property stays a UI gesture (repo
    // rule). A mainlevée is not a deletion — it keeps the row.
    const names = Object.keys(debtTools)
    expect(names.filter((n) => /^(delete|remove)/i.test(n))).toEqual([])
    expect(names).toContain('releaseGuarantee')
  })
})

describe('the MCP server marks the same writes as writes', () => {
  test.each(['createLoan', 'createProperty', 'addPropertyValuation'])(
    '%s is annotated readOnlyHint: false',
    (name) => {
      const tool = mcpTools.find((row) => row.name === name)
      expect(tool).toBeDefined()
      // `needsApproval` has no effect over MCP — there is no in-app UI to
      // show it. The annotation is what makes a client confirm.
      expect(tool?.annotations.readOnlyHint).toBe(false)
    },
  )

  test('the debt read tools stay annotated read-only', () => {
    for (const name of ['listLoans', 'listGuarantees', 'listProperties']) {
      const tool = mcpTools.find((row) => row.name === name)
      expect(tool).toBeDefined()
      expect(tool?.annotations.readOnlyHint).toBe(true)
    }
  })
})

describe('the writes themselves', () => {
  test('createLoan stores the TERMS, and the outstanding stays derived', async () => {
    const { t, user, org } = await orgSetup()
    const created = await t.mutation(
      internal.agentToolsDebt.createLoanInternal,
      { orgId: org.orgId, actorUserId: user.userId, ...palatineArgs },
    )

    const sheet = await user.as.query(api.loans.getById, {
      loanId: created._id,
    })
    expect(sheet.loan.principalCents).toBe(500_000_00)
    expect(sheet.schedule).toHaveLength(240)
    // Five years in, part of the capital is repaid — and no column holds it.
    expect(sheet.summary.outstandingCents).toBeLessThan(500_000_00)
  })

  test('a non-revolving loan without a duration is refused', async () => {
    const { t, user, org } = await orgSetup()
    const { durationMonths: _omitted, ...noDuration } = palatineArgs
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.createLoanInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        ...noDuration,
      }),
      'missing_duration',
    )
  })

  test('a rate step on a FIXED-rate loan is refused', async () => {
    const { t, user, org } = await orgSetup()
    const created = await t.mutation(
      internal.agentToolsDebt.createLoanInternal,
      { orgId: org.orgId, actorUserId: user.userId, ...palatineArgs },
    )
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.addLoanRateInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        loanId: created._id,
        fromDate: utc(2023, 7, 5),
        rateBps: 350,
        kind: 'actual',
      }),
      'rate_is_fixed',
    )
  })

  test('createGuarantee resolves the subject org FROM the asset', async () => {
    const { t, user, org } = await orgSetup()
    const loan = await t.mutation(internal.agentToolsDebt.createLoanInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      ...palatineArgs,
    })
    const propertyId = await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      name: '18 rue de la Chapelle',
      address: 'Paris 18e',
      propertyType: 'immeuble',
      usage: 'locatif_nu',
      costBasis: [],
    })
    const created = await t.mutation(
      internal.agentToolsDebt.createGuaranteeInternal,
      {
        orgId: org.orgId,
        actorUserId: user.userId,
        loanId: loan._id,
        form: 'ppd',
        subjectPropertyId: propertyId,
        pledgorOrgId: org.orgId,
        pledgedAmountCents: 538_000_00,
      },
    )

    const stored = await t.run(async (ctx) =>
      ctx.db.get('guarantees', created._id),
    )
    // The org of the asset is read from the asset, never taken as an
    // argument — otherwise a caller could claim to be a party it is not.
    expect(stored?.subjectKind).toBe('property')
    expect(stored?.subjectOrgId).toBe(org.orgId)
    expect(stored?.borrowerOrgId).toBe(org.orgId)
  })

  test('a guarantee with no subject at all is refused', async () => {
    const { t, user, org } = await orgSetup()
    const loan = await t.mutation(internal.agentToolsDebt.createLoanInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      ...palatineArgs,
    })
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.createGuaranteeInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        loanId: loan._id,
        form: 'caution',
      }),
      'missing_subject',
    )
  })

  test('releaseGuarantee is a mainlevée — the row STAYS', async () => {
    const { t, user, org } = await orgSetup()
    const loan = await t.mutation(internal.agentToolsDebt.createLoanInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      ...palatineArgs,
    })
    const guarantee = await t.mutation(
      internal.agentToolsDebt.createGuaranteeInternal,
      {
        orgId: org.orgId,
        actorUserId: user.userId,
        loanId: loan._id,
        form: 'caution',
        subjectLabel: 'Caution Saccef',
        pledgedAmountCents: 100_000_00,
      },
    )
    await t.mutation(internal.agentToolsDebt.releaseGuaranteeInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      guaranteeId: guarantee._id,
      releasedAt: utc(2026, 6, 1),
    })

    const rows = await user.as.query(api.guarantees.listByLoan, {
      loanId: loan._id,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].releasedAt).toBe(utc(2026, 6, 1))
    // Released: out of the pledged total, still on the page as history.
    expect(rows[0].assetSummary.releasedCount).toBe(1)
    expect(rows[0].assetSummary.pledgedTotalCents).toBe(0)
  })

  test('createProperty starts every cost line item as ENTERED', async () => {
    const { t, user, org } = await orgSetup()
    const created = await t.mutation(
      internal.agentToolsDebt.createPropertyInternal,
      {
        orgId: org.orgId,
        actorUserId: user.userId,
        name: '18 rue de la Chapelle',
        address: 'Paris 18e',
        propertyType: 'immeuble',
        usage: 'locatif_nu',
        acquisitionCents: 658_800_00,
        acquisitionFeesCents: 18_300_00,
      },
    )

    const sheet = await user.as.query(api.properties.getById, {
      propertyId: created._id,
    })
    // Nothing is matched to a brand-new property: `flows` would read zero.
    expect(sheet.costBasis.every((poste) => poste.source === 'manual')).toBe(
      true,
    )
    expect(sheet.costBasisCents).toBe(677_100_00)
  })

  test('setPropertyCostSource keeps the entered amount when switching', async () => {
    const { t, user, org } = await orgSetup()
    const created = await t.mutation(
      internal.agentToolsDebt.createPropertyInternal,
      {
        orgId: org.orgId,
        actorUserId: user.userId,
        name: 'Bien',
        address: 'Paris',
        propertyType: 'appartement',
        usage: 'locatif_nu',
        acquisitionCents: 100_000_00,
      },
    )
    await t.mutation(internal.agentToolsDebt.setPropertyCostSourceInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      propertyId: created._id,
      poste: 'acquisition',
      source: 'flows',
    })
    await t.mutation(internal.agentToolsDebt.setPropertyCostSourceInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      propertyId: created._id,
      poste: 'acquisition',
      source: 'manual',
    })

    const sheet = await user.as.query(api.properties.getById, {
      propertyId: created._id,
    })
    expect(
      sheet.costBasis.find((p) => p.poste === 'acquisition')?.amountCents,
    ).toBe(100_000_00)
  })

  test('addPropertyValuation replaces at the same date', async () => {
    const { t, user, org } = await orgSetup()
    const created = await t.mutation(
      internal.agentToolsDebt.createPropertyInternal,
      {
        orgId: org.orgId,
        actorUserId: user.userId,
        name: 'Bien',
        address: 'Paris',
        propertyType: 'appartement',
        usage: 'locatif_nu',
      },
    )
    for (const valueCents of [800_000_00, 860_000_00]) {
      await t.mutation(internal.agentToolsDebt.addPropertyValuationInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        propertyId: created._id,
        asOf: utc(2026, 3, 1),
        valueCents,
      })
    }

    const sheet = await user.as.query(api.properties.getById, {
      propertyId: created._id,
    })
    expect(sheet.valuations).toHaveLength(1)
    expect(sheet.valuations[0].valueCents).toBe(860_000_00)
  })
})

describe('tenancy: the scope is re-checked on every write', () => {
  test('a non-member cannot write through the internals', async () => {
    const { t, org } = await orgSetup()
    const outsider = await createUser(t, 'outsider-debt@test.dev')
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.createLoanInternal, {
        orgId: org.orgId,
        actorUserId: outsider.userId,
        ...palatineArgs,
      }),
      'agent_tools_forbidden',
    )
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.createPropertyInternal, {
        orgId: org.orgId,
        actorUserId: outsider.userId,
        name: 'Bien',
        address: 'Paris',
        propertyType: 'appartement',
        usage: 'locatif_nu',
      }),
      'agent_tools_forbidden',
    )
  })

  test("a loan of another org is invisible to this thread's scope", async () => {
    const { t, user, org } = await orgSetup()
    const other = await createOrg(t, 'org-other-debtwrite', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreign = await t.mutation(
      internal.agentToolsDebt.createLoanInternal,
      { orgId: other.orgId, actorUserId: user.userId, ...palatineArgs },
    )
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.addLoanRateInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        loanId: foreign._id,
        fromDate: utc(2023, 7, 5),
        rateBps: 350,
        kind: 'actual',
      }),
      'not_found',
    )
  })

  test('a guarantee this org is no party to cannot be released', async () => {
    const { t, user, org } = await orgSetup()
    const other = await createOrg(t, 'org-third-debtwrite', [
      { userId: user.userId, role: 'owner' },
    ])
    const foreignLoan = await t.mutation(
      internal.agentToolsDebt.createLoanInternal,
      { orgId: other.orgId, actorUserId: user.userId, ...palatineArgs },
    )
    const guarantee = await t.mutation(
      internal.agentToolsDebt.createGuaranteeInternal,
      {
        orgId: other.orgId,
        actorUserId: user.userId,
        loanId: foreignLoan._id,
        form: 'caution',
        subjectLabel: 'Caution externe',
      },
    )
    await expectConvexError(
      t.mutation(internal.agentToolsDebt.releaseGuaranteeInternal, {
        orgId: org.orgId,
        actorUserId: user.userId,
        guaranteeId: guarantee._id,
        releasedAt: utc(2026, 6, 1),
      }),
      'not_a_party',
    )
  })
})

describe('the agent knows what « this loan » and « this bien » mean', () => {
  test('the loan and property sheets can carry an entity context', async () => {
    // A closed union here is what would silently drop the context on the two
    // new sheets — the failure mode is an agent that answers about the wrong
    // thing, so the contract is pinned rather than assumed.
    const { buildInstructions } = await import('./lib/instructions')
    const loan = buildInstructions({
      route: '/app/x/passif/prets/y',
      entity: { kind: 'loan', id: 'y' },
    })
    expect(loan).toContain('getLoanSchedule')
    const property = buildInstructions({
      route: '/app/x/immobilier/z',
      entity: { kind: 'property', id: 'z' },
    })
    expect(property).toContain('listProperties')
  })
})

/** Dates round-trip through the ISO form the tools expose. */
test('ISO dates map to midnight UTC', () => {
  expect(Date.parse(`${iso(2021, 7, 5)}T00:00:00.000Z`)).toBe(utc(2021, 7, 5))
})
