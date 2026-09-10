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

/**
 * Regression: one publication, every fiche that holds the SPV
 * (convex/vascoIngest.ts:pendingForIssuer).
 *
 * The anchor is keyed by PORTAL, not by org — one publication, ingested once.
 * That is right, and it is exactly why the entity lookup may not be
 * org-scoped: CALTE and Albo Club both subscribed to Bernay and each keeps its
 * own fiche, so the first org to run claimed the eight ids and the second
 * found nothing left to do. Albo's fiche carried all eight publications,
 * CALTE's carried none, and the run reported `0` for it — indistinguishable
 * from "nothing to do".
 */
describe('a publication reaches every fiche holding the issuer', () => {
  test('the entities of two orgs are served by one ingestion', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'shared@test.dev')
    const albo = await createOrg(t, 'albo-shared', [
      { userId: user.userId, role: 'owner' },
    ])
    const calte = await createOrg(t, 'calte-shared', [
      { userId: user.userId, role: 'owner' },
    ])
    const alboFiche = await createPortfolioCompany(t, albo.orgId, 'SPV 13 Bernay')
    const calteFiche = await createPortfolioCompany(
      t,
      calte.orgId,
      'SPV13 Bernay Normandie',
    )
    for (const id of [alboFiche, calteFiche]) {
      await t.run((ctx) =>
        ctx.db.patch('companies', id, {
          vascoClientSlug: CLIENT,
          vascoIssuerId: ISSUER,
        }),
      )
    }
    await cache(t, albo.orgId, 'c1')

    // Asked from ONE org, it answers with BOTH fiches: the publication
    // concerns the operation, so it concerns both investors.
    const pending = await t.query(internal.vascoIngest.pendingForIssuer, {
      orgId: albo.orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(new Set(pending.companies.map((c) => c.companyId))).toEqual(
      new Set([alboFiche, calteFiche]),
    )
    expect(pending.communications.map((c) => c.communicationId)).toEqual(['c1'])
  })

  test('an archived fiche is still left out of the fan-out', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'shared-arch@test.dev')
    const albo = await createOrg(t, 'albo-arch', [
      { userId: user.userId, role: 'owner' },
    ])
    const calte = await createOrg(t, 'calte-arch', [
      { userId: user.userId, role: 'owner' },
    ])
    const alive = await createPortfolioCompany(t, albo.orgId, 'SPV vivant')
    const archived = await createPortfolioCompany(t, calte.orgId, 'SPV sorti')
    for (const id of [alive, archived]) {
      await t.run((ctx) =>
        ctx.db.patch('companies', id, {
          vascoClientSlug: CLIENT,
          vascoIssuerId: ISSUER,
        }),
      )
    }
    await t.run((ctx) =>
      ctx.db.patch('companies', archived, { archivedAt: Date.now() }),
    )
    await cache(t, albo.orgId, 'c1')

    const pending = await t.query(internal.vascoIngest.pendingForIssuer, {
      orgId: albo.orgId,
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(pending.companies.map((c) => c.companyId)).toEqual([alive])
  })
})

/**
 * Regression: the repair that undoes one issuer's ingestion
 * (convex/migrations/vascoReingestIssuer.ts).
 *
 * It exists because the anchor makes an already-ingested publication a no-op
 * forever: the rows written before the fan-out was group-wide cannot be
 * completed, only redone. Deleting is safe here and nowhere else — the portal
 * still holds every publication, and its own id brings them back.
 */
describe('migrations.vascoReingestIssuer', () => {
  test('dry run names what it would remove and writes nothing', async () => {
    const { t, org, companyId } = await setup('org-repair')
    const portal = await inboundRow(t, 'vasco', 'c1')
    await store(t, companyId, org.orgId, portal, 'Bernay - Reporting')

    const plan = await t.mutation(internal.migrations.vascoReingestIssuer.run, {
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(plan.applied).toBe(false)
    expect(plan.inboundRows).toBe(1)
    expect(plan.reports).toBe(1)

    expect(await t.run((ctx) => ctx.db.query('companyReports').collect())).toHaveLength(1)
  })

  test('applying removes the portal reports and their inbound rows', async () => {
    const { t, org, companyId } = await setup('org-repair-apply')
    const portal = await inboundRow(t, 'vasco', 'c1')
    await store(t, companyId, org.orgId, portal, 'Bernay - Reporting')

    await t.mutation(internal.migrations.vascoReingestIssuer.run, {
      clientSlug: CLIENT,
      issuerId: ISSUER,
      apply: true,
    })

    expect(await t.run((ctx) => ctx.db.query('companyReports').collect())).toEqual([])
    expect(await t.run((ctx) => ctx.db.get('inboundEmails', portal))).toBeNull()
  })

  test('a report that came by mail is never swept up', async () => {
    const { t, org, companyId } = await setup('org-repair-mail')
    const mail = await inboundRow(t, 'email', 'transfert')
    await store(t, companyId, org.orgId, mail, 'Update reçu par mail')

    // The mail report is not portal-born, so it is not even in the plan.
    const plan = await t.mutation(internal.migrations.vascoReingestIssuer.run, {
      clientSlug: CLIENT,
      issuerId: ISSUER,
    })
    expect(plan.reports).toBe(0)

    await t.mutation(internal.migrations.vascoReingestIssuer.run, {
      clientSlug: CLIENT,
      issuerId: ISSUER,
      apply: true,
    })
    expect(await t.run((ctx) => ctx.db.query('companyReports').collect())).toHaveLength(1)
  })
})
