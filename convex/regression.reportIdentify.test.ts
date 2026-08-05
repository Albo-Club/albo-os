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
      companyId: immo6,
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
      companyId: alboWaro,
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
      companyId: alboSpv,
    })

    expect(await matchedNames(t, emailId)).toEqual(['Parallel SPV 13', 'Parallel SPV 13'])
  })
})
