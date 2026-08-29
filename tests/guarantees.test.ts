/**
 * Pure tests for the guarantee logic (convex/lib/guarantees.ts).
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
  compareGuaranteeStrength,
  isActive,
  sortByStrength,
  summarizePledges,
} from '../convex/lib/guarantees'
import type { GuaranteeForm } from '../convex/lib/guarantees'

const g = (
  form: GuaranteeForm,
  over: { rank?: number; pledgedAmountCents?: number; releasedAt?: number } = {},
) => ({ form, ...over })

describe('ordre d’affichage des sûretés (D48)', () => {
  it('classe de la plus forte à la moins forte', () => {
    const sorted = sortByStrength([
      g('caution'),
      g('nantissement'),
      g('ppd'),
      g('garantie_organisme'),
      g('hypotheque'),
    ])
    assert.deepEqual(
      sorted.map((row) => row.form),
      ['ppd', 'hypotheque', 'nantissement', 'garantie_organisme', 'caution'],
    )
  })

  it('met le PPD devant l’hypothèque — son rang remonte à la vente', () => {
    assert.ok(compareGuaranteeStrength(g('ppd'), g('hypotheque')) < 0)
  })

  it('à forme égale, le premier rang passe devant le second', () => {
    const sorted = sortByStrength([
      g('nantissement', { rank: 2 }),
      g('nantissement', { rank: 1 }),
    ])
    assert.deepEqual(
      sorted.map((row) => row.rank),
      [1, 2],
    )
  })

  it('un rang inconnu passe après les rangs connus', () => {
    const sorted = sortByStrength([
      g('nantissement'),
      g('nantissement', { rank: 3 }),
    ])
    assert.deepEqual(
      sorted.map((row) => row.rank),
      [3, undefined],
    )
  })

  it('à forme et rang égaux, le plus gros montant d’abord', () => {
    const sorted = sortByStrength([
      g('nantissement', { rank: 1, pledgedAmountCents: 150_000_00 }),
      g('nantissement', { rank: 1, pledgedAmountCents: 500_000_00 }),
    ])
    assert.deepEqual(
      sorted.map((row) => row.pledgedAmountCents),
      [500_000_00, 150_000_00],
    )
  })

  it('une garantie non chiffrée passe après une chiffrée de même force', () => {
    const sorted = sortByStrength([
      g('caution'),
      g('caution', { pledgedAmountCents: 100_00 }),
    ])
    assert.deepEqual(
      sorted.map((row) => row.pledgedAmountCents),
      [100_00, undefined],
    )
  })

  it('une mainlevée tombe en bas, quelle que soit sa forme', () => {
    const sorted = sortByStrength([
      g('ppd', { releasedAt: 1 }),
      g('caution'),
    ])
    assert.deepEqual(
      sorted.map((row) => row.form),
      ['caution', 'ppd'],
    )
  })

  it('ne mute pas le tableau d’entrée', () => {
    const input = [g('caution'), g('ppd')]
    sortByStrength(input)
    assert.deepEqual(
      input.map((row) => row.form),
      ['caution', 'ppd'],
    )
  })
})

describe('isActive — la mainlevée', () => {
  it('sans releasedAt, la garantie mord', () => {
    assert.equal(isActive({}), true)
  })

  it('avec releasedAt, elle est levée', () => {
    assert.equal(isActive({ releasedAt: Date.UTC(2026, 0, 1) }), false)
  })
})

describe('marge disponible sur un actif gagé (§ 5.2)', () => {
  it('valeur − total gagé', () => {
    const summary = summarizePledges(1_400_000_00, [
      { pledgedAmountCents: 500_000_00 },
      { pledgedAmountCents: 300_000_00 },
      { pledgedAmountCents: 150_000_00 },
    ])
    assert.equal(summary.pledgedTotalCents, 950_000_00)
    assert.equal(summary.availableMarginCents, 450_000_00)
    assert.equal(summary.activeCount, 3)
  })

  it('exclut du total les garanties non chiffrées, et les compte à part (C3)', () => {
    const summary = summarizePledges(1_000_000_00, [
      { pledgedAmountCents: 300_000_00 },
      {}, // caution illimitée
    ])
    assert.equal(summary.pledgedTotalCents, 300_000_00)
    assert.equal(summary.unquantifiedCount, 1)
    assert.equal(summary.availableMarginCents, 700_000_00)
  })

  it('sort les mainlevées du total mais les garde au compte (C6)', () => {
    const summary = summarizePledges(1_000_000_00, [
      { pledgedAmountCents: 300_000_00 },
      { pledgedAmountCents: 900_000_00, releasedAt: Date.UTC(2026, 0, 1) },
    ])
    assert.equal(summary.pledgedTotalCents, 300_000_00)
    assert.equal(summary.activeCount, 1)
    assert.equal(summary.releasedCount, 1)
  })

  it('affiche une marge négative quand le gage dépasse la valeur (C2)', () => {
    // Ligne 4 de l’annexe : 9,9 M€ gagés sur un compte-titres valorisé 3,7 M€.
    const summary = summarizePledges(3_700_000_00, [
      { pledgedAmountCents: 6_600_000_00 },
      { pledgedAmountCents: 3_300_000_00 },
    ])
    assert.equal(summary.pledgedTotalCents, 9_900_000_00)
    assert.equal(summary.availableMarginCents, -6_200_000_00)
  })

  it('sans valorisation, la marge est inconnue — jamais zéro', () => {
    const summary = summarizePledges(null, [
      { pledgedAmountCents: 300_000_00 },
    ])
    assert.equal(summary.availableMarginCents, null)
    assert.equal(summary.pledgedTotalCents, 300_000_00)
  })

  it('un actif sans gage garde toute sa valeur en marge', () => {
    const summary = summarizePledges(1_000_000_00, [])
    assert.equal(summary.pledgedTotalCents, 0)
    assert.equal(summary.availableMarginCents, 1_000_000_00)
    assert.equal(summary.activeCount, 0)
  })

  it('le montant gagé ne décroît pas avec la dette — la marge est pessimiste', () => {
    // Un nantissement de 300 K€ sur un prêt dont il ne reste que 150 K€ vaut
    // juridiquement 300 K€ jusqu'à la mainlevée : c'est 300 K€ qui sortent
    // de la marge, pas 150 K€.
    const summary = summarizePledges(1_000_000_00, [
      { pledgedAmountCents: 300_000_00 },
    ])
    assert.equal(summary.availableMarginCents, 700_000_00)
  })
})
