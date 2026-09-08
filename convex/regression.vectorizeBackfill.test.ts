/// <reference types="vite/client" />
/**
 * Regression: the backfill's work queue reads only the rows it still owes
 * work on, and reads them a page at a time
 * (convex/vectorize.ts `listReportIdsForBackfill` / `listDocumentIdsForBackfill`).
 *
 * Convex has no column projection: a query hands back WHOLE rows, and a
 * `companyReports` row carries its `rawContent` — up to the 1 MiB document
 * cap. A listing that walks a whole org just to keep the ids therefore drags
 * the entire corpus through the 8 MiB per-query read limit. It works, then it
 * doesn't, and the error names the read limit rather than the listing that
 * caused it. Two invariants keep that from coming back:
 * - the queue skips what is done ('indexed', 'skipped'), so a backfill on an
 *   up-to-date org reads nothing at all;
 * - it is capped per page, so one org's corpus can never size a single read.
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
import type { Doc, Id } from './_generated/dataModel'

/** Mirrors BACKFILL_PAGE in convex/vectorize.ts. */
const PAGE = 50

type VectorState = Doc<'companyReports'>['vectorState']

async function setup(t: Harness) {
  const user = await createUser(t, 'benjamin@test.dev')
  const org = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const companyId = await createPortfolioCompany(t, org.orgId, 'Corma')
  return { orgId: org.orgId, companyId }
}

function createReport(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  vectorState: VectorState,
): Promise<Id<'companyReports'>> {
  return t.run((ctx) =>
    ctx.db.insert('companyReports', {
      orgId,
      companyId,
      source: 'email',
      status: 'completed',
      rawContent: 'Le chiffre d’affaires progresse de 12 %.',
      vectorState,
    }),
  )
}

function listReports(t: Harness, orgId: Id<'organizations'>) {
  return t.query(internal.vectorize.listReportIdsForBackfill, { orgId })
}

describe('vectorize backfill work queue', () => {
  test('an up-to-date org yields no work at all', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    for (const state of ['indexed', 'skipped'] as const) {
      await createReport(t, orgId, companyId, state)
    }

    expect(await listReports(t, orgId)).toEqual([])
  })

  test('only the rows still owed work are listed', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    const never = await createReport(t, orgId, companyId, undefined)
    const pending = await createReport(t, orgId, companyId, 'pending')
    const failed = await createReport(t, orgId, companyId, 'failed')
    await createReport(t, orgId, companyId, 'indexed')
    await createReport(t, orgId, companyId, 'skipped')

    expect(new Set(await listReports(t, orgId))).toEqual(
      new Set([never, pending, failed]),
    )
  })

  test('the listing is capped per page, whatever the corpus holds', async () => {
    const t = setupHarness()
    const { orgId, companyId } = await setup(t)

    for (let i = 0; i < PAGE + 10; i++) {
      await createReport(t, orgId, companyId, undefined)
    }

    // The page cap, not the corpus, sizes the read — the backfill loop asks
    // again once this page has been processed out of the queue.
    expect(await listReports(t, orgId)).toHaveLength(PAGE)
  })

  test("another org's rows never enter the queue", async () => {
    const t = setupHarness()
    const mine = await setup(t)

    const other = await createUser(t, 'clement@test.dev')
    const otherOrg = await createOrg(t, 'calte', [
      { userId: other.userId, role: 'owner' },
    ])
    const otherCompany = await createPortfolioCompany(t, otherOrg.orgId, 'Jeen')
    await createReport(t, otherOrg.orgId, otherCompany, undefined)

    const own = await createReport(t, mine.orgId, mine.companyId, undefined)
    expect(await listReports(t, mine.orgId)).toEqual([own])
  })
})
