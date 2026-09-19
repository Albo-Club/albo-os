/**
 * Pure tests for the arbitration of the capital operations read in a legal
 * document (convex/lib/capitalExtraction.ts): a value keeps only with its
 * quote in the text, our entry round is never proposed, a known operation is
 * never proposed twice.
 *
 * Reference: ACT Running (ALB-248). Entry September 2025 at 80 €; the
 * December 2025 « Rapport du Président » describes the next round at the
 * same price, 2 500 shares issued, 40 000 outstanding.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planProposals } from '../convex/lib/capitalExtraction'
import type {
  ExtractedOperation,
  KnownPoint,
} from '../convex/lib/capitalExtraction'

const TEXT = `RAPPORT DU PRESIDENT EN VUE DES DECISIONS DES ASSOCIES
DU 10 DECEMBRE 2025
augmenter le capital social de la Société d'un montant de 37.500 euros divisé en
37.500 actions ordinaires, pour le porter ainsi à 40.000 euros, par l'émission
d'un nombre maximum de 2.500 actions ordinaires nouvelles
moyennant un prix d'émission unitaire de 80 euros (prime d'émission incluse),
soit un prix de souscription total d'un montant maximum de 200.000 euros.
Préambule : le tour de septembre 2025, 313 actions souscrites le 5 septembre 2025
au prix unitaire de 80 euros.`

const q = <T>(value: T, quote: string) => ({ value, quote })

const decemberRound: ExtractedOperation = {
  kind: 'round',
  dateISO: q('2025-12-10', 'DU 10 DECEMBRE 2025'),
  pricePerShareEur: q(80, "prix d'émission unitaire de 80 euros"),
  sharesIssued: q(2500, 'nombre maximum de 2.500 actions ordinaires nouvelles'),
  totalSharesAfter: q(40000, 'pour le porter ainsi à 40.000 euros'),
  roundSizeEur: q(200000, 'montant maximum de 200.000 euros'),
}

const septemberEntry: ExtractedOperation = {
  kind: 'round',
  dateISO: q('2025-09-05', 'le 5 septembre 2025'),
  pricePerShareEur: q(80, 'au prix unitaire de 80 euros'),
  sharesIssued: q(313, '313 actions souscrites'),
  totalSharesAfter: q(37500, '37.500 actions ordinaires'),
  roundSizeEur: null,
}

const actEntry: KnownPoint = {
  asOf: Date.UTC(2025, 8, 5),
  pricePerShareCents: 80_00,
}

describe('planProposals — ACT Running', () => {
  it('the December round becomes one proposal with its quotes', () => {
    const plan = planProposals({
      text: TEXT,
      operations: [decemberRound],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.deepEqual(plan.skipped, [])
    assert.equal(plan.proposals.length, 1)
    const p = plan.proposals[0]
    assert.equal(p.kind, 'round')
    assert.equal(p.asOf, Date.UTC(2025, 11, 10))
    assert.equal(p.pricePerShare, 80_00)
    assert.equal(p.sharesIssued, 2500)
    assert.equal(p.totalSharesAfter, 40_000)
    assert.equal(p.roundSize, 200_000_00)
    assert.match(
      p.evidence,
      /10 DECEMBRE 2025 — prix d'émission unitaire de 80 euros/,
    )
  })

  it('our entry round, re-read in a preamble, is never proposed', () => {
    const plan = planProposals({
      text: TEXT,
      operations: [septemberEntry, decemberRound],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.deepEqual(plan.skipped, [{ index: 0, reason: 'tour_d_entree' }])
    assert.equal(plan.proposals.length, 1)
    assert.equal(plan.proposals[0].asOf, Date.UTC(2025, 11, 10))
  })

  it('an operation already known on the company is skipped', () => {
    const plan = planProposals({
      text: TEXT,
      operations: [decemberRound],
      entryPoints: [actEntry],
      // Same round known from another document, dated three days apart.
      existingPoints: [
        { asOf: Date.UTC(2025, 11, 13), pricePerShareCents: 80_00 },
      ],
    })
    assert.deepEqual(plan.skipped, [{ index: 0, reason: 'deja_connue' }])
    assert.equal(plan.proposals.length, 0)
  })

  it('the same round read twice in one document is proposed once', () => {
    const plan = planProposals({
      text: TEXT,
      operations: [decemberRound, { ...decemberRound, kind: 'other' }],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.equal(plan.proposals.length, 1)
    assert.deepEqual(plan.skipped, [{ index: 1, reason: 'deja_connue' }])
  })

  it('a value whose quote is not in the text is dropped', () => {
    const invented: ExtractedOperation = {
      ...decemberRound,
      totalSharesAfter: q(45000, 'porté à 45.000 actions'),
    }
    const plan = planProposals({
      text: TEXT,
      operations: [invented],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.deepEqual(plan.skipped, [
      { index: 0, reason: 'actions_totales_manquantes' },
    ])
    // Optional values without a real quote are simply left out.
    const noRound = planProposals({
      text: TEXT,
      operations: [{ ...decemberRound, roundSizeEur: q(999, 'inventé') }],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.equal(noRound.proposals[0].roundSize, undefined)
  })

  it('quotes survive OCR reflow (whitespace and case)', () => {
    const reflowed: ExtractedOperation = {
      ...decemberRound,
      dateISO: q('2025-12-10', 'du 10   decembre\n2025'),
    }
    const plan = planProposals({
      text: TEXT,
      operations: [reflowed],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.equal(plan.proposals.length, 1)
  })

  it('a date, a price and a total are required; an unknown kind reads as other', () => {
    const plan = planProposals({
      text: TEXT,
      operations: [
        { ...decemberRound, dateISO: null },
        {
          ...decemberRound,
          pricePerShareEur: q(0, "prix d'émission unitaire de 80 euros"),
        },
        { ...decemberRound, kind: 'ipo' },
      ],
      entryPoints: [actEntry],
      existingPoints: [],
    })
    assert.deepEqual(plan.skipped, [
      { index: 0, reason: 'date_manquante' },
      { index: 1, reason: 'prix_manquant' },
    ])
    assert.equal(plan.proposals.length, 1)
    assert.equal(plan.proposals[0].kind, 'other')
  })
})
