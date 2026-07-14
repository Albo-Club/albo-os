/**
 * Pure tests for the forecast-entry ↔ transaction suggestion engine
 * (convex/lib/entryMatching.ts). Run via `pnpm test:unit` (node:test + tsx,
 * deliberately outside convex/ — same pattern as recurrence.test.ts).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  matchTokens,
  scoreEntryMatch,
  suggestEntryMatches,
} from '../convex/lib/entryMatching'
import type { MatchableEntry, MatchableTx } from '../convex/lib/entryMatching'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

const entry = (over: Partial<MatchableEntry> = {}): MatchableEntry => ({
  id: 'entry-1',
  date: utc(2026, 7, 5),
  amountCents: 150000, // 1 500 €
  direction: 'out',
  label: 'Loyer SCI Chapelle',
  ...over,
})

const tx = (over: Partial<MatchableTx> = {}): MatchableTx => ({
  id: 'tx-1',
  transactionDate: utc(2026, 7, 5),
  amountCents: 150000,
  direction: 'out',
  searchText: 'vir sepa loyer sci chapelle juillet',
  ...over,
})

describe('matchTokens — tokens stables du libellé', () => {
  it('normalise (accents, casse) et retire les tokens courts ou numériques', () => {
    assert.deepEqual(matchTokens('Échéance PRÊT 15/07/2026 n°123456'), [
      'echeance',
      'pret',
    ])
  })
})

describe('scoreEntryMatch — fenêtres dures', () => {
  it('rejette un sens différent', () => {
    assert.equal(scoreEntryMatch(entry(), tx({ direction: 'in' })), null)
  })

  it('rejette hors fenêtre de date (> 10 jours)', () => {
    assert.equal(
      scoreEntryMatch(entry(), tx({ transactionDate: utc(2026, 7, 16) })),
      null,
    )
    assert.notEqual(
      scoreEntryMatch(entry(), tx({ transactionDate: utc(2026, 7, 15) })),
      null,
    )
  })

  it('rejette hors fenêtre de montant (ratio < 0,5 ou > 1,5)', () => {
    assert.equal(scoreEntryMatch(entry(), tx({ amountCents: 74000 })), null)
    assert.equal(scoreEntryMatch(entry(), tx({ amountCents: 226000 })), null)
  })

  it('montant exact le jour J passe même sans recouvrement de libellé', () => {
    const score = scoreEntryMatch(entry(), tx({ searchText: 'autre chose' }))
    assert.notEqual(score, null)
    assert.ok((score as number) >= 0.6)
  })

  it('montant exact mais date lointaine exige un libellé qui matche', () => {
    const far = { transactionDate: utc(2026, 7, 14) }
    assert.equal(
      scoreEntryMatch(entry(), tx({ ...far, searchText: 'autre chose' })),
      null,
    )
    assert.notEqual(scoreEntryMatch(entry(), tx(far)), null)
  })

  it('paiement partiel (50 %) exige un libellé qui matche', () => {
    const partial = { amountCents: 75000 }
    assert.equal(
      scoreEntryMatch(entry(), tx({ ...partial, searchText: 'autre chose' })),
      null,
    )
    assert.notEqual(scoreEntryMatch(entry(), tx(partial)), null)
  })
})

describe('suggestEntryMatches — affectation greedy', () => {
  it("une transaction ne réalise qu'une seule échéance (le meilleur score gagne)", () => {
    // Two identical entries compete for one transaction: only one pairing.
    const suggestions = suggestEntryMatches({
      entries: [
        entry({ id: 'e1', date: utc(2026, 7, 5) }),
        entry({ id: 'e2', date: utc(2026, 7, 8) }),
      ],
      transactions: [tx({ id: 't1', transactionDate: utc(2026, 7, 5) })],
    })
    assert.equal(suggestions.length, 1)
    assert.equal(suggestions[0].entryId, 'e1') // same day → best date score
    assert.equal(suggestions[0].transactionId, 't1')
  })

  it("apparie chaque échéance à son candidat et trie par date d'échéance", () => {
    const suggestions = suggestEntryMatches({
      entries: [
        entry({ id: 'rent-aug', date: utc(2026, 8, 5) }),
        entry({
          id: 'salary-jul',
          date: utc(2026, 7, 28),
          amountCents: 320000,
          label: 'Salaires équipe',
        }),
      ],
      transactions: [
        tx({
          id: 'tx-salary',
          transactionDate: utc(2026, 7, 29),
          amountCents: 320000,
          searchText: 'vir salaires equipe juillet',
        }),
        tx({ id: 'tx-rent', transactionDate: utc(2026, 8, 5) }),
      ],
    })
    assert.deepEqual(
      suggestions.map((s) => [s.entryId, s.transactionId]),
      [
        ['salary-jul', 'tx-salary'],
        ['rent-aug', 'tx-rent'],
      ],
    )
  })

  it('aucun candidat plausible → aucune suggestion (jamais de deviné)', () => {
    const suggestions = suggestEntryMatches({
      entries: [entry()],
      transactions: [
        tx({ direction: 'in' }),
        tx({ id: 'tx-2', transactionDate: utc(2026, 6, 1) }),
        tx({ id: 'tx-3', amountCents: 10000 }),
      ],
    })
    assert.deepEqual(suggestions, [])
  })
})
