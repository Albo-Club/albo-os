/// <reference types="vite/client" />
/**
 * Regression: the sub-sections of Investissements — convex/modules.ts
 * (SPEC D37, revised).
 *
 * The rule is « une sous-section s'affiche si elle contient quelque chose, ou
 * si elle a été cochée à la main ». What matters here is that the first half
 * is DERIVED on every read: a sub-section appears the moment its first row
 * exists, with nothing to maintain and no display flag to keep in sync.
 *
 * The platform itself is no longer modular — Investissements, Trésorerie and
 * Passif are always in the sidebar — so those slugs are not modules any more,
 * and asking to toggle one is refused like any unknown slug.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

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

describe('sous-sections: emptiness is derived, never stored', () => {
  test('a fresh org holds nothing — the org root does not count', async () => {
    const { user, org } = await orgSetup()
    const states = await user.as.query(api.modules.list, { orgId: org.orgId })

    // Every org has a `group_root` company. Counting it would make the
    // Entreprises sub-section permanently non-empty, and the rule pointless.
    expect(states.map((row) => row.key)).toEqual([
      'entreprises',
      'placements',
      'immobilier',
    ])
    for (const row of states) {
      expect(row.hasContent).toBe(false)
      expect(row.enabled).toBe(false)
    }
  })

  test('a portfolio company makes Entreprises appear, with nothing to declare', async () => {
    const { t, user, org } = await orgSetup()
    await createPortfolioCompany(t, org.orgId, 'Sezame')

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    expect(stateOf(states, 'entreprises')?.hasContent).toBe(true)
    expect(stateOf(states, 'placements')?.hasContent).toBe(false)
  })

  test('a property makes Immobilier appear, and only it', async () => {
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
    // The two siblings stay empty — this is the SCI case: a building, no
    // participation, no placement.
    expect(stateOf(states, 'entreprises')?.hasContent).toBe(false)
    expect(stateOf(states, 'placements')?.hasContent).toBe(false)
  })

  test('a bank account changes nothing — Trésorerie is not a module', async () => {
    const { t, user, org } = await orgSetup()
    await createBankAccount(t, org)

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    // The sidebar entry is always there, so nothing to probe: the account
    // must not make an Investissements sub-section appear either.
    expect(stateOf(states, 'cash')).toBeUndefined()
    for (const row of states) expect(row.hasContent).toBe(false)
  })
})

describe('sous-sections: the explicit switch, both ways', () => {
  test('ticking one shows it while it still holds nothing', async () => {
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

  test('unticking one takes it back off — the gesture is reversible', async () => {
    const { user, org } = await orgSetup()
    await user.as.mutation(api.modules.setEnabled, {
      orgId: org.orgId,
      module: 'placements',
      enabled: true,
    })
    await user.as.mutation(api.modules.setEnabled, {
      orgId: org.orgId,
      module: 'placements',
      enabled: false,
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    // The defect of the first version: the menu only ever wrote `true`, so
    // an added sub-section could never be taken back out.
    expect(stateOf(states, 'placements')?.enabled).toBe(false)
  })

  test('unticking one that holds content leaves it visible', async () => {
    const { t, user, org } = await orgSetup()
    await createPortfolioCompany(t, org.orgId, 'Sezame')
    await user.as.mutation(api.modules.setEnabled, {
      orgId: org.orgId,
      module: 'entreprises',
      enabled: false,
    })

    const states = await user.as.query(api.modules.list, { orgId: org.orgId })
    // `enabled` went off, but the content is still there — and the rule reads
    // « holds something OR ticked », so the rows stay reachable.
    expect(stateOf(states, 'entreprises')?.enabled).toBe(false)
    expect(stateOf(states, 'entreprises')?.hasContent).toBe(true)
  })

  test('toggling is idempotent and stores each sub-section once', async () => {
    const { t, user, org } = await orgSetup()
    for (let k = 0; k < 3; k++) {
      await user.as.mutation(api.modules.setEnabled, {
        orgId: org.orgId,
        module: 'immobilier',
        enabled: true,
      })
    }
    const stored = await t.run(async (ctx) => {
      const row = await ctx.db.get('organizations', org.orgId)
      return row?.enabledModules ?? []
    })
    expect(stored).toEqual(['immobilier'])
  })

  test('a platform slug is refused like any unknown one', async () => {
    const { user, org } = await orgSetup()
    // Investissements, Trésorerie and Passif are always in the sidebar: there
    // is nothing to toggle, and a leftover row from the modular era must not
    // resurrect one.
    for (const legacy of ['investments', 'cash', 'passif', 'todo']) {
      await expectConvexError(
        user.as.mutation(api.modules.setEnabled, {
          orgId: org.orgId,
          module: legacy,
          enabled: true,
        }),
        'unknown_module',
      )
    }
  })

  test('a non-member neither reads nor writes the sub-sections', async () => {
    const { t, org } = await orgSetup()
    const outsider = await createUser(t, 'outsider-modules@test.dev')
    await expectConvexError(
      outsider.as.query(api.modules.list, { orgId: org.orgId }),
      'not_a_member',
    )
    await expectConvexError(
      outsider.as.mutation(api.modules.setEnabled, {
        orgId: org.orgId,
        module: 'immobilier',
        enabled: true,
      }),
      'not_a_member',
    )
  })
})
