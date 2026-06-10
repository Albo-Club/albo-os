/**
 * Tests purs de la sérialisation CSV (src/lib/csv.ts).
 *
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toCsv } from '../src/lib/csv'

const BOM = '\uFEFF'

describe('toCsv', () => {
  it('sérialise entêtes + lignes avec séparateur ; et BOM', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['x', 1],
        ['y', 2],
      ],
    )
    assert.equal(csv, `${BOM}a;b\r\nx;1\r\ny;2`)
  })

  it('échappe séparateur, guillemets et retours à la ligne', () => {
    const csv = toCsv(['col'], [['a;b'], ['quote " inside'], ['line\nbreak']])
    assert.equal(
      csv,
      `${BOM}col\r\n"a;b"\r\n"quote "" inside"\r\n"line\nbreak"`,
    )
  })

  it('null et undefined deviennent des cellules vides', () => {
    const csv = toCsv(['a', 'b', 'c'], [[null, undefined, 0]])
    assert.equal(csv, `${BOM}a;b;c\r\n;;0`)
  })
})
