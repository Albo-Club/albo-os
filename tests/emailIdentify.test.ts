/**
 * Pure tests for report identification matching (convex/lib/emailIdentify.ts):
 * whole-word name lookup, the identity rule (what "the same participation"
 * means), the set of participations named in a mail, and the accept/review
 * decision — in particular that a founder forwarding from a personal address
 * still gets matched on the name alone.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acceptIdentification,
  identityKey,
  nameAppearsInText,
  namedIdentities,
  resolveOnSharedDomains,
  sharedDomains,
} from '../convex/lib/emailIdentify'

const PORTFOLIO = [
  { name: 'Sant Roch', domain: 'sant-roch.com' },
  { name: 'Tango', domain: 'tango.fr' },
  { name: 'Resilience', domain: 'resilience.care' },
  { name: 'Eben Home', domain: null },
]

// The ALB-110 case: one sponsor domain, several vehicles — plus the same
// participation held twice (one entity per org) on its own domain.
const SEZAME = [
  { name: 'Sezame Immo 2', domain: 'hellosezame.com' },
  { name: 'Sezame Immo 6', domain: 'hellosezame.com' },
  { name: 'Tango', domain: 'tango.fr' },
  { name: 'TANGO', domain: 'tango.fr' },
]
const SEZAME_SHARED = sharedDomains(SEZAME)

describe('nameAppearsInText', () => {
  it('matches a whole word in the body', () => {
    assert.equal(nameAppearsInText('Sant Roch', 'Investor update', 'Le mois de juin chez Sant Roch'), true)
  })

  it('ignores a name that only appears inside an address or a URL', () => {
    assert.equal(
      nameAppearsInText('Tango', 'Investor update', 'écrivez à lea@tango.fr ou https://tango.fr/blog'),
      false,
    )
  })

  it('does not match a substring of a longer word', () => {
    assert.equal(nameAppearsInText('Hexa', 'Update', 'un rapport hexadécimal'), false)
  })
})

describe('sharedDomains / identityKey', () => {
  it('flags a domain carrying several participations, not a single one', () => {
    assert.deepEqual([...SEZAME_SHARED], ['hellosezame.com'])
  })

  it('identifies by domain when it carries one participation', () => {
    // Same participation held in two orgs, spelled differently → one identity.
    assert.equal(identityKey({ name: 'Tango', domain: 'tango.fr' }, SEZAME_SHARED), 'tango.fr')
    assert.equal(identityKey({ name: 'TANGO', domain: 'tango.fr' }, SEZAME_SHARED), 'tango.fr')
  })

  it('identifies by name on a sponsor domain (the ALB-110 case)', () => {
    assert.equal(
      identityKey({ name: 'Sezame Immo 2', domain: 'hellosezame.com' }, SEZAME_SHARED),
      'sezame immo 2',
    )
    assert.notEqual(
      identityKey({ name: 'Sezame Immo 2', domain: 'hellosezame.com' }, SEZAME_SHARED),
      identityKey({ name: 'Sezame Immo 6', domain: 'hellosezame.com' }, SEZAME_SHARED),
    )
  })

  it('falls back to the name when the company has no domain', () => {
    assert.equal(identityKey({ name: 'Eben Home', domain: null }, new Set()), 'eben home')
  })
})

describe('namedIdentities', () => {
  it('keeps only the participations actually named', () => {
    const named = namedIdentities(
      PORTFOLIO,
      'Investor update - July',
      'Ce mois-ci chez Sant Roch…',
      sharedDomains(PORTFOLIO),
    )
    assert.deepEqual([...named], ['sant-roch.com'])
  })

  it('counts several entities of one participation once (identity = domain)', () => {
    const candidates = [
      { name: 'Sant Roch', domain: 'sant-roch.com' },
      { name: 'Sant Roch', domain: 'sant-roch.com' },
    ]
    const named = namedIdentities(
      candidates,
      'Update',
      'Sant Roch ouvre un second local',
      sharedDomains(candidates),
    )
    assert.equal(named.size, 1)
  })

  it('counts two vehicles of one sponsor as two (they are two participations)', () => {
    const named = namedIdentities(
      SEZAME,
      'Reporting T2',
      'Sezame Immo 2 et Sezame Immo 6 avancent bien',
      SEZAME_SHARED,
    )
    assert.equal(named.size, 2)
  })

  it('falls back to the name when the company has no domain', () => {
    const named = namedIdentities(
      PORTFOLIO,
      'Update',
      'Des nouvelles de Eben Home ce mois-ci',
      sharedDomains(PORTFOLIO),
    )
    assert.deepEqual([...named], ['eben home'])
  })
})

describe('resolveOnSharedDomains', () => {
  const [immo2, immo6, tango] = SEZAME

  it('leaves a non-shared domain pick untouched', () => {
    const resolved = resolveOnSharedDomains(
      [{ candidate: tango, method: 'domain' }],
      SEZAME,
      SEZAME_SHARED,
    )
    assert.deepEqual(resolved, [{ candidate: tango, method: 'domain' }])
  })

  it('keeps the named vehicle when the mail names one', () => {
    const resolved = resolveOnSharedDomains(
      [
        { candidate: immo2, method: 'domain' },
        { candidate: immo6, method: 'domain+name' },
      ],
      SEZAME,
      SEZAME_SHARED,
    )
    assert.deepEqual(resolved, [{ candidate: immo6, method: 'domain+name' }])
  })

  it('puts the whole sponsor domain back in play when no vehicle is named', () => {
    // A single domain-only pick must never be rubber-stamped: the mail is
    // from the sponsor, and which vehicle it covers is unknown.
    const resolved = resolveOnSharedDomains(
      [{ candidate: immo6, method: 'domain' }],
      SEZAME,
      SEZAME_SHARED,
    )
    assert.deepEqual(
      resolved.map(({ candidate }) => candidate.name),
      ['Sezame Immo 2', 'Sezame Immo 6'],
    )
    // → two identity keys → the caller sends the mail to review.
    assert.equal(
      new Set(resolved.map(({ candidate }) => identityKey(candidate, SEZAME_SHARED))).size,
      2,
    )
  })
})

describe('acceptIdentification', () => {
  it('never matches without deterministic corroboration', () => {
    assert.equal(
      acceptIdentification({ corroboratedCount: 0, namedCount: 1, confidence: 'high' }),
      false,
    )
  })

  it('matches a low-confidence pick when the mail names a single participation', () => {
    // The Sant Roch case: founder forwarding from a personal gmail, so domain
    // corroboration is impossible and the model hedges — the name carries it.
    assert.equal(
      acceptIdentification({ corroboratedCount: 1, namedCount: 1, confidence: 'low' }),
      true,
    )
  })

  it('sends a low-confidence pick to review when several participations are named', () => {
    assert.equal(
      acceptIdentification({ corroboratedCount: 1, namedCount: 2, confidence: 'low' }),
      false,
    )
  })

  it('matches a low-confidence pick corroborated by domain only (no name in the mail)', () => {
    assert.equal(
      acceptIdentification({ corroboratedCount: 1, namedCount: 0, confidence: 'low' }),
      true,
    )
  })

  it('keeps matching a confident pick even when several participations are named', () => {
    assert.equal(
      acceptIdentification({ corroboratedCount: 1, namedCount: 3, confidence: 'high' }),
      true,
    )
  })
})
