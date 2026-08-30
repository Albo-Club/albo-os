/**
 * Pure tests for the activatable-module rule (convex/lib/modules.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 *
 * Deliberately OUTSIDE convex/: a `node:test` import inside convex/ would
 * break the Convex deployment bundle.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALL_MODULES,
  SIDEBAR_MODULES,
  TAB_MODULES,
  activatableModules,
  isModuleKey,
  isVisible,
  visibleModules,
} from '../convex/lib/modules'
import type { ModuleKey, ModuleState } from '../convex/lib/modules'

const state = (
  key: ModuleKey,
  over: Partial<ModuleState> = {},
): ModuleState => ({ key, hasContent: false, enabled: false, ...over })

describe('visibilité d’un module (D37)', () => {
  it('un module qui contient quelque chose est visible', () => {
    assert.equal(isVisible(state('cash', { hasContent: true })), true)
  })

  it('un module vide mais activé à la main est visible', () => {
    assert.equal(isVisible(state('cash', { enabled: true })), true)
  })

  it('un module vide et non activé est masqué', () => {
    assert.equal(isVisible(state('cash')), false)
  })

  it('le contenu gagne sur la désactivation', () => {
    // Éteindre un module qui contient des lignes ne les rend pas
    // inaccessibles : sinon elles seraient invisibles sans retour possible.
    assert.equal(
      isVisible(state('passif', { hasContent: true, enabled: false })),
      true,
    )
  })
})

describe('ce que la barre latérale et les onglets affichent', () => {
  it('ne garde que les modules visibles, dans l’ordre de déclaration', () => {
    const states = [
      state('investments', { hasContent: true }),
      state('cash'),
      state('passif', { enabled: true }),
    ]
    assert.deepEqual(visibleModules(states, SIDEBAR_MODULES), [
      'investments',
      'passif',
    ])
  })

  it('un module inconnu de l’état est affiché — jamais masqué par ignorance', () => {
    assert.deepEqual(visibleModules([], SIDEBAR_MODULES), [...SIDEBAR_MODULES])
  })

  it('une SCI sans participation ni placement ne voit ni l’un ni l’autre', () => {
    const states = [
      state('entreprises'),
      state('placements'),
      state('immobilier', { hasContent: true }),
    ]
    assert.deepEqual(visibleModules(states, TAB_MODULES), ['immobilier'])
  })
})

describe('ce que le menu ⋯ propose', () => {
  it('propose exactement les modules masqués', () => {
    const states = [
      state('entreprises'),
      state('placements'),
      state('immobilier', { hasContent: true }),
    ]
    assert.deepEqual(activatableModules(states, TAB_MODULES), [
      'entreprises',
      'placements',
    ])
  })

  it('ne propose jamais un module déjà visible', () => {
    const states = [
      state('entreprises', { hasContent: true }),
      state('placements', { enabled: true }),
      state('immobilier', { hasContent: true }),
    ]
    assert.deepEqual(activatableModules(states, TAB_MODULES), [])
  })

  it('rend une liste vide quand l’état n’est pas encore chargé', () => {
    // Rien à proposer tant qu'on ne sait pas : le menu ne s'affiche pas.
    assert.deepEqual(activatableModules([], TAB_MODULES), [])
  })
})

describe('le registre des modules', () => {
  it('couvre la barre latérale et les onglets, sans doublon', () => {
    assert.deepEqual(ALL_MODULES, [...SIDEBAR_MODULES, ...TAB_MODULES])
    assert.equal(new Set(ALL_MODULES).size, ALL_MODULES.length)
  })

  it('« À faire » n’est PAS un module activable', () => {
    // Il porte les signaux de tous les autres : le masquer masquerait le
    // moyen d'agir sur le reste.
    assert.equal(isModuleKey('todo'), false)
    assert.equal(isModuleKey('settings'), false)
  })

  it('reconnaît les slugs connus et rejette le reste', () => {
    assert.equal(isModuleKey('immobilier'), true)
    assert.equal(isModuleKey('passif'), true)
    assert.equal(isModuleKey('nimportequoi'), false)
  })
})
