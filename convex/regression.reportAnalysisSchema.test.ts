/**
 * Regression: a report survives whatever the model says (lib/reportAnalysis).
 *
 * Two reports (GOODVEST, WIND CAPITAL 2) were lost on two successive
 * variations of one and the same defect — the schema demanded of a text
 * generator the exactness of a form, and rejected the WHOLE report on any
 * deviation. First variation: the model omitted `metrics[].period` instead of
 * writing null (a bare `.nullable()` still requires the key). Second:
 * `report_type: "half-year"`, the right rhythm in other words.
 *
 * The two entry points are pinned separately because they are not the same
 * contract. `analysisSchema` is what constrains the model in the nominal
 * `generateObject` path and must stay strict; `parseLenient` reads the
 * fallback path, where nothing constrains it and a deviation is normal.
 *
 * What matters below: nothing the model can write costs more than the field
 * it was written in — except an answer with neither title nor headline, the
 * single case with no sheet to store.
 */
import { describe, expect, it } from 'vitest'
import {
  analysisSchema,
  looseNumber,
  normalizeReportType,
  normalizeUnit,
  parseLenient,
} from './lib/reportAnalysis'

describe('analysisSchema — the strict contract', () => {
  it('reads an omitted optional key as null rather than failing', () => {
    const parsed = analysisSchema.safeParse({
      title: 'Update Q4 2025',
      headline: 'Croissance soutenue',
      key_highlights: ['ARR en hausse'],
      // No `report_period`, no `report_type`, and a metric without `period`
      // nor `catalog_key` — as a model writes it when it has nothing to say.
      metrics: [{ raw_label: 'ARR', value: 1.2, unit: 'MEUR' }],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.report_period).toBeNull()
    expect(parsed.data.report_type).toBeNull()
    expect(parsed.data.metrics[0].period).toBeNull()
    expect(parsed.data.metrics[0].catalog_key).toBeNull()
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

describe('normalizeReportType', () => {
  it('maps the wording that lost WIND CAPITAL 2', () => {
    expect(normalizeReportType('half-year')).toBe('semi-annual')
  })

  it('maps the other rhythms models write', () => {
    expect(normalizeReportType('Semi-Annual')).toBe('semi-annual')
    expect(normalizeReportType('biannual')).toBe('semi-annual')
    expect(normalizeReportType('yearly')).toBe('annual')
    expect(normalizeReportType('quarter')).toBe('quarterly')
    expect(normalizeReportType('mensuel')).toBe('monthly')
  })

  it('reads an unknown rhythm as null instead of failing', () => {
    expect(normalizeReportType('every other tuesday')).toBeNull()
    expect(normalizeReportType(undefined)).toBeNull()
  })
})

describe('normalizeUnit', () => {
  it('maps currency symbols and spellings', () => {
    expect(normalizeUnit('k€')).toBe('kEUR')
    expect(normalizeUnit('M€')).toBe('MEUR')
    expect(normalizeUnit('euros')).toBe('EUR')
    expect(normalizeUnit('%')).toBe('percent')
  })

  it('falls back to "other" — which toCanonical refuses — rather than guess', () => {
    expect(normalizeUnit('USD')).toBe('other')
    expect(normalizeUnit(42)).toBe('other')
  })
})

describe('looseNumber', () => {
  it('reads a number written as the model wrote it', () => {
    expect(looseNumber(1200)).toBe(1200)
    expect(looseNumber('1 200')).toBe(1200)
    expect(looseNumber('1,2')).toBe(1.2)
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(looseNumber('beaucoup')).toBeNull()
    expect(looseNumber('')).toBeNull()
    expect(looseNumber(Number.NaN)).toBeNull()
  })
})

describe('parseLenient — the fallback read', () => {
  it('normalizes the rhythm and the units instead of rejecting the report', () => {
    const parsed = parseLenient({
      title: 'H1 2026',
      headline: 'Semestre en ligne',
      key_highlights: ['ARR x2'],
      report_period: 'S1 2026',
      report_type: 'half-year',
      metrics: [{ raw_label: 'ARR', value: '1,2', unit: 'M€', catalog_key: 'revenue' }],
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.report_type).toBe('semi-annual')
    expect(parsed?.metrics[0]).toMatchObject({ value: 1.2, unit: 'MEUR', period: null })
  })

  it('drops an unreadable metric alone and keeps the rest of the report', () => {
    const parsed = parseLenient({
      title: 'Update',
      headline: 'Résumé',
      metrics: [
        { raw_label: 'ARR', value: 1.2, unit: 'MEUR' },
        { raw_label: 'Churn', value: 'beaucoup', unit: 'percent' }, // unreadable
        { value: 23, unit: 'count' }, // no label
        { raw_label: 'Headcount', value: 23, unit: 'count' },
      ],
    })

    expect(parsed?.metrics.map((m) => m.raw_label)).toEqual(['ARR', 'Headcount'])
  })

  it('fills the missing one of title / headline from the other', () => {
    const parsed = parseLenient({ headline: 'Ouverture de la liquidation', metrics: [] })

    expect(parsed?.title).toBe('Ouverture de la liquidation')
    expect(parsed?.headline).toBe('Ouverture de la liquidation')
  })

  it('fails only when there is no sheet to store at all', () => {
    expect(parseLenient({ metrics: [{ raw_label: 'ARR', value: 1 }] })).toBeNull()
    expect(parseLenient('not an object')).toBeNull()
    expect(parseLenient(null)).toBeNull()
  })
})
