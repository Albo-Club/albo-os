/**
 * Pure tests for the metrics-shape coercion used by Cerveau 1's generateText
 * fallback (convex/lib/reportMetrics.ts). The fallback has no schema to steer
 * the model, so `metrics` comes back as a dict — coerceMetrics normalizes it
 * to the {key,value}[] array the Zod schema expects.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coerceMetrics } from '../convex/lib/reportMetrics'

describe('coerceMetrics', () => {
  it('dict → tableau {key,value}', () => {
    const out = coerceMetrics({ metrics: { revenue: 1000, ebitda: -50 } }) as {
      metrics: Array<{ key: string; value: number }>
    }
    assert.deepEqual(out.metrics, [
      { key: 'revenue', value: 1000 },
      { key: 'ebitda', value: -50 },
    ])
  })

  it('tableau déjà au bon format → inchangé', () => {
    const input = { metrics: [{ key: 'mrr', value: 42 }] }
    const out = coerceMetrics(input) as { metrics: Array<unknown> }
    assert.deepEqual(out.metrics, [{ key: 'mrr', value: 42 }])
  })

  it('valeurs en string avec séparateurs → nombres', () => {
    const out = coerceMetrics({
      metrics: { revenue: '6,366,894', margin: '0.05', arr: '1 200 000 €' },
    }) as { metrics: Array<{ key: string; value: number }> }
    assert.deepEqual(out.metrics, [
      { key: 'revenue', value: 6366894 },
      { key: 'margin', value: 0.05 },
      { key: 'arr', value: 1200000 },
    ])
  })

  it('valeurs non numériques → écartées', () => {
    const out = coerceMetrics({
      metrics: { revenue: 100, note: 'n/a', empty: '' },
    }) as { metrics: Array<{ key: string; value: number }> }
    assert.deepEqual(out.metrics, [{ key: 'revenue', value: 100 }])
  })

  it('non-objet ou metrics absent → passe tel quel', () => {
    assert.equal(coerceMetrics(null), null)
    assert.equal(coerceMetrics('x'), 'x')
    assert.deepEqual(coerceMetrics({ headline: 'hi' }), { headline: 'hi' })
  })
})
