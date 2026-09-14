/// <reference types="vite/client" />
/**
 * Regression: statement import — convex/statements.ts + convex/lib/statements.ts.
 *
 * The figures below are the real CALTE statement of 13/08/2026 (Natixis
 * Wealth Management), because the traps this module has to survive are all in
 * it: a structured product quoted in PERCENT next to a fund quoted in euros,
 * a cash sleeve that only the account total accounts for, and three accounts
 * whose lines must add up to the cent.
 *
 * Four invariants are pinned here.
 *
 * 1. Units. Euros in, cents and basis points out — a percentage quote never
 *    becomes a euro amount, and vice versa.
 * 2. The coherence check is what makes the verification screen worth having:
 *    when the lines disagree with the total the statement prints, the account
 *    says so instead of being written silently.
 * 3. Re-importing the same statement DATE corrects that import — one import
 *    row, one valuation point. A different date adds a point and touches no
 *    earlier one; that is what builds the balance history.
 * 4. Tenancy: membership is checked, and an account's owner is a group entity.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { normalizeStatement, parseStatementDate } from './lib/statements'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { RawStatement } from './lib/statements'
import type { Id } from './_generated/dataModel'

const AUG = Date.UTC(2026, 7, 13)
const NOV = Date.UTC(2026, 10, 13)

/** The statement of 13/08/2026, in the units the model answers in. */
const natixisStatement: RawStatement = {
  statementDate: '2026-08-13',
  bankName: 'Natixis Wealth Management',
  accounts: [
    {
      accountNumber: '68425000001',
      label: 'CALTE',
      nature: 'Compte courant',
      totalValuation: 0,
      positions: [],
    },
    {
      accountNumber: '68425000003',
      label: 'CALTE CTO NANTI',
      nature: 'Compte titres',
      totalValuation: 2998960.27,
      positions: [
        {
          label: 'PM WO CAC SX5E 08 2026',
          isin: 'XS3449234346',
          category: 'Produits structurés',
          quantity: 500000,
          unitValue: null,
          unitValuePercent: 99.13,
          avgPrice: 100,
          valuation: 495650,
          unrealizedGain: -4350,
          isCash: false,
        },
        {
          label: 'OSTRUM SRI CASH PLUS I (C) EUR',
          isin: 'FR0010831693',
          category: 'Produits Monétaires Zone Euro',
          quantity: 22.2449,
          unitValue: 112533.89,
          unitValuePercent: null,
          avgPrice: 112405.28,
          valuation: 2503305.13,
          unrealizedGain: 2860.92,
          isCash: false,
        },
        {
          label: 'Liquidités',
          isin: null,
          category: null,
          quantity: null,
          unitValue: null,
          unitValuePercent: null,
          avgPrice: null,
          valuation: 5.14,
          unrealizedGain: null,
          isCash: true,
        },
      ],
    },
    {
      accountNumber: '68425000002',
      label: 'CALTE CTO NANTI FRTS ET PDTS',
      nature: 'Compte titres',
      totalValuation: 3557,
      positions: [
        {
          label: 'Liquidités',
          isin: null,
          category: null,
          quantity: null,
          unitValue: null,
          unitValuePercent: null,
          avgPrice: null,
          valuation: 3557,
          unrealizedGain: null,
          isCash: true,
        },
      ],
    },
  ],
}

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'statements@test.dev')
  const org = await createOrg(t, 'org-statements', [
    { userId: user.userId, role: 'owner' },
  ])
  const supportCompanyId = await createPortfolioCompany(
    t,
    org.orgId,
    'Natixis Wealth Management',
  )
  return { t, user, org, supportCompanyId }
}

/** A storage blob, without going through an upload URL. */
async function storeBlob(t: Harness): Promise<Id<'_storage'>> {
  return await t.run(async (ctx) =>
    ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
  )
}

/** The securities accounts of the normalized statement, as `apply` takes
 * them: everything the screen would keep, each creating its placement. */
function securitiesPayload() {
  return normalizeStatement(natixisStatement)
    .accounts.filter((a) => a.isSecurities)
    .map((a) => ({
      accountNumber: a.accountNumber,
      label: a.label,
      valuation: a.totalValuation ?? a.positionsTotal,
      positions: a.positions,
    }))
}

describe('statement reading: euros in, this repo’s units out', () => {
  test('a quote in percent stays a percent, a quote in euros stays euros', () => {
    const draft = normalizeStatement(natixisStatement)
    const cto = draft.accounts.find((a) => a.accountNumber === '68425000003')!
    const [structured, fund] = cto.positions

    // 99,13 % → basis points, and NO euro unit value: the same figure in
    // cents would read as "99,13 €" beside a fund at "112 533,89 €".
    expect(structured.unitValueBps).toBe(9913)
    expect(structured.unitValue).toBeUndefined()
    expect(structured.valuation).toBe(495_650_00)
    expect(structured.diff).toBe(-435_000)
    expect(structured.avgPrice).toBe(100_00)

    expect(fund.unitValue).toBe(112_533_89)
    expect(fund.unitValueBps).toBeUndefined()
    expect(fund.avgPrice).toBe(112_405_28)
    expect(fund.quantity).toBeCloseTo(22.2449, 4)
  })

  test('the cash sleeve is a position, so the lines add up to the total', () => {
    const draft = normalizeStatement(natixisStatement)
    const cto = draft.accounts.find((a) => a.accountNumber === '68425000003')!
    expect(cto.positions.at(-1)?.isCash).toBe(true)
    // 495 650,00 + 2 503 305,13 + 5,14 = 2 998 960,27
    expect(cto.positionsTotal).toBe(2_998_960_27)
    expect(cto.totalValuation).toBe(2_998_960_27)
    expect(cto.gap).toBe(0)
    expect(cto.coherent).toBe(true)
  })

  test('lines that disagree with the printed total flag the account', () => {
    const misread: RawStatement = {
      ...natixisStatement,
      accounts: [
        {
          ...natixisStatement.accounts[1],
          // The reader dropped the monetary fund.
          positions: [natixisStatement.accounts[1].positions[0]],
        },
      ],
    }
    const account = normalizeStatement(misread).accounts[0]
    expect(account.coherent).toBe(false)
    expect(account.gap).toBe(495_650_00 - 2_998_960_27)
  })

  test('a current account is not a securities account', () => {
    const draft = normalizeStatement(natixisStatement)
    const byNumber = Object.fromEntries(
      draft.accounts.map((a) => [a.accountNumber, a.isSecurities]),
    )
    expect(byNumber['68425000001']).toBe(false)
    expect(byNumber['68425000003']).toBe(true)
    expect(byNumber['68425000002']).toBe(true)
  })

  test('an unreadable date stays unreadable rather than becoming today', () => {
    expect(parseStatementDate('2026-08-13')).toBe(AUG)
    expect(parseStatementDate('13/08/2026')).toBeUndefined()
    expect(parseStatementDate('2026-02-31')).toBeUndefined()
    expect(parseStatementDate(null)).toBeUndefined()
  })
})

describe('applying a statement', () => {
  test('creates the accounts, their positions and their placements', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    const storageId = await storeBlob(t)

    const result = await user.as.mutation(api.statements.apply, {
      orgId: org.orgId,
      storageId,
      source: 'natixis_wm',
      statementDate: AUG,
      bankName: 'Natixis Wealth Management',
      ownerCompanyId: org.rootCompanyId,
      supportCompanyId,
      accounts: securitiesPayload(),
    })

    expect(result.accountsCount).toBe(2)
    expect(result.positionsCount).toBe(4)
    // 2 998 960,27 + 3 557,00
    expect(result.totalValuation).toBe(3_002_517_27)

    const accounts = await user.as.query(api.cash.listAccounts, {
      orgId: org.orgId,
    })
    expect(accounts).toHaveLength(2)
    // Pledged by default: securities are not mobilizable cash, and counting
    // them as available would overstate what the group can spend.
    expect(accounts.every((a) => a.pledged)).toBe(true)
    // Dated at the statement, not at the import.
    expect(accounts.every((a) => a.balanceAsOf === AUG)).toBe(true)

    const cto = accounts.find((a) => a.label === 'CALTE CTO NANTI')!
    expect(cto.currentBalance).toBe(2_998_960_27)
    const positions = await user.as.query(api.investments.listByAccount, {
      bankAccountId: cto._id,
    })
    expect(positions).toHaveLength(3)
    expect(positions.every((p) => p.source === 'statement')).toBe(true)
    expect(positions.every((p) => p.valuationDate === AUG)).toBe(true)
    // The envelope totals the account to the cent.
    expect(positions.reduce((sum, p) => sum + (p.valuation ?? 0), 0)).toBe(
      2_998_960_27,
    )

    const deals = await user.as.query(api.deals.list, { orgId: org.orgId })
    const placements = deals.filter((d) => d.instrumentKind === 'cto')
    expect(placements).toHaveLength(2)
    const placement = placements.find((d) => d.currentValue === 2_998_960_27)
    expect(placement).toBeDefined()
  })

  test('the placement carries a valuation dated at the statement', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    const storageId = await storeBlob(t)
    await user.as.mutation(api.statements.apply, {
      orgId: org.orgId,
      storageId,
      source: 'natixis_wm',
      statementDate: AUG,
      bankName: 'Natixis Wealth Management',
      ownerCompanyId: org.rootCompanyId,
      supportCompanyId,
      accounts: securitiesPayload(),
    })
    const valuations = await t.run(async (ctx) =>
      ctx.db.query('valuations').collect(),
    )
    expect(valuations).toHaveLength(2)
    expect(valuations.every((v) => v.asOf === AUG)).toBe(true)
    expect(valuations.every((v) => v.source === 'statement_import')).toBe(true)
  })

  test('re-importing the same date corrects it instead of stacking', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    const first = await storeBlob(t)
    const common = {
      orgId: org.orgId,
      source: 'natixis_wm' as const,
      bankName: 'Natixis Wealth Management',
      ownerCompanyId: org.rootCompanyId,
      supportCompanyId,
    }
    await user.as.mutation(api.statements.apply, {
      ...common,
      storageId: first,
      statementDate: AUG,
      accounts: securitiesPayload(),
    })
    const placements = (
      await user.as.query(api.deals.list, { orgId: org.orgId })
    ).filter((d) => d.instrumentKind === 'cto')

    // The corrected statement: same date, one figure fixed.
    const corrected = securitiesPayload().map((a) =>
      a.accountNumber === '68425000003' ? { ...a, valuation: 3_000_000_00 } : a,
    )
    const second = await storeBlob(t)
    await user.as.mutation(api.statements.apply, {
      ...common,
      storageId: second,
      statementDate: AUG,
      accounts: corrected.map((a) => ({
        ...a,
        dealId: placements.find((p) => p.name === a.label)?._id,
      })),
    })

    const imports = await user.as.query(api.statements.listImports, {
      orgId: org.orgId,
    })
    expect(imports).toHaveLength(1)

    const valuations = await t.run(async (ctx) =>
      ctx.db.query('valuations').collect(),
    )
    // One point per placement, still — corrected, not doubled.
    expect(valuations).toHaveLength(2)
    expect(valuations.some((v) => v.fairValue === 3_000_000_00)).toBe(true)

    // No placement was created a second time either.
    const after = (
      await user.as.query(api.deals.list, { orgId: org.orgId })
    ).filter((d) => d.instrumentKind === 'cto')
    expect(after).toHaveLength(2)

    // The superseded PDF lost its only referent and was freed.
    expect(await t.run(async (ctx) => ctx.storage.getUrl(first))).toBeNull()
  })

  test('a later statement adds a point and leaves the earlier one alone', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    const common = {
      orgId: org.orgId,
      source: 'natixis_wm' as const,
      bankName: 'Natixis Wealth Management',
      ownerCompanyId: org.rootCompanyId,
      supportCompanyId,
    }
    await user.as.mutation(api.statements.apply, {
      ...common,
      storageId: await storeBlob(t),
      statementDate: AUG,
      accounts: securitiesPayload(),
    })
    const placements = (
      await user.as.query(api.deals.list, { orgId: org.orgId })
    ).filter((d) => d.instrumentKind === 'cto')
    await user.as.mutation(api.statements.apply, {
      ...common,
      storageId: await storeBlob(t),
      statementDate: NOV,
      accounts: securitiesPayload().map((a) => ({
        ...a,
        valuation: a.valuation + 10_000_00,
        dealId: placements.find((p) => p.name === a.label)?._id,
      })),
    })

    const imports = await user.as.query(api.statements.listImports, {
      orgId: org.orgId,
    })
    expect(imports).toHaveLength(2)
    // Most recent first.
    expect(imports[0].statementDate).toBe(NOV)

    const valuations = await t.run(async (ctx) =>
      ctx.db.query('valuations').collect(),
    )
    expect(valuations).toHaveLength(4)
    expect(valuations.filter((v) => v.asOf === AUG)).toHaveLength(2)
    expect(valuations.filter((v) => v.asOf === NOV)).toHaveLength(2)
  })

  test('deleting an import keeps the data it wrote', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    await user.as.mutation(api.statements.apply, {
      orgId: org.orgId,
      storageId: await storeBlob(t),
      source: 'natixis_wm',
      statementDate: AUG,
      bankName: 'Natixis Wealth Management',
      ownerCompanyId: org.rootCompanyId,
      supportCompanyId,
      accounts: securitiesPayload(),
    })
    const [row] = await user.as.query(api.statements.listImports, {
      orgId: org.orgId,
    })
    await user.as.mutation(api.statements.removeImport, {
      statementImportId: row._id,
    })
    expect(
      await user.as.query(api.statements.listImports, { orgId: org.orgId }),
    ).toHaveLength(0)
    // Balances and positions are the statement's readings, not the row's
    // property: removing the trace must not empty a placement.
    const accounts = await user.as.query(api.cash.listAccounts, {
      orgId: org.orgId,
    })
    expect(accounts).toHaveLength(2)
    expect(accounts.some((a) => a.currentBalance === 2_998_960_27)).toBe(true)
  })
})

describe('statement import: tenancy', () => {
  test('a non-member cannot import into the org', async () => {
    const { t, org, supportCompanyId } = await orgSetup()
    const outsider = await createUser(t, 'outsider@test.dev')
    await expectConvexError(
      outsider.as.mutation(api.statements.apply, {
        orgId: org.orgId,
        storageId: await storeBlob(t),
        source: 'natixis_wm',
        statementDate: AUG,
        bankName: 'Natixis Wealth Management',
        ownerCompanyId: org.rootCompanyId,
        supportCompanyId,
        accounts: securitiesPayload(),
      }),
      'not_a_member',
    )
  })

  test('the holding entity must be a group entity', async () => {
    const { t, user, org, supportCompanyId } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.statements.apply, {
        orgId: org.orgId,
        storageId: await storeBlob(t),
        source: 'natixis_wm',
        statementDate: AUG,
        bankName: 'Natixis Wealth Management',
        // A portfolio company owns nothing — same rule as everywhere else.
        ownerCompanyId: supportCompanyId,
        supportCompanyId,
        accounts: securitiesPayload(),
      }),
      'owner_must_be_group_entity',
    )
  })

  test('creating a placement without an institution is refused', async () => {
    const { t, user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.statements.apply, {
        orgId: org.orgId,
        storageId: await storeBlob(t),
        source: 'natixis_wm',
        statementDate: AUG,
        bankName: 'Natixis Wealth Management',
        ownerCompanyId: org.rootCompanyId,
        accounts: securitiesPayload(),
      }),
      'support_required',
    )
  })
})
