/**
 * Pure tests for the portfolio-group logic (convex/lib/portfolioGroups.ts).
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
  DEFAULT_BLOCKS,
  KPI_BLOCKS,
  aggregateEntities,
  resolveBlocks,
  sanitizeBlocks,
  slugify,
  uniqueSlug,
} from '../convex/lib/portfolioGroups'

describe('aggregateEntities', () => {
  it('somme les montants des entités', () => {
    const agg = aggregateEntities([
      { committed: 1000, paid: 800, received: 200, residual: 900 },
      { committed: 500, paid: 400, received: 100, residual: 600 },
    ])
    assert.equal(agg.committed, 1500)
    assert.equal(agg.paid, 1200)
    assert.equal(agg.received, 300)
    assert.equal(agg.residual, 1500)
  })

  it('TVPI = (reçu + résiduel) / versé', () => {
    const agg = aggregateEntities([
      { committed: 0, paid: 1000, received: 500, residual: 1500 },
    ])
    assert.equal(agg.tvpi, 2)
  })

  it('TVPI null quand rien n’a été versé', () => {
    const agg = aggregateEntities([
      { committed: 1000, paid: 0, received: 0, residual: 0 },
    ])
    assert.equal(agg.tvpi, null)
  })

  it('liste vide → totaux à 0, TVPI null', () => {
    const agg = aggregateEntities([])
    assert.deepEqual(agg, {
      committed: 0,
      paid: 0,
      received: 0,
      residual: 0,
      tvpi: null,
    })
  })
})

describe('resolveBlocks', () => {
  it('config vide → défaut (tous visibles, ordre catalogue)', () => {
    assert.deepEqual(resolveBlocks(undefined), DEFAULT_BLOCKS)
    assert.deepEqual(resolveBlocks([]), DEFAULT_BLOCKS)
  })

  it('préserve l’ordre stocké et la visibilité', () => {
    const stored = [
      { key: 'tvpi', visible: false },
      { key: 'expo_totale', visible: true },
    ]
    const resolved = resolveBlocks(stored)
    assert.equal(resolved[0].key, 'tvpi')
    assert.equal(resolved[0].visible, false)
    assert.equal(resolved[1].key, 'expo_totale')
  })

  it('ignore une clé inconnue', () => {
    const resolved = resolveBlocks([
      { key: 'inconnu', visible: true },
      { key: 'verse', visible: true },
    ])
    assert.ok(!resolved.some((b) => b.key === 'inconnu'))
    assert.equal(resolved[0].key, 'verse')
  })

  it('ajoute en fin les blocs catalogue manquants (visibles)', () => {
    const resolved = resolveBlocks([{ key: 'verse', visible: false }])
    // Every catalogue block is present, 'verse' first (stored), rest appended.
    assert.equal(resolved.length, KPI_BLOCKS.length)
    assert.equal(resolved[0].key, 'verse')
    for (const k of KPI_BLOCKS) {
      assert.ok(resolved.some((b) => b.key === k))
    }
    // Appended blocks are visible by default.
    assert.equal(resolved.find((b) => b.key === 'tvpi')?.visible, true)
  })
})

describe('sanitizeBlocks', () => {
  it('ne garde que les clés du catalogue', () => {
    const out = sanitizeBlocks([
      { key: 'verse', visible: true },
      { key: 'hack', visible: false },
    ])
    assert.deepEqual(out, [{ key: 'verse', visible: true }])
  })
})

describe('slugify', () => {
  it('minuscule, accents retirés, tirets', () => {
    assert.equal(slugify('La vie de quartier'), 'la-vie-de-quartier')
    assert.equal(slugify('Épicerie Râ'), 'epicerie-ra')
  })

  it('trim les tirets de bord', () => {
    assert.equal(slugify('  Parallel!  '), 'parallel')
  })

  it('fallback quand rien d’utilisable', () => {
    assert.equal(slugify('!!!'), 'groupe')
  })
})

describe('uniqueSlug', () => {
  it('renvoie la base si libre', () => {
    assert.equal(uniqueSlug('parallel', ['autre']), 'parallel')
  })

  it('suffixe en cas de collision', () => {
    assert.equal(uniqueSlug('parallel', ['parallel']), 'parallel-2')
    assert.equal(
      uniqueSlug('parallel', ['parallel', 'parallel-2']),
      'parallel-3',
    )
  })
})
