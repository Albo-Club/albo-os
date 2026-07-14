/**
 * Pure tests for the canonical-pitch picker (convex/lib/pitch.ts). The
 * DB-writing helper `applyPitchToDomainGroup` is exercised via Convex, not
 * here.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickCanonicalPitch } from '../convex/lib/pitch'

describe('pickCanonicalPitch', () => {
  it('returns null when no entity has a summary', () => {
    assert.equal(pickCanonicalPitch([{ oneLiner: 'x' }, {}]), null)
  })

  it('picks the pair of the entity with the longest summary', () => {
    const chosen = pickCanonicalPitch([
      { oneLiner: 'court', summary: 'court résumé' },
      { oneLiner: 'long', summary: 'un résumé nettement plus long et complet' },
      { oneLiner: 'moyen', summary: 'résumé moyen' },
    ])
    assert.deepEqual(chosen, {
      oneLiner: 'long',
      summary: 'un résumé nettement plus long et complet',
    })
  })

  it('ignores blank summaries', () => {
    const chosen = pickCanonicalPitch([
      { oneLiner: 'a', summary: '   ' },
      { oneLiner: 'b', summary: 'vrai résumé' },
    ])
    assert.deepEqual(chosen, { oneLiner: 'b', summary: 'vrai résumé' })
  })

  it('keeps the canonical oneLiner even if undefined', () => {
    const chosen = pickCanonicalPitch([{ summary: 'résumé sans one-liner' }])
    assert.deepEqual(chosen, {
      oneLiner: undefined,
      summary: 'résumé sans one-liner',
    })
  })
})
