/// <reference types="vite/client" />
/**
 * Regression: what "the same participation" means when a report is attached
 * (convex/lib/emailIdentify.ts, applied by reportIdentify + reportInbox).
 *
 * A sponsor puts all its vehicles on ONE domain (Sezame Immo 2 / 6, the
 * Parallel SPVs…), so that domain names the writer, not the participation:
 * - attaching a report to a vehicle must NOT contaminate its siblings;
 * - the domain must keep fanning out when it carries a single participation
 *   — that is how the same company held in two orgs gets both its reports.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

async function createCompany(
  t: Harness,
  orgId: Id<'organizations'>,
  name: string,
  domain: string,
): Promise<Id<'companies'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('companies', { orgId, name, kind: 'portfolio', domain })
  })
}

/** A mail sitting in the review queue, waiting to be attached by hand. */
async function createPendingEmail(t: Harness, subject: string): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: `msg-${subject}`,
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject,
      receivedAt: Date.now(),
      attachments: [],
      status: 'needs_review',
      statusReason: 'ambiguous',
    })
  })
}

/** A report already stored on `matched` — the state "Rattacher aussi" acts on. */
async function createProcessedEmail(
  t: Harness,
  subject: string,
  matched: Array<{ companyId: Id<'companies'>; orgId: Id<'organizations'> }>,
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: `msg-${subject}`,
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject,
      receivedAt: Date.now(),
      attachments: [],
      status: 'processed',
      matchedCompanies: matched,
      matchMethod: 'manual',
      sources: [{ kind: 'body', label: 'body', state: 'extracted' as const }],
      notifiedAt: Date.now(),
    })
  })
}

async function matchedNames(t: Harness, id: Id<'inboundEmails'>): Promise<Array<string>> {
  return await t.run(async (ctx) => {
    const row = await ctx.db.get('inboundEmails', id)
    const names = await Promise.all(
      (row?.matchedCompanies ?? []).map(async (m) => {
        const company = await ctx.db.get('companies', m.companyId)
        return company?.name ?? '?'
      }),
    )
    return names.sort()
  })
}

async function setup() {
  const t = setupHarness()
  const user = await createUser(t, 'reports@test.dev')
  const albo = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
  const calte = await createOrg(t, 'calte', [{ userId: user.userId, role: 'owner' }])
  return { t, user, albo, calte }
}

describe('manual attach — fan-out to the same participation only', () => {
  test('a sponsor domain does not spread the report to the sibling vehicles', async () => {
    const { t, user, albo, calte } = await setup()
    const immo6 = await createCompany(t, albo.orgId, 'Sezame Immo 6', 'hellosezame.com')
    await createCompany(t, albo.orgId, 'Sezame Immo 2', 'hellosezame.com')
    await createCompany(t, calte.orgId, 'SEZAME IMMO 1', 'hellosezame.com')

    const emailId = await createPendingEmail(t, 'Reporting T2')
    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: emailId,
      companyIds: [immo6],
    })

    expect(await matchedNames(t, emailId)).toEqual(['Sezame Immo 6'])
  })

  test('a domain carrying one participation still fans out across orgs', async () => {
    const { t, user, albo, calte } = await setup()
    const alboWaro = await createCompany(t, albo.orgId, 'Waro', 'waro.io')
    await createCompany(t, calte.orgId, 'WARO', 'waro.io')

    const emailId = await createPendingEmail(t, 'Waro — update mensuel')
    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: emailId,
      companyIds: [alboWaro],
    })

    expect(await matchedNames(t, emailId)).toEqual(['WARO', 'Waro'])
  })

  test('two entities of one vehicle, on a sponsor domain, stay together', async () => {
    // Same vehicle held by both orgs: the name is what identifies it once the
    // domain is disqualified, so both entities receive the report.
    const { t, user, albo, calte } = await setup()
    const alboSpv = await createCompany(t, albo.orgId, 'Parallel SPV 13', 'parallel-invest.com')
    await createCompany(t, calte.orgId, 'Parallel SPV 13', 'parallel-invest.com')
    await createCompany(t, calte.orgId, 'Parallel SPV 18', 'parallel-invest.com')

    const emailId = await createPendingEmail(t, 'SPV 13 — avancement')
    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: emailId,
      companyIds: [alboSpv],
    })

    expect(await matchedNames(t, emailId)).toEqual(['Parallel SPV 13', 'Parallel SPV 13'])
  })
})

/**
 * One company held by both orgs under DIFFERENT names (Oprtrs & Co / OPRTRS
 * CLUB): no identity rule can merge them, so the second one is attached by
 * hand — and the queue has to say that an org was left out.
 */
describe('attaching one more participation after the fact', () => {
  async function oprtrs() {
    const { t, user, albo, calte } = await setup()
    const alboId = await createCompany(t, albo.orgId, 'Oprtrs & Co', 'oprtrs.club')
    const calteId = await createCompany(t, calte.orgId, 'OPRTRS CLUB', 'oprtrs.club')
    const emailId = await createProcessedEmail(t, 'Update Oprtrs', [
      { companyId: alboId, orgId: albo.orgId },
    ])
    return { t, user, calteId, emailId }
  }

  test('adds to the entities already attached instead of replacing them', async () => {
    const { t, user, calteId, emailId } = await oprtrs()

    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: emailId,
      companyIds: [calteId],
    })

    expect(await matchedNames(t, emailId)).toEqual(['OPRTRS CLUB', 'Oprtrs & Co'])
    const row = await t.run(async (ctx) => ctx.db.get('inboundEmails', emailId))
    // Back in the pipeline so the new entity gets its report…
    expect(row?.status).toBe('received')
    expect(row?.reportIds).toBeUndefined()
    // …but the forwarder was already told: no second recap.
    expect(row?.notifiedAt).toBeDefined()
  })

  test('flags the org left out, and stops once it is attached', async () => {
    const { user, calteId, emailId } = await oprtrs()

    const before = await user.as.query(api.reportInbox.list, {})
    expect(before.find((r) => r._id === emailId)?.relatedOrgNames).toEqual(['calte'])

    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: emailId,
      companyIds: [calteId],
    })

    const after = await user.as.query(api.reportInbox.list, {})
    expect(after.find((r) => r._id === emailId)?.relatedOrgNames).toEqual([])
  })

  test('a sponsor domain raises no flag once both orgs hold the report', async () => {
    // Waro is in both orgs under the same name, so the fan-out already did
    // the job — nothing to suggest, and no badge on the row.
    const { t, user, albo, calte } = await setup()
    const alboWaro = await createCompany(t, albo.orgId, 'Waro', 'waro.io')
    const calteWaro = await createCompany(t, calte.orgId, 'WARO', 'waro.io')
    const emailId = await createProcessedEmail(t, 'Waro update', [
      { companyId: alboWaro, orgId: albo.orgId },
      { companyId: calteWaro, orgId: calte.orgId },
    ])

    const rows = await user.as.query(api.reportInbox.list, {})
    expect(rows.find((r) => r._id === emailId)?.relatedOrgNames).toEqual([])
  })
})
