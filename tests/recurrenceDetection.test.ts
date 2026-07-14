/**
 * Pure tests for the recurring-flow detection engine
 * (convex/lib/recurrenceDetection.ts). Run via `pnpm test:unit`
 * (node:test + tsx, deliberately outside convex/).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectFrequency,
  detectRecurringFlows,
} from '../convex/lib/recurrenceDetection'
import type { DetectionTx } from '../convex/lib/recurrenceDetection'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

const tx = (over: Partial<DetectionTx> = {}): DetectionTx => ({
  transactionDate: utc(2026, 1, 5),
  amountCents: 150000,
  direction: 'out',
  rawLabel: 'PRLV SEPA LOYER SCI CHAPELLE REF 123456',
  counterparty: 'SCI Chapelle',
  category: 'rent',
  ...over,
})

/** N monthly occurrences of the same flow, day 5, from Jan 2026. */
function monthlySeries(count: number, over: Partial<DetectionTx> = {}) {
  return Array.from({ length: count }, (_, i) =>
    tx({ transactionDate: utc(2026, 1 + i, 5), ...over }),
  )
}

describe('detectFrequency — régularité des intervalles', () => {
  it('reconnaît un mensuel propre (jour fixe)', () => {
    const dates = [1, 2, 3, 4, 5, 6].map((m) => utc(2026, m, 5))
    assert.equal(detectFrequency(dates), 'monthly')
  })

  it('tolère une occurrence manquée (un trou de 2 mois)', () => {
    // Jan..Jun day 5, April missing: intervals 31,28,61,31 — median stays ~monthly.
    const dates = [utc(2026, 1, 5), utc(2026, 2, 5), utc(2026, 3, 5), utc(2026, 5, 5), utc(2026, 6, 5)]
    assert.equal(detectFrequency(dates), 'monthly')
  })

  it('reconnaît un trimestriel et un hebdo', () => {
    assert.equal(
      detectFrequency([utc(2026, 1, 15), utc(2026, 4, 15), utc(2026, 7, 14)]),
      'quarterly',
    )
    assert.equal(
      detectFrequency([utc(2026, 6, 1), utc(2026, 6, 8), utc(2026, 6, 15), utc(2026, 6, 22)]),
      'weekly',
    )
  })

  it('rejette un espacement irrégulier', () => {
    assert.equal(
      detectFrequency([utc(2026, 1, 5), utc(2026, 1, 20), utc(2026, 4, 2), utc(2026, 4, 11)]),
      null,
    )
  })
})

describe('detectRecurringFlows — suggestions de règles', () => {
  it('suggère une règle mensuelle avec montant médian, anchorDay et catégorie majoritaire', () => {
    const out = detectRecurringFlows({
      transactions: monthlySeries(6),
      existingRules: [],
      dismissed: [],
    })
    assert.equal(out.length, 1)
    const s = out[0]
    assert.equal(s.frequency, 'monthly')
    assert.equal(s.anchorDay, 5)
    assert.equal(s.amountCents, 150000)
    assert.equal(s.direction, 'out')
    assert.equal(s.category, 'rent')
    assert.equal(s.label, 'SCI Chapelle')
    assert.equal(s.occurrences, 6)
    assert.equal(s.startDate, utc(2026, 6, 5))
    assert.deepEqual(s.lastDates, [utc(2026, 6, 5), utc(2026, 5, 5), utc(2026, 4, 5)])
  })

  it('exige au moins 3 occurrences', () => {
    const out = detectRecurringFlows({
      transactions: monthlySeries(2),
      existingRules: [],
      dismissed: [],
    })
    assert.deepEqual(out, [])
  })

  it('rejette un groupe aux montants instables (> ±30 % de la médiane)', () => {
    const txs = monthlySeries(4)
    txs[0] = { ...txs[0], amountCents: 500000 }
    const out = detectRecurringFlows({
      transactions: txs,
      existingRules: [],
      dismissed: [],
    })
    assert.deepEqual(out, [])
  })

  it('ignore ignored/internal (category null) et les patterns vides', () => {
    const out = detectRecurringFlows({
      transactions: [
        ...monthlySeries(4, { category: null }),
        // all-numeric label + no counterparty → no stable pattern
        ...monthlySeries(4, { counterparty: null, rawLabel: '20260105 000123' }),
      ],
      existingRules: [],
      dismissed: [],
    })
    assert.deepEqual(out, [])
  })

  it('déduplique contre une règle active équivalente (±15 %) mais pas inactive', () => {
    const base = {
      transactions: monthlySeries(5),
      dismissed: [],
    }
    const covered = detectRecurringFlows({
      ...base,
      existingRules: [
        { direction: 'out', frequency: 'monthly', amountCents: 160000, active: true },
      ],
    })
    assert.deepEqual(covered, [])

    const inactive = detectRecurringFlows({
      ...base,
      existingRules: [
        { direction: 'out', frequency: 'monthly', amountCents: 160000, active: false },
      ],
    })
    assert.equal(inactive.length, 1)
  })

  it('respecte les suggestions ignorées (pattern + direction)', () => {
    const out = detectRecurringFlows({
      transactions: monthlySeries(5),
      existingRules: [],
      dismissed: [{ pattern: 'sci chapelle', direction: 'out' }],
    })
    assert.deepEqual(out, [])
  })

  it('sépare les groupes par direction et trie par montant décroissant', () => {
    const out = detectRecurringFlows({
      transactions: [
        ...monthlySeries(4),
        ...monthlySeries(4, {
          direction: 'in',
          rawLabel: 'VIR SEPA DIVIDENDE OPRTRS',
          counterparty: 'OPRTRS',
          amountCents: 800000,
          category: 'investment_income',
        }),
      ],
      existingRules: [],
      dismissed: [],
    })
    assert.deepEqual(
      out.map((s) => [s.direction, s.amountCents]),
      [
        ['in', 800000],
        ['out', 150000],
      ],
    )
  })
})
