/// <reference types="vite/client" />
/**
 * Regression: a VASCO report triggers its AI synthesis on its own (ALB-238).
 *
 * The analysis used to fire only at the end of the report-MAIL pipeline
 * (`reportStore.run`), so a report published on the portal was cached,
 * displayed — and never analyzed. The plug could not simply be added: a pull
 * is a photo, and `replaceCommunicationsCache` wipes then reinserts the whole
 * set, so after the swap nothing could say which communication had just
 * arrived. The diff captured before the delete is what these tests pin.
 *
 * Invariants:
 * - a communication absent from the previous snapshot re-runs the synthesis
 *   of the entity linked to its issuer;
 * - re-pulling the same set is silent — a cron every 48h must not re-analyze
 *   the portfolio on every tick;
 * - an issuer nobody is linked to, and an archived entity, are never analyzed;
 * - linking an entity to its issuer analyzes it right away: the link is made
 *   FROM the cache, so its whole backlog already reads as "known".
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

const CLIENT = 'parallel'

async function orgSetup(slug = 'org-vasco') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  return { t, user, org }
}

function comm(communicationId: string, issuerId: string) {
  return {
    communicationId,
    issuerId,
    issuerLabel: `SPV ${issuerId}`,
    title: `Reporting ${communicationId}`,
    bodyText: 'Le trimestre est conforme au plan.',
    period: '2026-Q2',
    publishDate: '2026-07-15',
    documents: [],
  }
}

async function linkToIssuer(
  t: Harness,
  companyId: Id<'companies'>,
  issuerId: string,
) {
  await t.run(async (ctx) =>
    ctx.db.patch('companies', companyId, {
      vascoClientSlug: CLIENT,
      vascoIssuerId: issuerId,
    }),
  )
}

/**
 * Reader over the entities queued for an AI synthesis, whatever the entry
 * point (the batch used by the cache refresh, or the single run used by the
 * link). Each call returns only what was queued SINCE the previous one, so a
 * test can assert one refresh at a time.
 *
 * The queue is read, never run: `runAnalysis` would reach for the LLM and the
 * portal. What is under test is who gets queued, not what the model answers.
 */
function watchAnalyses(t: Harness): () => Promise<Array<Id<'companies'>>> {
  let seen = 0
  return async () => {
    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    )
    const fresh = jobs.slice(seen)
    seen = jobs.length
    const ids: Array<Id<'companies'>> = []
    for (const job of fresh) {
      const args = job.args[0] as {
        refs?: Array<{ companyId: Id<'companies'> }>
        companyId?: Id<'companies'>
      }
      if (job.name.endsWith('runAnalysisBatch'))
        for (const ref of args.refs ?? []) ids.push(ref.companyId)
      else if (job.name.endsWith('runAnalysis') && args.companyId)
        ids.push(args.companyId)
    }
    return ids
  }
}

describe('VASCO report → AI synthesis', () => {
  test('a communication absent from the previous snapshot is analyzed', async () => {
    const { t, org } = await orgSetup()
    const analyzed = watchAnalyses(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })

    expect(await analyzed()).toEqual([companyId])
  })

  test('re-pulling the same set analyzes nothing', async () => {
    const { t, org } = await orgSetup('org-vasco-idem')
    const analyzed = watchAnalyses(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    const communications = [comm('c1', 'iss-1'), comm('c2', 'iss-1')]
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications,
    })
    expect(await analyzed()).toEqual([companyId])

    // Second cron tick, identical portal content.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications,
    })

    expect(await analyzed()).toEqual([])
  })

  test('only the entities of the issuers that published are analyzed', async () => {
    const { t, org } = await orgSetup('org-vasco-scope')
    const analyzed = watchAnalyses(t)
    const alpha = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    const beta = await createPortfolioCompany(t, org.orgId, 'SPV Beta')
    await linkToIssuer(t, alpha, 'iss-1')
    await linkToIssuer(t, beta, 'iss-2')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-2')],
    })
    expect(await analyzed()).toEqual([alpha, beta])

    // Only iss-2 publishes again.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-2'), comm('c3', 'iss-2')],
    })

    expect(await analyzed()).toEqual([beta])
  })

  test('an unlinked issuer and an archived entity are never analyzed', async () => {
    const { t, org } = await orgSetup('org-vasco-quiet')
    const analyzed = watchAnalyses(t)
    const archived = await createPortfolioCompany(t, org.orgId, 'SPV Sortie')
    await linkToIssuer(t, archived, 'iss-1')
    await t.run(async (ctx) =>
      ctx.db.patch('companies', archived, { archivedAt: Date.now() }),
    )

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-orpheline')],
    })

    expect(await analyzed()).toEqual([])
  })

  test('another client of the same org does not mask an arrival', async () => {
    const { t, org } = await orgSetup('org-vasco-multi')
    const analyzed = watchAnalyses(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    // A second VASCO client holds a row with the SAME communication id: the
    // memory is per (org, clientSlug), so it must not count as already known.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: 'autre-client',
      communications: [comm('c1', 'iss-1')],
    })
    // Nothing: the entity is linked to `parallel`, not to this client.
    expect(await analyzed()).toEqual([])

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })

    expect(await analyzed()).toEqual([companyId])
  })

  test('linking an entity to its issuer analyzes it right away', async () => {
    const { t, user, org } = await orgSetup('org-vasco-link')
    const analyzed = watchAnalyses(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')

    // The cache is filled BEFORE the link — that is the real order: issuers
    // are picked from the cached list. Nothing to analyze yet.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    expect(await analyzed()).toEqual([])

    await user.as.mutation(api.companies.setVascoLink, {
      id: companyId,
      clientSlug: CLIENT,
      issuerId: 'iss-1',
    })

    expect(await analyzed()).toEqual([companyId])
  })
})
