/**
 * Pure tests for the company-name comparison key used by the MCP write tools
 * (convex/lib/duplicates.ts): accents, punctuation and legal-suffix folding,
 * plus the pairs that must NOT collide.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCompanyName } from '../convex/lib/duplicates'

describe('normalizeCompanyName', () => {
  it('folds case, accents and punctuation', () => {
    assert.equal(normalizeCompanyName('Sezame'), 'sezame')
    assert.equal(normalizeCompanyName('  SEZAME  '), 'sezame')
    assert.equal(normalizeCompanyName('Éco-Vélo'), 'eco velo')
    assert.equal(normalizeCompanyName('Yes&Co'), 'yes co')
  })

  it('drops the legal suffix so the same company collides', () => {
    const key = normalizeCompanyName('Sezame')
    assert.equal(normalizeCompanyName('Sezame SAS'), key)
    assert.equal(normalizeCompanyName('SEZAME S.A.S.'), key)
    assert.equal(normalizeCompanyName('Sezame sarl'), key)
    assert.equal(normalizeCompanyName('Sezame Ltd'), key)
  })

  it('keeps distinct companies distinct', () => {
    assert.notEqual(
      normalizeCompanyName('Sezame'),
      normalizeCompanyName('Sezam'),
    )
    assert.notEqual(
      normalizeCompanyName('Relais Chapelle'),
      normalizeCompanyName('SCI Chapelle 1'),
    )
  })

  it('returns an empty key when there is nothing left to compare', () => {
    assert.equal(normalizeCompanyName(''), '')
    assert.equal(normalizeCompanyName('   '), '')
    // A bare legal form carries no identity — must not match every company.
    assert.equal(normalizeCompanyName('SAS'), '')
  })
})
