/// <reference types="vite/client" />
/**
 * Regression: the import's idempotency anchor is the PAIR
 * (alboReportId, companyId), not the source uuid alone
 * (convex/migrations/alboReportsImport.ts:importOne).
 *
 * One Albo app row can legitimately belong to several Albo OS companies — a
 * quarterly LP webinar covering four Batch vehicles, a Sezame letter covering
 * two club deals — and the pipeline itself fans a matched email out that way.
 * Keyed on the uuid alone, the "already imported?" guard would answer yes
 * after the first company of the fan-out and drop the rest IN SILENCE: the
 * run would report `already_imported`, not an error, so nothing would show.
 * These tests pin the two halves: the fan-out really writes one row per
 * company, and a re-run is still a no-op on each of them.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

const SOURCE_UUID = '35b53759-b800-416b-a7e4-50ea2d44aa6c'

function importOne(
  t: Harness,
  companyId: Id<'companies'>,
  overrides: { alboReportId?: string; reportPeriod?: string } = {},
) {
  return t.mutation(internal.migrations.alboReportsImport.importOne, {
    alboReportId: overrides.alboReportId ?? SOURCE_UUID,
    companyId,
    allowPeriodCollision: false,
    title: 'Batch Ventures - Quarterly LP Webinar',
    reportPeriod: overrides.reportPeriod ?? 'Q1 2026',
    files: [],
  })
}

describe('alboReportsImport.importOne', () => {
  test('one source report fans out to several companies', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const fundOne = await createPortfolioCompany(t, org.orgId, 'Batch Fund I')
    const fundTwo = await createPortfolioCompany(t, org.orgId, 'Batch Fund II')

    expect((await importOne(t, fundOne)).status).toBe('created')
    expect((await importOne(t, fundTwo)).status).toBe('created')

    const rows = await t.run((ctx) =>
      ctx.db
        .query('companyReports')
        .withIndex('by_albo_report', (q) => q.eq('alboReportId', SOURCE_UUID))
        .collect(),
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.companyId))).toEqual(
      new Set([fundOne, fundTwo]),
    )
  })

  test('re-running is a no-op on each company of the fan-out', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const fundOne = await createPortfolioCompany(t, org.orgId, 'Batch Fund I')
    const fundTwo = await createPortfolioCompany(t, org.orgId, 'Batch Fund II')

    const first = await importOne(t, fundOne)
    await importOne(t, fundTwo)

    const replay = await importOne(t, fundOne)
    expect(replay.status).toBe('already_imported')
    expect(replay.reportId).toBe(first.reportId)

    const rows = await t.run((ctx) =>
      ctx.db
        .query('companyReports')
        .withIndex('by_albo_report', (q) => q.eq('alboReportId', SOURCE_UUID))
        .collect(),
    )
    expect(rows).toHaveLength(2)
  })

  test('the anchor wins over the period slot, so a replay never duplicates', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const company = await createPortfolioCompany(t, org.orgId, 'Corma')

    await importOne(t, company, { reportPeriod: 'Q1 2026' })
    // A DIFFERENT source row landing on the same (company, period) slot is
    // skipped, not written: the historical import never overwrites.
    const other = await importOne(t, company, {
      alboReportId: 'aa24803c-bf85-4b00-8dbf-e289acaec4d4',
      reportPeriod: 'Q1 2026',
    })
    expect(other.status).toBe('period_taken')

    const rows = await t.run((ctx) =>
      ctx.db
        .query('companyReports')
        .withIndex('by_company', (q) => q.eq('companyId', company))
        .collect(),
    )
    expect(rows).toHaveLength(1)
  })
})
