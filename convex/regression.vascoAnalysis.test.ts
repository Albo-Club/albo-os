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
 *
 * The cache is UPSERTED, not wiped and rewritten, which is what lets a marker
 * live on a communication — the second half of the file pins that, and the
 * announcement mail built on it:
 *
 * - a known communication keeps its row, and with it `announcedAt`;
 * - one the portal stopped listing leaves the cache;
 * - the FIRST fill analyzes but never mails: a backlog is not news;
 * - an arrival is claimed before it is mailed, so a replay stays silent.
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
 * Reader over the entities queued for processing after a refresh, whatever the
 * entry point. Each call returns only what was queued SINCE the previous one,
 * so a test can assert one refresh at a time.
 *
 * Two job shapes count, and the distinction is itself an invariant: a
 * BOOTSTRAP fill queues `intelligence.runAnalysis` alone (analyze the backlog,
 * mail nothing), while a later ARRIVAL queues `vascoNotify.announce`, which
 * runs that same synthesis and then mails the recap. `queued()` returns the
 * companies; `queuedKinds()` returns which of the two they went through.
 *
 * The queue is read, never run: both would reach for the LLM, the portal and
 * AgentMail. What is under test is who gets queued and how, not what the model
 * answers.
 */
function watchQueue(t: Harness): {
  queued: () => Promise<Array<Id<'companies'>>>
  queuedKinds: () => Array<'analysis' | 'announce'>
} {
  let seen = 0
  const drain = async () => {
    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    )
    const fresh = jobs.slice(seen)
    seen = jobs.length
    const out: Array<{ companyId: Id<'companies'>; kind: 'analysis' | 'announce' }> = []
    for (const job of fresh) {
      const args = job.args[0] as {
        refs?: Array<{ companyId: Id<'companies'> }>
        companyId?: Id<'companies'>
      }
      if (job.name.endsWith('vascoNotify:announce') && args.companyId)
        out.push({ companyId: args.companyId, kind: 'announce' })
      else if (job.name.endsWith('runAnalysisBatch'))
        for (const ref of args.refs ?? [])
          out.push({ companyId: ref.companyId, kind: 'analysis' })
      else if (job.name.endsWith('runAnalysis') && args.companyId)
        out.push({ companyId: args.companyId, kind: 'analysis' })
    }
    return out
  }
  let pending: Array<{ companyId: Id<'companies'>; kind: 'analysis' | 'announce' }> = []
  return {
    queued: async () => {
      pending = await drain()
      return pending.map((p) => p.companyId)
    },
    queuedKinds: () => pending.map((p) => p.kind),
  }
}

describe('VASCO report → AI synthesis', () => {
  test('a communication absent from the previous snapshot is analyzed', async () => {
    const { t, org } = await orgSetup()
    const { queued } = watchQueue(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })

    expect(await queued()).toEqual([companyId])
  })

  test('re-pulling the same set analyzes nothing', async () => {
    const { t, org } = await orgSetup('org-vasco-idem')
    const { queued } = watchQueue(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    const communications = [comm('c1', 'iss-1'), comm('c2', 'iss-1')]
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications,
    })
    expect(await queued()).toEqual([companyId])

    // Second cron tick, identical portal content.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications,
    })

    expect(await queued()).toEqual([])
  })

  test('only the entities of the issuers that published are analyzed', async () => {
    const { t, org } = await orgSetup('org-vasco-scope')
    const { queued } = watchQueue(t)
    const alpha = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    const beta = await createPortfolioCompany(t, org.orgId, 'SPV Beta')
    await linkToIssuer(t, alpha, 'iss-1')
    await linkToIssuer(t, beta, 'iss-2')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-2')],
    })
    expect(await queued()).toEqual([alpha, beta])

    // Only iss-2 publishes again.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-2'), comm('c3', 'iss-2')],
    })

    expect(await queued()).toEqual([beta])
  })

  test('an unlinked issuer and an archived entity are never analyzed', async () => {
    const { t, org } = await orgSetup('org-vasco-quiet')
    const { queued } = watchQueue(t)
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

    expect(await queued()).toEqual([])
  })

  test('another client of the same org does not mask an arrival', async () => {
    const { t, org } = await orgSetup('org-vasco-multi')
    const { queued } = watchQueue(t)
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
    expect(await queued()).toEqual([])

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })

    expect(await queued()).toEqual([companyId])
  })

  test('linking an entity to its issuer analyzes it right away', async () => {
    const { t, user, org } = await orgSetup('org-vasco-link')
    const { queued } = watchQueue(t)
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')

    // The cache is filled BEFORE the link — that is the real order: issuers
    // are picked from the cached list. Nothing to analyze yet.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    expect(await queued()).toEqual([])

    await user.as.mutation(api.companies.setVascoLink, {
      id: companyId,
      clientSlug: CLIENT,
      issuerId: 'iss-1',
    })

    expect(await queued()).toEqual([companyId])
  })
})

describe('the cache is upserted, and an arrival is announced once', () => {
  test('a known communication keeps its row and its announced marker', async () => {
    const { t, org } = await orgSetup('org-upsert')
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    const before = await t.run(async (ctx) =>
      ctx.db.query('vascoCommunicationsCache').collect(),
    )
    expect(before).toHaveLength(1)
    // First fill = bootstrap: stamped as already announced, nothing to mail.
    expect(before[0].announcedAt).toBeTypeOf('number')

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-1')],
    })
    const after = await t.run(async (ctx) =>
      ctx.db.query('vascoCommunicationsCache').collect(),
    )
    const kept = after.find((r) => r.communicationId === 'c1')
    const arrived = after.find((r) => r.communicationId === 'c2')
    // Same row id: the known one was patched, never deleted and recreated.
    expect(kept?._id).toBe(before[0]._id)
    expect(kept?.announcedAt).toBe(before[0].announcedAt)
    // The new one is un-announced — it is what the mail will claim.
    expect(arrived?.announcedAt).toBeUndefined()
  })

  test('a communication the portal stopped listing leaves the cache', async () => {
    const { t, org } = await orgSetup('org-gone')
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-1')],
    })
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    const rows = await t.run(async (ctx) =>
      ctx.db.query('vascoCommunicationsCache').collect(),
    )
    expect(rows.map((r) => r.communicationId)).toEqual(['c1'])
  })

  test('the first fill analyzes but never announces', async () => {
    const { t, org } = await orgSetup('org-bootstrap')
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')
    const { queued, queuedKinds } = watchQueue(t)

    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-1')],
    })
    expect(await queued()).toEqual([companyId])
    expect(queuedKinds()).toEqual(['analysis'])

    // Next publication: same entity, but this one IS news.
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-1'), comm('c3', 'iss-1')],
    })
    expect(await queued()).toEqual([companyId])
    expect(queuedKinds()).toEqual(['announce'])
  })

  test('an arrival is claimed once — a replay finds nothing to say', async () => {
    const { t, org } = await orgSetup('org-claim')
    const companyId = await createPortfolioCompany(t, org.orgId, 'SPV Alpha')
    await linkToIssuer(t, companyId, 'iss-1')
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-1')],
    })

    const first = await t.mutation(internal.vascoNotify.claimArrivals, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: 'iss-1',
    })
    expect(first.map((a) => a.title)).toEqual(['Reporting c2'])

    // Same claim again (a scheduler retry): already stamped, so nothing.
    const second = await t.mutation(internal.vascoNotify.claimArrivals, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: 'iss-1',
    })
    expect(second).toEqual([])
  })

  test('an arrival on another issuer is not claimed by this one', async () => {
    const { t, org } = await orgSetup('org-claim-scope')
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1')],
    })
    await t.mutation(internal.vasco.replaceCommunicationsCache, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      communications: [comm('c1', 'iss-1'), comm('c2', 'iss-2')],
    })

    const claimed = await t.mutation(internal.vascoNotify.claimArrivals, {
      orgId: org.orgId,
      clientSlug: CLIENT,
      issuerId: 'iss-1',
    })
    expect(claimed).toEqual([])
  })
})
