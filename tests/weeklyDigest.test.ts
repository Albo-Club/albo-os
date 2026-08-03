/**
 * Pure tests for the weekly digest routing (convex/lib/weeklyDigest.ts), the
 * core of `forecasts.sendWeeklyDigest`: which blocks of which orgs end up in
 * a given member's Monday mail, given their alert prefs.
 *
 * The DB gathering around it (cron, org scan, Resend send) needs a running
 * deployment and is covered by the manual checklist in TESTING.md — these
 * tests pin the decision logic.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sectionsFor } from '../convex/lib/weeklyDigest'
import type { OrgFinding } from '../convex/lib/weeklyDigest'

const CASH: NonNullable<OrgFinding['cash']> = {
  thresholdCents: 5_000_000,
  minProjectedCents: 1_200_000,
  cashUrl: 'https://app.test/app/calte/cash',
}

const OVERDUE: NonNullable<OrgFinding['overdue']> = {
  entries: [
    { date: 1, label: 'Loyer SCI', direction: 'out', amountCents: 250_000 },
    { date: 2, label: 'Honoraires', direction: 'in', amountCents: 90_000 },
  ],
  forecastUrl: 'https://app.test/app/calte/cash?filter=unmatched',
}

const REPORTS: NonNullable<OrgFinding['reports']> = { count: 4 }

const BOTH: OrgFinding = {
  orgName: 'Calte',
  cash: CASH,
  overdue: OVERDUE,
  reports: null,
}
const ALL_ON = {
  cashThreshold: true,
  overdueEntries: true,
  weeklyReports: true,
}

describe('sectionsFor', () => {
  it('keeps both blocks when the member subscribes to everything', () => {
    const [section] = sectionsFor([BOTH], ALL_ON)
    assert.equal(section.orgName, 'Calte')
    assert.deepEqual(section.cash, CASH)
    assert.deepEqual(section.overdue, OVERDUE)
  })

  it('drops the muted block but keeps the org and the other one', () => {
    const [section] = sectionsFor([BOTH], {
      ...ALL_ON,
      overdueEntries: false,
    })
    assert.deepEqual(section.cash, CASH)
    assert.equal(section.overdue, null)
  })

  it('drops the org entirely when every one of its blocks is muted', () => {
    assert.deepEqual(
      sectionsFor(
        [{ orgName: 'Calte', cash: CASH, overdue: null, reports: null }],
        { ...ALL_ON, cashThreshold: false },
      ),
      [],
    )
  })

  it('returns nothing when the member muted every block — no mail at all', () => {
    assert.deepEqual(
      sectionsFor(
        [
          BOTH,
          {
            orgName: 'Albo',
            cash: CASH,
            overdue: OVERDUE,
            reports: REPORTS,
          },
        ],
        {
          cashThreshold: false,
          overdueEntries: false,
          weeklyReports: false,
        },
      ),
      [],
    )
  })

  it('carries one section per org, in the order they were found', () => {
    const sections = sectionsFor(
      [BOTH, { orgName: 'Albo', cash: null, overdue: OVERDUE, reports: null }],
      ALL_ON,
    )
    assert.deepEqual(
      sections.map((s) => s.orgName),
      ['Calte', 'Albo'],
    )
    assert.equal(sections[1].cash, null)
  })

  it('sends nothing when no org has anything to report', () => {
    assert.deepEqual(sectionsFor([], ALL_ON), [])
  })
})

describe('sectionsFor — the weekly report count', () => {
  const ONLY_REPORTS: OrgFinding = {
    orgName: 'Calte',
    cash: null,
    overdue: null,
    reports: REPORTS,
  }

  it('carries the count when the member subscribes to it', () => {
    const [section] = sectionsFor([ONLY_REPORTS], ALL_ON)
    assert.deepEqual(section.reports, REPORTS)
  })

  it('is enough on its own to send the digest', () => {
    assert.equal(sectionsFor([ONLY_REPORTS], ALL_ON).length, 1)
  })

  it('never re-arms the Monday mail for someone who muted it', () => {
    assert.deepEqual(
      sectionsFor([ONLY_REPORTS], { ...ALL_ON, weeklyReports: false }),
      [],
    )
  })

  it('drops out without taking the other blocks with it', () => {
    const [section] = sectionsFor([{ ...BOTH, reports: REPORTS }], {
      ...ALL_ON,
      weeklyReports: false,
    })
    assert.equal(section.reports, null)
    assert.deepEqual(section.cash, CASH)
    assert.deepEqual(section.overdue, OVERDUE)
  })
})
