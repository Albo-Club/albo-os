/**
 * Pure tests for the backup rotation (scripts/lib/backup-retention.mjs).
 *
 * This function drives DELETIONS on the backup bucket, so the cases that
 * matter most are the ones where it must NOT drop something: a stray file, a
 * gap in the schedule, the only full archive left.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_POLICY,
  isoWeekKey,
  parseArchiveName,
  planRetention,
} from '../scripts/lib/backup-retention.mjs'

const daily = (date: string) => `albo-os-${date}.zip`
const full = (date: string) => `albo-os-${date}-full.zip`

describe('isoWeekKey', () => {
  it('groups a Sunday with the Monday that opened its week', () => {
    assert.equal(isoWeekKey('2026-09-07'), isoWeekKey('2026-09-13')) // Mon → Sun
    assert.notEqual(isoWeekKey('2026-09-13'), isoWeekKey('2026-09-20'))
  })

  it('rolls the year over the way ISO-8601 says, not the calendar', () => {
    // 01/01/2027 is a Friday: it belongs to the last week of 2026.
    assert.equal(isoWeekKey('2027-01-01'), '2026-W53')
    assert.equal(isoWeekKey('2027-01-04'), '2027-W01')
  })
})

describe('parseArchiveName', () => {
  it('reads the date and the kind', () => {
    assert.deepEqual(parseArchiveName('albo-os-2026-09-13-full.zip'), {
      name: 'albo-os-2026-09-13-full.zip',
      date: '2026-09-13',
      full: true,
    })
    assert.equal(parseArchiveName('albo-os-2026-09-14.zip')?.full, false)
  })

  it('refuses anything it did not write', () => {
    assert.equal(parseArchiveName('notes.txt'), null)
    assert.equal(parseArchiveName('albo-os-2026-09-13.zip.part'), null)
    assert.equal(parseArchiveName('albo-backup-2026-09-13.zip'), null)
    // Well-formed but impossible — would sort and bucket wrong.
    assert.equal(parseArchiveName('albo-os-2026-02-31.zip'), null)
  })
})

describe('planRetention', () => {
  it('keeps the 7 most recent dailies and drops the 8th', () => {
    const names = Array.from({ length: 10 }, (_, i) => daily(`2026-09-${String(i + 1).padStart(2, '0')}`))
    const { keep, drop } = planRetention(names)
    assert.equal(keep.length, 7)
    assert.equal(keep[0], daily('2026-09-10'))
    assert.deepEqual(drop, [daily('2026-09-03'), daily('2026-09-02'), daily('2026-09-01')])
  })

  it('holds a full archive per week beyond the daily horizon', () => {
    // Four Sundays, each outside the 7-day window, plus 7 recent dailies.
    const sundays = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map(full)
    const recent = Array.from({ length: 7 }, (_, i) => daily(`2026-09-${String(i + 10).padStart(2, '0')}`))
    const { keep } = planRetention([...sundays, ...recent])
    for (const s of sundays) assert.ok(keep.includes(s), `${s} devrait être gardée`)
  })

  it('never lets a data-only archive hold a weekly or monthly slot', () => {
    // A restore point a week old with no files is not a restore point.
    const old = daily('2026-01-11')
    const { drop } = planRetention([old, ...Array.from({ length: 7 }, (_, i) => daily(`2026-09-0${i + 1}`))])
    assert.ok(drop.includes(old))
  })

  it('keeps 12 monthly fulls and drops the 13th', () => {
    const monthly = Array.from({ length: 14 }, (_, i) =>
      full(`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`),
    )
    const { keep, drop } = planRetention(monthly)
    // 14 archives, all in distinct months: 12 monthly slots, and the 7 most
    // recent are dailies too — so exactly the 2 oldest go.
    assert.equal(drop.length, 2)
    assert.deepEqual(drop, [full('2025-02-01'), full('2025-01-01')])
    assert.ok(keep.includes(full('2026-02-01')))
  })

  it('survives a gap: horizons count archives present, not calendar weeks', () => {
    // Backups stopped for two months. Everything left must stay — deleting
    // "too old" backups when they are the only ones left is the worst bug
    // this function could have.
    const stale = ['2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24'].map(full)
    const { keep, drop } = planRetention(stale)
    assert.deepEqual(drop, [])
    assert.equal(keep.length, 4)
  })

  it('reports unknown names and never drops them', () => {
    const names = [daily('2026-09-10'), 'README.md', 'albo-backup-old.zip']
    const { drop, unknown } = planRetention(names)
    assert.deepEqual(drop, [])
    assert.deepEqual(unknown, ['README.md', 'albo-backup-old.zip'])
  })

  it('prefers the full archive when both kinds share a date', () => {
    const { keep } = planRetention([daily('2026-09-13'), full('2026-09-13')], {
      ...DEFAULT_POLICY,
      daily: 1,
    })
    assert.deepEqual(keep, [full('2026-09-13')])
  })

  it('drops nothing on an empty bucket', () => {
    assert.deepEqual(planRetention([]), { keep: [], drop: [], unknown: [] })
  })
})
