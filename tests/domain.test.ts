/**
 * Pure tests for the domain normaliser (convex/lib/domain.ts): markdown-link
 * unwrapping, protocol/path/query stripping, www removal, and the null cases.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeDomain } from '../convex/lib/domain'

describe('normalizeDomain', () => {
  it('leaves an already-clean bare domain untouched', () => {
    assert.equal(normalizeDomain('anaxago.com'), 'anaxago.com')
    assert.equal(normalizeDomain('good-only.vc'), 'good-only.vc')
    assert.equal(normalizeDomain('fr.qomon.com'), 'fr.qomon.com')
  })

  it('unwraps a markdown link, preferring the url', () => {
    assert.equal(
      normalizeDomain('[www.anaxago.com](https://www.anaxago.com)'),
      'anaxago.com',
    )
    assert.equal(
      normalizeDomain('[www.batch.ventures](https://www.batch.ventures)'),
      'batch.ventures',
    )
  })

  it('strips protocol, path, query and tracking params', () => {
    assert.equal(
      normalizeDomain('monstock.net/fr_fr/?utm_term=mon%20stock&gclid=abc'),
      'monstock.net',
    )
    assert.equal(
      normalizeDomain('bocoloco.fr/?srsltid=AfmBOoo_4bYSC403'),
      'bocoloco.fr',
    )
    assert.equal(normalizeDomain('https://www.rewatt.fr'), 'rewatt.fr')
  })

  it('lowercases and trims', () => {
    assert.equal(normalizeDomain('  WWW.Stripe.COM  '), 'stripe.com')
  })

  it('returns null when it cannot reduce to a hostname', () => {
    assert.equal(normalizeDomain(''), null)
    assert.equal(normalizeDomain('   '), null)
    assert.equal(normalizeDomain('Stripe'), null) // no dot
    assert.equal(normalizeDomain('not a domain'), null) // space
  })
})
