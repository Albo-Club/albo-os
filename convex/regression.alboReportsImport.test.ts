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

/**
 * Regression: the VASCO overlap audit
 * (convex/migrations/alboReportsImport.ts:auditVascoOverlap).
 *
 * A fiche merges two tables in one timeline — `companyReports` and
 * `vascoCommunicationsCache` — and no unicity guard spans them. The audit is
 * what makes that overlap readable before anyone arbitrates it, so what it
 * must never do is miss a side: an entity served by both channels has to
 * surface, an entity linked to a portal that holds NOTHING has to surface too
 * (there the backlog is missing, not duplicated), and communications belonging
 * to another issuer must never be counted as this entity's.
 */
describe('alboReportsImport.auditVascoOverlap', () => {
  const CLIENT = 'parallel'

  async function linkToVasco(
    t: Harness,
    companyId: Id<'companies'>,
    issuerId: string,
  ) {
    await t.run((ctx) =>
      ctx.db.patch('companies', companyId, {
        vascoClientSlug: CLIENT,
        vascoIssuerId: issuerId,
      }),
    )
  }

  async function addCommunication(
    t: Harness,
    orgId: Id<'organizations'>,
    issuerId: string,
    communicationId: string,
  ) {
    await t.run((ctx) =>
      ctx.db.insert('vascoCommunicationsCache', {
        orgId,
        clientSlug: CLIENT,
        issuerId,
        communicationId,
        title: `Communication ${communicationId}`,
        documents: [],
        fetchedAt: Date.now(),
      }),
    )
  }

  const audit = (t: Harness, orgSlug: string) =>
    t.query(internal.migrations.alboReportsImport.auditVascoOverlap, {
      orgSlug,
    })

  test('an entity served by both channels surfaces, with the imported rows named', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const linked = await createPortfolioCompany(t, org.orgId, 'AZmed')
    const unlinked = await createPortfolioCompany(t, org.orgId, 'Corma')

    await linkToVasco(t, linked, 'issuer-azmed')
    await addCommunication(t, org.orgId, 'issuer-azmed', 'comm-1')
    // Another issuer's communication, held by the same org: it must not be
    // read as this entity's news.
    await addCommunication(t, org.orgId, 'issuer-other', 'comm-2')
    await importOne(t, linked)
    await importOne(t, unlinked, {
      alboReportId: 'aa24803c-bf85-4b00-8dbf-e289acaec4d4',
    })

    const out = await audit(t, 'albo')
    expect(out.linkedEntities).toBe(1)
    expect(out.bothChannels).toBe(1)
    expect(out.importedOnLinked).toBe(1)

    // The unlinked entity carries an imported report too, and stays out: the
    // audit is about the entities the portal also serves.
    expect(out.entities.map((e) => e.name)).toEqual(['AZmed'])
    const [entity] = out.entities
    expect(entity.communications).toBe(1)
    expect(entity.rows.communications[0].title).toBe('Communication comm-1')
    expect(entity.reports).toBe(1)
    expect(entity.rows.reports[0].importedFromAlboApp).toBe(true)
  })

  test('a linked entity whose portal holds nothing surfaces as a hole', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const linked = await createPortfolioCompany(t, org.orgId, 'AZmed')
    await linkToVasco(t, linked, 'issuer-azmed')

    const out = await audit(t, 'albo')
    expect(out.linkedWithoutCommunications).toBe(1)
    expect(out.bothChannels).toBe(0)
    expect(out.entities[0].communications).toBe(0)
  })

  test('a report born from the inbox is not reported as imported', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [
      { userId: user.userId, role: 'owner' },
    ])
    const linked = await createPortfolioCompany(t, org.orgId, 'AZmed')
    await linkToVasco(t, linked, 'issuer-azmed')
    await addCommunication(t, org.orgId, 'issuer-azmed', 'comm-1')
    await t.run((ctx) =>
      ctx.db.insert('companyReports', {
        orgId: org.orgId,
        companyId: linked,
        source: 'email',
        title: 'AZmed Update #85',
        status: 'completed',
      }),
    )

    const out = await audit(t, 'albo')
    // Both channels feed the fiche, but nothing here may be deleted as an
    // import artefact — the distinction decides what a cleanup can touch.
    expect(out.bothChannels).toBe(1)
    expect(out.importedOnLinked).toBe(0)
    expect(out.entities[0].rows.reports[0].importedFromAlboApp).toBe(false)
  })
})
