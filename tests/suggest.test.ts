/**
 * Tests purs du ranking des suggestions de pointage
 * (convex/lib/suggest.ts, outil agent `suggestMatches`).
 *
 * Lancés avec le test runner natif de Node via tsx (aucune dépendance) :
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rankCandidates } from '../convex/lib/suggest'
import type { SimilarTarget } from '../convex/lib/suggest'

const deal = (
  targetId: string,
  label: string,
  committedAmountCents: number | null = null,
): SimilarTarget => ({
  kind: 'deal',
  targetId,
  targetLabel: label,
  committedAmountCents,
})

describe('rankCandidates', () => {
  it('aucune transaction similaire → aucune suggestion', () => {
    const out = rankCandidates({
      txAmountCents: 100_000,
      similarTargets: [],
      decisionsCountByTarget: {},
    })
    assert.deepEqual(out, [])
  })

  it('la fréquence des libellés similaires domine', () => {
    const out = rankCandidates({
      txAmountCents: 100_000,
      similarTargets: [
        deal('d1', 'Sezame'),
        deal('d1', 'Sezame'),
        deal('d2', 'Parallel'),
      ],
      decisionsCountByTarget: {},
    })
    assert.equal(out[0].targetId, 'd1')
    assert.equal(out[0].evidence.similarMatchedCount, 2)
    assert.equal(out[1].targetId, 'd2')
    assert.ok(out[0].score > out[1].score)
  })

  it('les décisions passées départagent à fréquence égale (cap à 5)', () => {
    const out = rankCandidates({
      txAmountCents: 100_000,
      similarTargets: [deal('d1', 'Sezame'), deal('d2', 'Parallel')],
      decisionsCountByTarget: { d1: 100, d2: 1 },
    })
    assert.equal(out[0].targetId, 'd1')
    assert.equal(out[0].evidence.decisionsCount, 100)
    // Cap : 100 décisions ne pèsent pas plus que 5.
    assert.equal(out[0].score, 1 * 3 + 5)
  })

  it('un montant proche du committedAmount (±1 %) donne un bonus', () => {
    const out = rankCandidates({
      txAmountCents: 5_000_000,
      similarTargets: [
        deal('d1', 'Sezame', 5_000_000),
        deal('d2', 'Parallel', 9_000_000),
      ],
      decisionsCountByTarget: {},
    })
    assert.equal(out[0].targetId, 'd1')
    assert.equal(out[0].evidence.amountDeltaCents, 0)
    assert.equal(out[0].score, 3 + 2)
    assert.equal(out[1].score, 3)
  })

  it('cibles passif (equity / C-C) acceptées sans committedAmount', () => {
    const out = rankCandidates({
      txAmountCents: 100_000,
      similarTargets: [
        {
          kind: 'intercompany_loan',
          targetId: 'l1',
          targetLabel: 'CALTE ↔ Albo',
          committedAmountCents: null,
        },
      ],
      decisionsCountByTarget: {},
    })
    assert.equal(out[0].kind, 'intercompany_loan')
    assert.equal(out[0].evidence.amountDeltaCents, null)
  })

  it('au plus 3 candidats, triés par score décroissant', () => {
    const out = rankCandidates({
      txAmountCents: 100_000,
      similarTargets: [
        deal('d1', 'A'),
        deal('d1', 'A'),
        deal('d1', 'A'),
        deal('d2', 'B'),
        deal('d2', 'B'),
        deal('d3', 'C'),
        deal('d4', 'D'),
      ],
      decisionsCountByTarget: {},
    })
    assert.equal(out.length, 3)
    assert.deepEqual(
      out.map((c) => c.targetId),
      ['d1', 'd2', 'd3'],
    )
  })
})
