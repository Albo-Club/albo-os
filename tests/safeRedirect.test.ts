/**
 * Open-redirect guard for the `?redirect=` return-URL (src/lib/safe-redirect.ts).
 *
 * Imports the module actually shipped to the routes, so a regression in the
 * predicate fails here. The tab/LF/CR vectors are the interesting ones: the
 * WHATWG URL parser strips those characters, so a byte-level check would let
 * `/<TAB>/evil.com` through as `//evil.com` (see KNOWN_ISSUES.md).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  internalRedirectSearch,
  isInternalPath,
} from '../src/lib/safe-redirect'

const parse = (value: unknown) => internalRedirectSearch.parse(value)

const HOSTILE = [
  'https://evil.com',
  'http://evil.com',
  'HTTPS://EVIL.COM',
  'https:/evil.com',
  '//evil.com',
  '///evil.com',
  '/\\evil.com',
  '\\/evil.com',
  '\\\\evil.com',
  'javascript:alert(1)',
  'data:text/html,x',
  'mailto:a@b.c',
  '/\t/evil.com',
  '/\n/evil.com',
  '/\r/evil.com',
  '',
  'app',
  '  /app',
]

const SAFE = [
  '/app',
  '/app/calte/deals',
  '/app?x=1#y',
  '/',
  '/%2f%2fevil.com',
  '/accept-invite/tok_123',
]

describe('safe-redirect', () => {
  it('neutralises hostile return-URLs to undefined', () => {
    for (const value of HOSTILE) {
      assert.equal(
        isInternalPath(value),
        false,
        `isInternalPath(${JSON.stringify(value)})`,
      )
      assert.equal(parse(value), undefined, `parse(${JSON.stringify(value)})`)
    }
  })

  it('preserves internal paths verbatim', () => {
    for (const value of SAFE) {
      assert.equal(
        isInternalPath(value),
        true,
        `isInternalPath(${JSON.stringify(value)})`,
      )
      assert.equal(parse(value), value, `parse(${JSON.stringify(value)})`)
    }
  })

  it('leaves an absent param absent', () => {
    assert.equal(parse(undefined), undefined)
  })

  it('rejects a non-string without throwing', () => {
    assert.equal(parse(42), undefined)
  })
})
