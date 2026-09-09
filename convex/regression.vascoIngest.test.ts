/// <reference types="vite/client" />
/**
 * Regression: a portal publication is digested like a report, and NEVER at the
 * expense of one (convex/vascoIngest.ts + reportStore.storeForCompany).
 *
 * A participation reaches us by two channels — a mail forwarded to the inbox,
 * a publication on the Parallel portal — and only the first was digested. The
 * second now enters the same pipeline through a third origin, `'vasco'`.
 *
 * Two properties carry the whole change, and neither is visible from the code
 * that writes them:
 *
 * - **the portal takes a free slot, never an occupied one.** Storage dedups on
 *   (company, period) and updates IN PLACE. That is right for a corrected
 *   re-send and destructive here: the same document arrives by both channels,
 *   the mail version is the richer one, and a publication whose substance sits
 *   in a PDF that failed to OCR would replace it — attachments included — with
 *   nothing to signal it. A historical ingestion would do it by the hundred.
 *   Its OWN earlier version is not an occupied slot: a corrected publication
 *   must still refresh the report it produced.
 * - **the portal's id is the anchor.** `vasco:<clientSlug>:<communicationId>`
 *   is stable across pulls, so a re-run is free, an interrupted one resumes,
 *   and the 48h cron cannot re-ingest what it re-lists.
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

const CLIENT = 'parallel'
const ISSUER = 'iss-1'

async function setup(slug: string) {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  const companyId = await createPortfolioCompany(t, org.orgId, 'AZmed')
  await t.run((ctx) =>
    ctx.db.patch('companies', companyId, {
      vascoClientSlug: CLIENT,
      vascoIssuerId: ISSUER,
    }),
  )
  return { t, org, companyId }
}

/** One cached publication, the way a pull leaves it. */
async function cache(
  t: Harness,
  orgId: Id<'organizations'>,
  communicationId: string,
) {
  await t.run((ctx) =>
    ctx.db.insert('vascoCommunicationsCache', {
      orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
      communicationId,
      title: `AZMed - ${communicationId}`,
      bodyText: 'Le mois est conforme au plan.',
      documents: [],
      fetchedAt: Date.now(),
    }),
  )
}

/**
 * Create the row, then close the door behind it.
 *
 * Creation schedules the pipeline, and nothing here is about running it: it
 * reaches for OCR, the model and the portal. Extraction claims a row only
 * while it is still `received`, so flipping the status is what neutralises the
 * scheduled run — and what keeps a background continuation from logging into a
 * worker that is already tearing down.
 */
async function createInboundAndPark(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  communicationId: string,
): Promise<Id<'inboundEmails'> | null> {
  const id = await createInbound(t, orgId, companyId, communicationId)
  if (id) await t.run((ctx) => ctx.db.patch('inboundEmails', id, { status: 'rejected' }))
  return id
}

function createInbound(
  t: Harness,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  communicationId: string,
) {
  return t.mutation(internal.vascoIngest.createInbound, {
    clientSlug: CLIENT,
    communicationId,
    subject: `AZMed - ${communicationId}`,
    bodyText: 'Le mois est conforme au plan.',
    receivedAt: Date.parse('2026-06-25T10:00:00Z'),
    companies: [{ companyId, orgId }],
    attachments: [],
  })
}

/** An inbound row of the given origin, ready to be stored from. */
async function inboundRow(
  t: Harness,
  origin: 'email' | 'vasco',
  subject: string,
): Promise<Id<'inboundEmails'>> {
  return await t.run((ctx) =>
    ctx.db.insert('inboundEmails', {
      origin,
      agentmailInboxId: origin === 'vasco' ? 'vasco-portal' : 'inbox',
      agentmailMessageId:
        origin === 'vasco' ? `vasco:${CLIENT}:${subject}` : `msg-${subject}`,
      fromEmail: 'clement@alboteam.com',
      toEmails: [],
      ccEmails: [],
      subject,
      receivedAt: Date.now(),
      attachments: [],
      status: 'processed',
      extractedText: `contenu ${subject}`,
    }),
  )
}

function store(
  t: Harness,
  companyId: Id<'companies'>,
  orgId: Id<'organizations'>,
  inboundEmailId: Id<'inboundEmails'>,
  title: string,
) {
  return t.mutation(internal.reportStore.storeForCompany, {
    companyId,
    orgId,
    inboundEmailId,
    title,
    headline: `headline ${title}`,
    keyHighlights: [],
    reportPeriod: 'June 2026',
    metrics: {},
    rawMetrics: [],
    canonical: [],
  })
}

describe('vascoIngest.createInbound', () => {
  test('a publication becomes a row the pipeline can take', async () => {
    const { t, org, companyId } = await setup('org-ingest')
    const id = await createInbound(t, org.orgId, companyId, 'c1')
    expect(id).not.toBeNull()

    const row = await t.run((ctx) => ctx.db.get('inboundEmails', id!))
    expect(row?.origin).toBe('vasco')
    expect(row?.status).toBe('received')
    // The entity is known from the VASCO link, so identification is skipped —
    // the same shortcut a manual upload takes.
    expect(row?.matchedCompanies).toEqual([{ companyId, orgId: org.orgId }])
    expect(row?.agentmailMessageId).toBe(`vasco:${CLIENT}:c1`)

    const jobs = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    )
    expect(jobs.some((j) => j.name.endsWith('reportExtract:run'))).toBe(true)

    // The row is left un-runnable on purpose. Everything above is about WHAT
    // is queued, never about running it: the pipeline reaches for OCR, the
    // model and the portal, none of which belong in a unit test. Extraction
    // claims a row only while it is still `received`, so flipping the status
    // is what closes the door — and what keeps a stray background run from
    // logging into a worker that is already tearing down.
    await t.run((ctx) =>
      ctx.db.patch('inboundEmails', id!, { status: 'rejected' }),
    )
  })

  test('the portal id is an anchor: the same publication never lands twice', async () => {
    const { t, org, companyId } = await setup('org-ingest-idem')
    expect(await createInboundAndPark(t, org.orgId, companyId, 'c1')).not.toBeNull()
    // A second pull re-listing the same publication.
    expect(await createInboundAndPark(t, org.orgId, companyId, 'c1')).toBeNull()

    const rows = await t.run((ctx) => ctx.db.query('inboundEmails').collect())
    expect(rows).toHaveLength(1)
  })
})

describe('vascoIngest.pendingForIssuer', () => {
  test('only what has not been ingested yet is pending', async () => {
    const { t, org, companyId } = await setup('org-pending')
    await cache(t, org.orgId, 'c1')
    await cache(t, org.orgId, 'c2')

    const before = await t.query(internal.vascoIngest.pendingForIssuer, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(before.communications.map((c) => c.communicationId).sort()).toEqual([
      'c1',
      'c2',
    ])

    await createInboundAndPark(t, org.orgId, companyId, 'c1')

    const after = await t.query(internal.vascoIngest.pendingForIssuer, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(after.communications.map((c) => c.communicationId)).toEqual(['c2'])
  })

  test('a publication with no live entity to land on is not pending', async () => {
    const { t, org, companyId } = await setup('org-pending-archived')
    await cache(t, org.orgId, 'c1')
    await t.run((ctx) =>
      ctx.db.patch('companies', companyId, { archivedAt: Date.now() }),
    )

    const pending = await t.query(internal.vascoIngest.pendingForIssuer, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(pending.companies).toEqual([])
    expect(pending.communications).toEqual([])
  })
})

describe('a portal publication never overwrites a report', () => {
  test('the slot held by a mail report is left untouched', async () => {
    const { t, org, companyId } = await setup('org-slot')
    const mail = await inboundRow(t, 'email', 'transfert')
    const first = await store(t, companyId, org.orgId, mail, 'Update #83')
    expect(first.created).toBe(true)

    const portal = await inboundRow(t, 'vasco', 'c1')
    const second = await store(t, companyId, org.orgId, portal, 'AZMed - Juin')
    // Same row, and nothing was written: not created, not changed.
    expect(second.reportId).toBe(first.reportId)
    expect(second.created).toBe(false)
    expect(second.changed).toBe(false)

    const rows = await t.run((ctx) =>
      ctx.db.query('companyReports').collect(),
    )
    expect(rows).toHaveLength(1)
    // The mail version is intact — title, provenance and all.
    expect(rows[0].title).toBe('Update #83')
    expect(rows[0].source).toBe('email')
  })

  test('a corrected publication still refreshes its own report', async () => {
    const { t, org, companyId } = await setup('org-slot-own')
    const portal = await inboundRow(t, 'vasco', 'c1')
    const first = await store(t, companyId, org.orgId, portal, 'AZMed - Juin')
    expect(first.created).toBe(true)

    const rows = await t.run((ctx) =>
      ctx.db.query('companyReports').collect(),
    )
    expect(rows[0].source).toBe('vasco')

    // The portal corrects the same publication: its own slot is not an
    // occupied one, or a correction could never land.
    const corrected = await inboundRow(t, 'vasco', 'c1-bis')
    const second = await store(
      t,
      companyId,
      org.orgId,
      corrected,
      'AZMed - Juin (corrigé)',
    )
    expect(second.reportId).toBe(first.reportId)
    expect(second.changed).toBe(true)

    const after = await t.run((ctx) =>
      ctx.db.query('companyReports').collect(),
    )
    expect(after).toHaveLength(1)
    expect(after[0].title).toBe('AZMed - Juin (corrigé)')
  })
})
