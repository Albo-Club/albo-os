/**
 * Pure tests for the Airtable → échéances planning
 * (convex/lib/airtableForecasts.ts).
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
  RULE_DUPLICATE_ROWS,
  airtableDerivedKey,
  findInternalDuplicates,
  planForecastImport,
} from '../convex/lib/airtableForecasts'
import type { ForecastSourceRow } from '../convex/lib/airtableForecasts'

const DAY = Date.UTC(2026, 8, 30)

const row = (over: Partial<ForecastSourceRow> = {}): ForecastSourceRow => ({
  airtableId: 'recAAAAAAAAAAAAAA',
  direction: 'in',
  amountCents: 150000,
  dateMs: DAY,
  label: 'Anaxago - Rue Pauline',
  ...over,
})

describe('planForecastImport', () => {
  it('keeps a complete row and trims its label', () => {
    const { entries, skipped } = planForecastImport([
      row({ label: 'Flexliving CCA ' }),
    ])
    assert.equal(skipped.length, 0)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].label, 'Flexliving CCA')
    assert.equal(entries[0].amountCents, 150000)
    assert.equal(entries[0].dateMs, DAY)
  })

  it('takes the direction from the table, not from the sign', () => {
    // The « sortie » table holds a few positive cells; the pull already
    // absolutized them, and the table of origin decides.
    const { entries } = planForecastImport([
      row({
        direction: 'out',
        amountCents: 26800000,
        label: 'Banco 2 intérêt 2028',
      }),
    ])
    assert.equal(entries[0].direction, 'out')
    assert.equal(entries[0].amountCents, 26800000)
  })

  it('imports past-dated rows (they become overdue, not invisible)', () => {
    const { entries, skipped } = planForecastImport([
      row({ dateMs: Date.UTC(2026, 6, 15), label: 'ALBO - 6eme tranche' }),
    ])
    assert.equal(skipped.length, 0)
    assert.equal(entries.length, 1)
  })

  it('drops a row already covered by a recurring rule', () => {
    const { entries, skipped } = planForecastImport([
      row({ airtableId: 'rec2rTewky7euJAhF', label: 'Iroko' }),
      row({ airtableId: 'rec66NtasXI871wGk', label: 'Wormser prévisionel ' }),
    ])
    assert.equal(entries.length, 0)
    assert.equal(skipped.length, 2)
    assert.ok(skipped.every((s) => s.reason === 'duplicate_of_rule'))
  })

  it('imports a known id whose label no longer matches', () => {
    // Guard against a reused Airtable record silently vanishing.
    const { entries, skipped } = planForecastImport([
      row({ airtableId: 'rec2rTewky7euJAhF', label: 'Autre chose' }),
    ])
    assert.equal(skipped.length, 0)
    assert.equal(entries.length, 1)
  })

  it('drops rows with no usable amount or no date', () => {
    const { entries, skipped } = planForecastImport([
      row({ airtableId: 'recNoAmount000001', amountCents: undefined }),
      row({ airtableId: 'recZeroAmount0001', amountCents: 0 }),
      row({ airtableId: 'recNoDate00000001', dateMs: undefined }),
    ])
    assert.equal(entries.length, 0)
    assert.deepEqual(
      skipped.map((s) => s.reason),
      ['no_amount', 'no_amount', 'no_date'],
    )
  })

  it('falls back to a placeholder label on an empty name', () => {
    const { entries } = planForecastImport([row({ label: '   ' })])
    assert.equal(entries[0].label, '(prévisionnel)')
  })

  it('exclusion labels are stored trimmed', () => {
    for (const label of Object.values(RULE_DUPLICATE_ROWS)) {
      assert.equal(label, label.trim())
    }
  })
})

describe('airtableDerivedKey', () => {
  it('namespaces the record id', () => {
    assert.equal(airtableDerivedKey('recABC'), 'airtable:recABC')
  })
})

describe('findInternalDuplicates', () => {
  it('groups rows restating the same money', () => {
    // The real case: « Weefin secondaire » 12 535 € and « 2nd tranche
    // secondaire » 12 535,46 €, same day, same direction.
    const { entries } = planForecastImport([
      row({
        airtableId: 'recs6xNUlMKD6tVUX',
        amountCents: 1253500,
        label: 'Weefin secondaire',
      }),
      row({
        airtableId: 'recWDYJoZygqn01rc',
        amountCents: 1253546,
        label: '2nd tranche secondaire',
      }),
      row({
        airtableId: 'recOther000000001',
        amountCents: 999900,
        label: 'Autre',
      }),
    ])
    const groups = findInternalDuplicates(entries)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].length, 2)
  })

  it('does not group across directions', () => {
    const { entries } = planForecastImport([
      row({ airtableId: 'recIn0000000000001', direction: 'in' }),
      row({ airtableId: 'recOut000000000001', direction: 'out' }),
    ])
    assert.equal(findInternalDuplicates(entries).length, 0)
  })
})
