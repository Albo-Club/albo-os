/**
 * Pure tests for report link detection (convex/lib/reportLinks.ts):
 * Notion domains (notion.so, *.notion.site, notion.com share links).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectLinks } from '../convex/lib/reportLinks'

describe('detectLinks — notion', () => {
  it('detects legacy notion.so links', () => {
    const { notion } = detectLinks(
      'update ici : https://www.notion.so/acme/Q1-2026-0123456789abcdef0123456789abcdef',
    )
    assert.equal(notion.length, 1)
  })

  it('detects public *.notion.site links', () => {
    const { notion } = detectLinks('voir https://acme.notion.site/Q1-Update-311990bc334980cc87d6cafd06d29960')
    assert.equal(notion.length, 1)
  })

  it('detects notion.com share links (current domain, e.g. app.notion.com/p/…)', () => {
    const url =
      'https://app.notion.com/p/jointango/Tango-Investor-Update-311990bc334980cc87d6cafd06d29960?source=copy_link#395990bc3349800f8c84eb7ed592fbdb'
    const { notion } = detectLinks(`Voici l'update Q2 2026 : lien. ${url}`)
    assert.equal(notion.length, 1)
    assert.ok(notion[0].includes('311990bc334980cc87d6cafd06d29960'))
  })

  it('ignores notion.com marketing pages (no 32-hex page id)', () => {
    const { notion } = detectLinks('découvrez https://www.notion.com/pricing et https://notion.com/blog')
    assert.equal(notion.length, 0)
  })
})
