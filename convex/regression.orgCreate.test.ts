/// <reference types="vite/client" />
/**
 * Regression: an organization created from the app is usable straight away.
 *
 * `organizations:create` used to insert the org row and its owner membership,
 * and stop there — leaving an org that is not empty but INERT: a deal's
 * investor and a bank account's owner must be a `group_*` entity
 * (`assertInvestorIsGroupEntity`, `cash.ts`, `statements.ts`), Powens refuses
 * an org with no root (`group_root_not_found`), and every surface that creates
 * a company writes `portfolio` — the front, the AI agent and the MCP server
 * alike. So nothing could ever supply the missing piece from inside the app.
 *
 * What this file pins: the creation poses the org's own `group_root` company,
 * that company is a valid deal investor, and the gesture lands in the journal
 * like any other company creation (`tests/journalGuards.test.ts` demands the
 * logger; only a run proves it says the truth).
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { createUser, setupHarness } from './regression.setup'

describe('creating an org from the app', () => {
  test('poses the org’s own group_root company, named after the org', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'founder@test.dev')

    const { orgId } = await user.as.mutation(api.organizations.create, {
      name: 'Nouvelle Société',
      slug: 'nouvelle-societe',
    })

    const companies = await t.run(async (ctx) =>
      ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
    )
    expect(companies).toHaveLength(1)
    expect(companies[0]).toMatchObject({
      name: 'Nouvelle Société',
      kind: 'group_root',
    })
  })

  test('that company can carry a deal as investor', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'founder@test.dev')
    const { orgId } = await user.as.mutation(api.organizations.create, {
      name: 'Nouvelle Société',
      slug: 'nouvelle-societe',
    })
    const root = await t.run(async (ctx) =>
      ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', orgId).eq('kind', 'group_root'),
        )
        .unique(),
    )
    const target = await user.as.mutation(api.companies.create, {
      orgId,
      name: 'Une participation',
      kind: 'portfolio',
    })

    // The gesture that was impossible before: a first investment, with no
    // migration and no CLI run in between.
    const dealId = await user.as.mutation(api.deals.create, {
      orgId,
      investorCompanyId: root!._id,
      targetCompanyId: target,
      instrumentKind: 'share',
      committedAmount: 100_000, // 1 000 € in cents
    })
    expect(
      await t.run(async (ctx) => (await ctx.db.get('deals', dealId))?.orgId),
    ).toBe(orgId)
  })

  test('the creation is journaled, with the creator as actor', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'founder@test.dev')

    const { orgId } = await user.as.mutation(api.organizations.create, {
      name: 'Nouvelle Société',
      slug: 'nouvelle-societe',
    })

    const events = await t.run(async (ctx) =>
      ctx.db.query('companyEvents').collect(),
    )
    expect(events.every((e) => e.orgId === orgId)).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].event).toEqual({ kind: 'company_created' })
    expect(events[0].actor).toMatchObject({ userId: user.userId })
  })
})
