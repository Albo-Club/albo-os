/**
 * Pure tests for the canonical metric catalog (convex/lib/metricCatalog.ts):
 * deterministic unit conversion to Albo OS storage conventions (EUR cents,
 * basis points) — never delegated to the LLM.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { METRIC_CATALOG, sanitizeKpiTargets, toCanonical } from '../convex/lib/metricCatalog'

describe('toCanonical', () => {
  it('converts EUR magnitudes to cents', () => {
    assert.deepEqual(
      toCanonical({ catalog_key: 'revenue', raw_label: 'CA', value: 1000, unit: 'EUR', period: null }),
      { metricType: 'revenue', value: 100_000, unit: 'EUR_cents' },
    )
    assert.deepEqual(
      toCanonical({ catalog_key: 'revenue', raw_label: 'CA', value: 87, unit: 'kEUR', period: null }),
      { metricType: 'revenue', value: 8_700_000, unit: 'EUR_cents' },
    )
    assert.deepEqual(
      toCanonical({ catalog_key: 'arr', raw_label: 'ARR', value: 1.2, unit: 'MEUR', period: null }),
      { metricType: 'arr', value: 120_000_000, unit: 'EUR_cents' },
    )
  })

  it('converts percentages to basis points', () => {
    assert.deepEqual(
      toCanonical({
        catalog_key: 'ebitda_margin_pct',
        raw_label: '% EBITDA',
        value: 11,
        unit: 'percent',
        period: null,
      }),
      { metricType: 'ebitda_margin_pct', value: 1100, unit: 'bps' },
    )
  })

  it('passes counts and months through', () => {
    assert.deepEqual(
      toCanonical({ catalog_key: 'headcount', raw_label: 'FTE', value: 23, unit: 'count', period: null }),
      { metricType: 'headcount', value: 23, unit: 'count' },
    )
    assert.deepEqual(
      toCanonical({ catalog_key: 'runway_months', raw_label: 'runway', value: 14, unit: 'months', period: null }),
      { metricType: 'runway_months', value: 14, unit: 'months' },
    )
  })

  it('rejects unknown keys and incompatible units (raw snapshot only)', () => {
    // No catalog key → stays raw.
    assert.equal(
      toCanonical({ catalog_key: null, raw_label: 'parking_occupancy', value: 87, unit: 'percent', period: null }),
      null,
    )
    // Hallucinated key → stays raw.
    assert.equal(
      toCanonical({ catalog_key: 'made_up', raw_label: 'x', value: 1, unit: 'count', period: null }),
      null,
    )
    // Percent reported for an EUR metric → stays raw (unit mismatch).
    assert.equal(
      toCanonical({ catalog_key: 'revenue', raw_label: 'CA', value: 15, unit: 'percent', period: null }),
      null,
    )
    // Foreign currency ('other') never lands on an EUR key.
    assert.equal(
      toCanonical({ catalog_key: 'revenue', raw_label: 'revenue USD', value: 100, unit: 'other', period: null }),
      null,
    )
  })

  it('has unique catalog keys', () => {
    const keys = METRIC_CATALOG.map((e) => e.key)
    assert.equal(new Set(keys).size, keys.length)
  })
})

describe('sanitizeKpiTargets', () => {
  it('keeps only catalog keys, deduped, order preserved', () => {
    const out = sanitizeKpiTargets(['gmv', 'burn_rate', 'gmv', 'not_a_key', 'runway_months'])
    assert.deepEqual(out, ['gmv', 'burn_rate', 'runway_months'])
  })

  it('caps the list length', () => {
    const all = METRIC_CATALOG.map((e) => e.key)
    assert.ok(sanitizeKpiTargets(all).length <= 15)
  })

  it('returns empty for garbage input', () => {
    assert.deepEqual(sanitizeKpiTargets(['foo', 'bar']), [])
  })
})
