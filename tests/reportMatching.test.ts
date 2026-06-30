/**
 * Pure tests for the report matching/period helpers
 * (convex/lib/reportMatching.ts).
 *
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractCompanyDomain,
  extractCompanyNamesFromSubject,
  nameAppearsInText,
  normalizePeriodDisplay,
  parsePeriodToSortMs,
} from '../convex/lib/reportMatching'

describe('extractCompanyDomain', () => {
  it('ignores generic + sender domains, returns the company domain', () => {
    const body = 'Contact: founder@acme.io — sent via noreply@gmail.com'
    assert.equal(extractCompanyDomain(body, 'founder@gmail.com'), 'acme.io')
  })

  it('returns null when only generic/sender domains are present', () => {
    assert.equal(
      extractCompanyDomain('me@gmail.com and you@outlook.com', 'me@gmail.com'),
      null,
    )
  })
})

describe('extractCompanyNamesFromSubject', () => {
  it('strips prefixes + noise words, keeps the company name', () => {
    const names = extractCompanyNamesFromSubject('Fwd: Update Caeli - Confidentiel')
    assert.ok(names.includes('Caeli'))
  })

  it('keeps a multi-word company name and a first-word fallback', () => {
    const names = extractCompanyNamesFromSubject('EUTOPIA CO INVEST | REPORTING Q4 2025')
    assert.ok(names.length >= 1)
    assert.ok(names.some((n) => n.toUpperCase().startsWith('EUTOPIA')))
  })
})

describe('nameAppearsInText', () => {
  it('matches whole word, case-insensitive', () => {
    assert.equal(nameAppearsInText('Caeli', 'le reporting de caeli ce mois'), true)
  })
  it('rejects short names and blocklisted platforms', () => {
    assert.equal(nameAppearsInText('Google', 'envoyé depuis google'), false)
    assert.equal(nameAppearsInText('ab', 'ab cd'), false)
  })
})

describe('parsePeriodToSortMs', () => {
  it('parses "January 2026"', () => {
    assert.equal(parsePeriodToSortMs('January 2026'), Date.UTC(2026, 0, 1))
  })
  it('parses "Q4 2025"', () => {
    assert.equal(parsePeriodToSortMs('Q4 2025'), Date.UTC(2025, 9, 1))
  })
  it('parses a year alone', () => {
    assert.equal(parsePeriodToSortMs('2025'), Date.UTC(2025, 0, 1))
  })
  it('takes the FIRST month/year in a multi-month range', () => {
    assert.equal(
      parsePeriodToSortMs('December 2025 - January 2026'),
      Date.UTC(2025, 11, 1),
    )
  })
  it('uses the provided nowYear for a bare quarter', () => {
    assert.equal(parsePeriodToSortMs('Q1', 2024), Date.UTC(2024, 0, 1))
  })
  it('returns null when unparseable', () => {
    assert.equal(parsePeriodToSortMs('not a period'), null)
  })
})

describe('normalizePeriodDisplay', () => {
  it('normalizes underscores and dash spacing', () => {
    assert.equal(normalizePeriodDisplay('September_-_Q3_2025'), 'September - Q3 2025')
  })
})
