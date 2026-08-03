/**
 * Pure tests for report identification matching (convex/lib/emailIdentify.ts):
 * whole-word name lookup, the set of participations named in a mail, and the
 * accept/review decision — in particular that a founder forwarding from a
 * personal address still gets matched on the name alone.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acceptIdentification,
  nameAppearsInText,
  namedIdentities,
} from '../convex/lib/emailIdentify'

const PORTFOLIO = [
  { name: 'Sant Roch', domain: 'sant-roch.com' },
  { name: 'Tango', domain: 'tango.fr' },
  { name: 'Resilience', domain: 'resilience.care' },
  { name: 'Eben Home', domain: null },
]

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

describe('namedIdentities', () => {
  it('keeps only the participations actually named', () => {
    const named = namedIdentities(PORTFOLIO, 'Investor update - July', 'Ce mois-ci chez Sant Roch…')
    assert.deepEqual([...named], ['sant-roch.com'])
  })

  it('counts several entities of one participation once (identity = domain)', () => {
    const named = namedIdentities(
      [
        { name: 'Sant Roch', domain: 'sant-roch.com' },
        { name: 'Sant Roch Paris', domain: 'sant-roch.com' },
      ],
      'Update',
      'Sant Roch Paris ouvre un second local',
    )
    assert.equal(named.size, 1)
  })

  it('falls back to the name when the company has no domain', () => {
    const named = namedIdentities(PORTFOLIO, 'Update', 'Des nouvelles de Eben Home ce mois-ci')
    assert.deepEqual([...named], ['eben home'])
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
