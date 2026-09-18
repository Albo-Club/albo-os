/**
 * Pure tests for the sub-section rule (convex/lib/modules.ts).
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
  FALLBACK_MODULE,
  hideBlockedBy,
  isModuleKey,
  isVisible,
  visibleModules,
} from '../convex/lib/modules'
import type { ModuleKey, ModuleState } from '../convex/lib/modules'

const state = (
  key: ModuleKey,
  over: Partial<ModuleState> = {},
): ModuleState => ({ key, hasContent: false, enabled: false, ...over })

describe('visibilité d’une sous-section (D37)', () => {
  it('une sous-section qui contient quelque chose est visible', () => {
    assert.equal(isVisible(state('placements', { hasContent: true })), true)
  })

  it('une sous-section vide mais cochée à la main est visible', () => {
    assert.equal(isVisible(state('placements', { enabled: true })), true)
  })

  it('une sous-section vide et non cochée est masquée', () => {
    assert.equal(isVisible(state('placements')), false)
  })

  it('le contenu gagne sur le décochage', () => {
    // Décocher une sous-section qui contient des lignes ne les rend pas
    // inaccessibles : sinon elles seraient invisibles sans retour possible.
    assert.equal(
      isVisible(state('immobilier', { hasContent: true, enabled: false })),
      true,
    )
  })
})

describe('ce que la barre d’onglets affiche', () => {
  it('ne garde que les sous-sections visibles, dans l’ordre de déclaration', () => {
    const states = [
      state('entreprises', { hasContent: true }),
      state('placements'),
      state('immobilier', { enabled: true }),
    ]
    assert.deepEqual(visibleModules(states), ['entreprises', 'immobilier'])
  })

  it('une sous-section inconnue de l’état est affichée — jamais masquée par ignorance', () => {
    assert.deepEqual(visibleModules([]), [...ALL_MODULES])
  })

  it('une SCI sans participation ni placement ne voit que l’immobilier', () => {
    const states = [
      state('entreprises'),
      state('placements'),
      state('immobilier', { hasContent: true }),
    ]
    assert.deepEqual(visibleModules(states), ['immobilier'])
  })

  it('une org qui n’a rien choisi voit Entreprises', () => {
    // C'est le repli qui tient lieu de défaut : rien à écrire à la création
    // d'une org, et une org vide existante n'arrive pas sur une section sans
    // aucune page.
    const states = ALL_MODULES.map((key) => state(key))
    assert.deepEqual(visibleModules(states), [FALLBACK_MODULE])
  })
})

describe('ce que le menu ⋯ refuse de masquer', () => {
  it('refuse de masquer une sous-section qui contient des lignes', () => {
    const states = [
      state('entreprises', { hasContent: true }),
      state('placements', { enabled: true }),
      state('immobilier'),
    ]
    assert.equal(hideBlockedBy(states, 'entreprises'), 'content')
  })

  it('refuse de masquer la dernière visible', () => {
    // Investissements doit garder une page ; sans ce garde-fou le repli
    // ramènerait Entreprises, donc décocher la dernière ne ferait rien de
    // visible — un clic sans effet.
    const states = [
      state('entreprises'),
      state('placements', { enabled: true }),
      state('immobilier'),
    ]
    assert.equal(hideBlockedBy(states, 'placements'), 'last')
  })

  it('laisse masquer une sous-section vide quand il en reste une autre', () => {
    const states = [
      state('entreprises', { hasContent: true }),
      state('placements', { enabled: true }),
      state('immobilier'),
    ]
    assert.equal(hideBlockedBy(states, 'placements'), null)
  })

  it('ne dit rien d’une sous-section déjà masquée', () => {
    const states = [
      state('entreprises', { hasContent: true }),
      state('placements'),
      state('immobilier'),
    ]
    assert.equal(hideBlockedBy(states, 'immobilier'), null)
  })
})

describe('le registre des sous-sections', () => {
  it('couvre les trois sous-sections d’Investissements, sans doublon', () => {
    assert.deepEqual(ALL_MODULES, ['entreprises', 'placements', 'immobilier'])
    assert.equal(new Set(ALL_MODULES).size, ALL_MODULES.length)
  })

  it('la plateforme n’est plus modulaire', () => {
    // Investissements, Trésorerie et Passif sont toujours dans la barre
    // latérale : une entrée absente ne dit rien, une page vide dit ce
    // qu'elle attend. Leurs anciens slugs ne sont plus des modules.
    for (const legacy of ['investments', 'cash', 'passif']) {
      assert.equal(isModuleKey(legacy), false)
    }
  })

  it('« À faire » n’a jamais été un module', () => {
    assert.equal(isModuleKey('todo'), false)
    assert.equal(isModuleKey('settings'), false)
  })

  it('reconnaît les slugs connus et rejette le reste', () => {
    assert.equal(isModuleKey('immobilier'), true)
    assert.equal(isModuleKey('entreprises'), true)
    assert.equal(isModuleKey('nimportequoi'), false)
  })
})
