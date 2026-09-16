/// <reference types="vite/client" />
/**
 * Regression: the report review queue is scoped to the caller's orgs.
 *
 * The queue reads `inboundEmails`, a table whose rows carry NO `orgId`: a mail
 * belongs to nobody until identification matches a participation. That is why
 * its access boundary was "member of ≥1 org" — which held exactly as long as
 * every member belonged to every org. The day a third party gets an org of
 * their own, that boundary hands them the last 100 mails of the whole
 * deployment, plus the right to reject and delete ours.
 *
 * The boundary this file pins, row by row:
 * - a row is in my perimeter when one of its MATCHED entities is in an org I
 *   belong to, or when its SENDER belongs to an org I belong to (which
 *   includes me — that is what makes my own forward visible before it is
 *   matched);
 * - a row with neither a match nor a resolved sender (spam, a stranger writing
 *   to the open address) belongs to no tenant: super-admins only;
 * - the four queue actions refuse a row outside that perimeter, BEFORE any
 *   state check, so the answer never depends on the row's contents.
 *
 * Two neighbouring rules are pinned here too, because the leak they carry is
 * the same one by another door:
 * - manual assignment fans out inside the caller's orgs, never across all of
 *   them (a shared domain would otherwise attach a stranger's report to one
 *   of our participations);
 * - automatic identification offers the model the portfolio of the
 *   FORWARDER's orgs. With no forwarder to attribute the mail to, the whole
 *   portfolio stays on the table — a founder writing in directly is filed on
 *   content alone, and that must keep working (cf.
 *   `regression.reportSenders.test.ts`).
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createOrg,
  createPortfolioCompany,
  createUser,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

/** Queue row, with only the fields the perimeter rule reads. */
async function inbound(
  t: Harness,
  opts: {
    messageId: string
    fromEmail?: string
    subject?: string
    senderUserId?: Id<'users'>
    matched?: Array<{
      companyId: Id<'companies'>
      orgId: Id<'organizations'>
    }>
    status?: 'received' | 'needs_review' | 'processed'
    statusReason?: string
  },
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'report-albo-os@agentmail.to',
      agentmailMessageId: opts.messageId,
      fromEmail: opts.fromEmail ?? 'someone@test.dev',
      toEmails: ['report@alboteam.com'],
      ccEmails: [],
      subject: opts.subject ?? 'Update',
      receivedAt: Date.now(),
      attachments: [],
      status: opts.status ?? 'needs_review',
      statusReason: opts.statusReason,
      senderUserId: opts.senderUserId,
      matchedCompanies: opts.matched,
    }),
  )
}

/**
 * The world this file argues about: our org (Benjamin, super-admin as in
 * prod, plus Clément who is not) and a third party's own org.
 */
async function threeTenants(t: Harness) {
  const ben = await createUser(t, 'benjamin@alboteam.com', { superAdmin: true })
  const clement = await createUser(t, 'clement@alboteam.com')
  const ext = await createUser(t, 'founder@tiers.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: ben.userId, role: 'owner' },
    { userId: clement.userId, role: 'owner' },
  ])
  const tiers = await createOrg(t, 'tiers', [
    { userId: ext.userId, role: 'owner' },
  ])
  const ours = await createPortfolioCompany(t, calte.orgId, 'Sezame')
  const theirs = await createPortfolioCompany(t, tiers.orgId, 'Leur Boîte')
  return { ben, clement, ext, calte, tiers, ours, theirs }
}

describe('the queue shows only the rows that concern the caller', () => {
  test("a matched row is visible in its orgs, and nowhere else", async () => {
    const t = setupHarness()
    const { clement, ext, calte, tiers, ours, theirs } = await threeTenants(t)

    await inbound(t, {
      messageId: 'msg-ours',
      subject: 'Sezame — Q3',
      matched: [{ companyId: ours, orgId: calte.orgId }],
      status: 'processed',
    })
    await inbound(t, {
      messageId: 'msg-theirs',
      subject: 'Leur Boîte — Q3',
      matched: [{ companyId: theirs, orgId: tiers.orgId }],
      status: 'processed',
    })

    const mine = await clement.as.query(api.reportInbox.list, {})
    expect(mine.map((r) => r.subject)).toEqual(['Sezame — Q3'])

    const hers = await ext.as.query(api.reportInbox.list, {})
    expect(hers.map((r) => r.subject)).toEqual(['Leur Boîte — Q3'])
  })

  test('my own forward is visible before anything is matched', async () => {
    const t = setupHarness()
    const { clement, ext } = await threeTenants(t)

    // Nothing matched yet: without the sender leg of the rule, the person who
    // forwarded the mail could not see it until identification succeeded —
    // and never at all when it lands in quarantine.
    await inbound(t, {
      messageId: 'msg-forward',
      fromEmail: 'founder@tiers.dev',
      subject: 'Transfert en attente',
      senderUserId: ext.userId,
      statusReason: 'no_match',
    })

    expect(
      (await ext.as.query(api.reportInbox.list, {})).map((r) => r.subject),
    ).toEqual(['Transfert en attente'])
    expect(await clement.as.query(api.reportInbox.list, {})).toEqual([])
  })

  test('a row with neither match nor sender is super-admin only', async () => {
    const t = setupHarness()
    const { ben, clement, ext } = await threeTenants(t)

    // A stranger writing to the open address: attributable to no tenant, so
    // nobody owns it — but somebody has to be able to triage it.
    await inbound(t, {
      messageId: 'msg-orphan',
      fromEmail: 'inconnu@nulle-part.dev',
      subject: 'Bonjour',
      statusReason: 'no_match',
    })

    expect(
      (await ben.as.query(api.reportInbox.list, {})).map((r) => r.subject),
    ).toEqual(['Bonjour'])
    expect(await clement.as.query(api.reportInbox.list, {})).toEqual([])
    expect(await ext.as.query(api.reportInbox.list, {})).toEqual([])
  })
})

describe('the queue actions refuse a row outside the perimeter', () => {
  test('reject, delete, reprocess and storeAnyway all answer forbidden', async () => {
    const t = setupHarness()
    const { ext, calte, ours } = await threeTenants(t)

    const ourRow = await inbound(t, {
      messageId: 'msg-ours',
      subject: 'Sezame — Q3',
      matched: [{ companyId: ours, orgId: calte.orgId }],
      statusReason: 'possible_duplicate',
    })

    // `forbidden` and not `invalid_status`: the perimeter is checked before
    // the row's state, so a refusal never tells a stranger what the row holds.
    for (const call of [
      api.reportInbox.reject,
      api.reportInbox.deleteEmail,
      api.reportInbox.reprocess,
      api.reportInbox.storeAnyway,
    ]) {
      await expect(
        ext.as.mutation(call, { inboundEmailId: ourRow }),
      ).rejects.toThrow('forbidden')
    }
  })

  test('the same actions go through on a row of my own org', async () => {
    const t = setupHarness()
    const { clement, calte, ours } = await threeTenants(t)

    const ourRow = await inbound(t, {
      messageId: 'msg-ours',
      subject: 'Sezame — Q3',
      matched: [{ companyId: ours, orgId: calte.orgId }],
    })

    await clement.as.mutation(api.reportInbox.reject, {
      inboundEmailId: ourRow,
    })
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.get('inboundEmails', ourRow))?.status,
      ),
    ).toBe('rejected')
  })
})

describe('manual assignment stays inside the caller’s orgs', () => {
  test('a domain held by two tenants fans out to the caller’s entity only', async () => {
    const t = setupHarness()
    const { clement, ext, calte, tiers } = await threeTenants(t)

    // The same domain on both sides: the identity rule treats a domain as one
    // participation, so an unscoped fan-out would attach a third party's
    // report to our own sheet — silently, and with no way back.
    const oursShared = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: calte.orgId,
        name: 'Oprtrs & Co',
        kind: 'portfolio',
        domain: 'oprtrs.com',
      }),
    )
    const theirsShared = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: tiers.orgId,
        name: 'OPRTRS CLUB',
        kind: 'portfolio',
        domain: 'oprtrs.com',
      }),
    )

    const row = await inbound(t, {
      messageId: 'msg-shared',
      fromEmail: 'founder@tiers.dev',
      senderUserId: ext.userId,
      statusReason: 'no_match',
    })
    await ext.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: row,
      companyIds: [theirsShared],
    })

    expect(
      await t.run(async (ctx) =>
        (await ctx.db.get('inboundEmails', row))?.matchedCompanies?.map(
          (m) => m.companyId,
        ),
      ),
    ).toEqual([theirsShared])

    // Symmetrically, our own assignment does not reach into their org.
    const ourRow = await inbound(t, {
      messageId: 'msg-shared-ours',
      fromEmail: 'clement@alboteam.com',
      senderUserId: clement.userId,
      statusReason: 'no_match',
    })
    await clement.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: ourRow,
      companyIds: [oursShared],
    })
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.get('inboundEmails', ourRow))?.matchedCompanies?.map(
          (m) => m.companyId,
        ),
      ),
    ).toEqual([oursShared])
  })
})

describe('automatic identification follows the forwarder', () => {
  test('a forwarded mail is compared to the forwarder’s portfolio only', async () => {
    const t = setupHarness()
    const { clement, ext, ours, theirs } = await threeTenants(t)

    expect(
      (
        await t.query(internal.reportIdentify.listCandidates, {
          senderUserId: ext.userId,
        })
      ).map((c) => c.companyId),
    ).toEqual([theirs])

    expect(
      (
        await t.query(internal.reportIdentify.listCandidates, {
          senderUserId: clement.userId,
        })
      ).map((c) => c.companyId),
    ).toEqual([ours])
  })

  test('an unattributed mail keeps the whole portfolio on the table', async () => {
    const t = setupHarness()
    const { ours, theirs } = await threeTenants(t)

    // The founder of a participation writing in directly has no account, so
    // no org to narrow to. Narrowing to nothing would stop filing those mails
    // altogether — the content is what earns a mail its analysis
    // (cf. `regression.reportSenders.test.ts`).
    const candidates = await t.query(internal.reportIdentify.listCandidates, {})
    expect(candidates.map((c) => c.companyId).sort()).toEqual(
      [ours, theirs].sort(),
    )
  })
})
