/**
 * Regression: a report must not be rejected because the model omitted an
 * optional key (convex/reportStore.ts:analysisSchema).
 *
 * Two GOODVEST / WIND CAPITAL 2 reports were lost this way. The nominal path
 * is `generateObject`, which constrains the model to the schema; when it
 * fails, the fallback asks for free JSON and validates it here. A model
 * answering in free JSON omits a key it has nothing to put in rather than
 * writing `"period": null` — and `metrics[].period` is, by definition, absent
 * from almost every metric (it only exists when a metric covers a period
 * other than the report's). A bare `.nullable()` requires the KEY, so that
 * absence rejected the whole report — every other metric with it.
 *
 * What is pinned: an omitted optional key reads as null, and a genuinely
 * missing REQUIRED field still fails (the fix must not turn the guard off).
 */
import { describe, expect, it } from 'vitest'
import { analysisSchema } from './reportStore'

describe('analysisSchema — omitted optional keys', () => {
  it('reads an omitted metric period / catalog_key as null', () => {
    const parsed = analysisSchema.safeParse({
      title: 'Update Q4 2025',
      headline: 'Croissance soutenue',
      key_highlights: ['ARR en hausse'],
      report_period: 'Q4 2025',
      report_type: 'quarterly',
      // As the model writes it in free JSON: no `period`, no `catalog_key`.
      metrics: [{ raw_label: 'ARR', value: 1.2, unit: 'MEUR' }],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.metrics[0].period).toBeNull()
    expect(parsed.data.metrics[0].catalog_key).toBeNull()
  })

  it('reads an omitted report_period / report_type as null', () => {
    const parsed = analysisSchema.safeParse({
      title: 'Notification de liquidation',
      headline: 'Ouverture de la procédure',
      key_highlights: ['Liquidation judiciaire prononcée'],
      metrics: [],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.report_period).toBeNull()
    expect(parsed.data.report_type).toBeNull()
  })

  it('still rejects a metric missing a required field', () => {
    const parsed = analysisSchema.safeParse({
      title: 'Update',
      headline: 'Résumé',
      key_highlights: [],
      metrics: [{ raw_label: 'ARR', unit: 'MEUR' }], // no `value`
    })

    expect(parsed.success).toBe(false)
  })
})
