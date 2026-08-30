/// <reference types="vite/client" />
/**
 * Regression: activatable modules — convex/modules.ts (SPEC D37).
 *
 * The rule is « a module shows if it holds something, or if it was turned on
 * by hand ». What matters here is that the first half is DERIVED on every
 * read: a module appears the moment its first row exists, with nothing to
 * maintain and no display flag to keep in sync.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

async function orgSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'modules@test.dev')
  const org = await createOrg(t, 'org-modules', [
    { userId: user.userId, role: 'owner' },
  ])
  return { t, user, org }
}

const stateOf = (
  states: Array<{ key: string; hasContent: boolean; enabled: boolean }>,
  key: string,
) => states.find((row) => row.key === key)

describe('modules: emptiness is derived, never stored', () => {
  test('a fresh org holds nothing — the org root does not count', async () => {
    const { user, org } = await orgSetup()
    const states = await user.as.query(api.modules.list, { orgId: org.orgId })

    // Every org has a `group_root` company. Counting it would make the
    // Entreprises tab permanently non-empty, and the rule pointless.
    for (const key of ['investments', 'cash', 'passif', 'entreprises']) {
      expect(stateOf(states, key)?.hasContent).toBe(false)
      expect(stateOf(states, key)?.enabled).toBe(false)
    }
  })

  test('a bank account makes Trésorerie appear, with nothing to declare', async () => {
    const { t, user, org } = await orgSetup()
    await createBankAccount(t, org)

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    expect(stateOf(states, 'cash')?.hasContent).toBe(true)
  })

  test('a property makes Immobilier AND Investissements appear', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.properties.create, {
      orgId: org.orgId,
      name: '18 rue de la Chapelle',
      address: 'Paris 18e',
      propertyType: 'immeuble',
      usage: 'locatif_nu',
      costBasis: [],
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    expect(stateOf(states, 'immobilier')?.hasContent).toBe(true)
    // The section shows as soon as any of its three tabs holds something.
    expect(stateOf(states, 'investments')?.hasContent).toBe(true)
    // …but the two sibling tabs stay empty.
    expect(stateOf(states, 'entreprises')?.hasContent).toBe(false)
    expect(stateOf(states, 'placements')?.hasContent).toBe(false)
  })

  test('a bank loan makes Passif appear', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.loans.create, {
      orgId: org.orgId,
      label: 'Prêt Palatine 2021',
      lenderName: 'Banque Palatine',
      principalCents: 500_000_00,
      signedDate: utc(2021, 6, 14),
      firstPaymentDate: utc(2021, 7, 5),
      durationMonths: 240,
      amortizationKind: 'constant_annuity',
      rateBps: 185,
      rateKind: 'fixed',
      paymentFrequency: 'monthly',
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    expect(stateOf(states, 'passif')?.hasContent).toBe(true)
  })

  test('an equity position also makes Passif appear', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.liabilities.createEquityPosition, {
      orgId: org.orgId,
      type: 'capital_social',
      amountCents: 10_000_00,
      effectiveDate: utc(2019, 3, 12),
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    expect(stateOf(states, 'passif')?.hasContent).toBe(true)
  })
})

describe('modules: the explicit switch', () => {
  test('turning one on shows it while it still holds nothing', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.modules.setEnabled, {
      orgId: org.orgId,
      module: 'immobilier',
      enabled: true,
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    // Which is the whole point: this is where its FIRST property is created.
    expect(stateOf(states, 'immobilier')?.hasContent).toBe(false)
    expect(stateOf(states, 'immobilier')?.enabled).toBe(true)
  })

  test('turning one off leaves its content visible', async () => {
    const { t, user, org } = await orgSetup()
    await createBankAccount(t, org)
    await user.as.mutation(api.modules.setEnabled, {
      orgId: org.orgId,
      module: 'cash',
      enabled: false,
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    // `enabled` went off, but the content is still there — and the front
    // reads « holds something OR enabled », so the module stays reachable.
    expect(stateOf(states, 'cash')?.enabled).toBe(false)
    expect(stateOf(states, 'cash')?.hasContent).toBe(true)
  })

  test('toggling is idempotent and stores each module once', async () => {
    const { t, user, org } = await orgSetup()
    for (let k = 0; k < 3; k++) {
      await user.as.mutation(api.modules.setEnabled, {
        orgId: org.orgId,
        module: 'passif',
        enabled: true,
      })
    }
    const stored = await t.run(async (ctx) => {
      const row = await ctx.db.get('organizations', org.orgId)
      return row?.enabledModules ?? []
    })
    expect(stored).toEqual(['passif'])
  })

  test('an unknown module slug is refused', async () => {
    const { user, org } = await orgSetup()
    await expectConvexError(
      user.as.mutation(api.modules.setEnabled, {
        orgId: org.orgId,
        module: 'todo',
        enabled: true,
      }),
      'unknown_module',
    )
  })

  test('a non-member neither reads nor writes the modules', async () => {
    const { t, org } = await orgSetup()
    const outsider = await createUser(t, 'outsider-modules@test.dev')
    await expectConvexError(
      outsider.as.query(api.modules.list, { orgId: org.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      outsider.as.mutation(api.modules.setEnabled, {
        orgId: org.orgId,
        module: 'cash',
        enabled: true,
      }),
      'not_a_member',
    )
  })
})
