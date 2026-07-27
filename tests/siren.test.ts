/**
 * Pure tests for the SIREN display formatter (src/lib/siren.ts).
 *
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSiren } from '../src/lib/siren'

describe('formatSiren', () => {
  it('groupe un SIREN de 9 chiffres par 3', () => {
    assert.equal(formatSiren('552178639'), '552 178 639')
  })

  it('reformate un SIREN déjà espacé (espaces ignorés)', () => {
    assert.equal(formatSiren('552 178639'), '552 178 639')
  })

  it('laisse inchangée une valeur qui ne fait pas 9 chiffres', () => {
    assert.equal(formatSiren('12345678'), '12345678')
    assert.equal(formatSiren('1234567890'), '1234567890')
    assert.equal(formatSiren('55217863A'), '55217863A')
  })

  it('null, undefined et vide donnent une chaîne vide', () => {
    assert.equal(formatSiren(null), '')
    assert.equal(formatSiren(undefined), '')
    assert.equal(formatSiren(''), '')
  })
})
