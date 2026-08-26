/// <reference types="vite/client" />
/**
 * Regression: one forwarded email earns one answer (ALB-145).
 *
 * The forwarder's mailbox is not a log. They sent one email, so they get one
 * reply — whatever happens afterwards inside the queue. Replaying a row from
 * "Reports entrants" ("Retraiter" / "Rattacher") re-runs the whole pipeline,
 * and used to clear `notifiedAt`, so every click sent another recap. Four
 * acknowledgements landed on a single Corma forward that way, and a batch of
 * ~40 replayed rows produced ~40 mails.
 *
 * The guard is therefore never released. The one exception is the good news:
 * a row whose last word was a problem may speak once more, and only to say it
 * finally went through — which is the whole point of replaying it by hand.
 *
 * Two silences are load-bearing and easy to "fix" by mistake later:
 * - a second problem after a first one says nothing (the queue shows it);
 * - a row notified before `notifiedKind` existed says nothing either, because
 *   its outcome is unknown and this bug was an excess of mail, not a lack.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

type Notified = { at?: number; kind?: string }

async function createEmail(
  t: Harness,
  overrides: {
    status?: 'received' | 'needs_review' | 'processed'
    notifiedAt?: number
    notifiedKind?: 'success' | 'failure' | 'quarantine'
  } = {},
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: 'msg-corma-july',
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject: 'Fwd: Corma July 2026 investor update',
      receivedAt: Date.now(),
      attachments: [],
      status: overrides.status ?? 'needs_review',
      statusReason: overrides.status === 'processed' ? undefined : 'no_match',
      notifiedAt: overrides.notifiedAt,
      notifiedKind: overrides.notifiedKind,
    })
  })
}

async function readNotified(t: Harness, id: Id<'inboundEmails'>): Promise<Notified> {
  return await t.run(async (ctx) => {
    const row = await ctx.db.get('inboundEmails', id)
    return { at: row?.notifiedAt, kind: row?.notifiedKind }
  })
}

async function claim(
  t: Harness,
  id: Id<'inboundEmails'>,
  kind: 'success' | 'failure' | 'quarantine',
): Promise<boolean> {
  return await t.mutation(internal.reportNotify.claimNotify, { inboundEmailId: id, kind })
}

describe('claimNotify — one gesture, one answer', () => {
  test('the first outcome always goes out, and records what it announced', async () => {
    const t = setupHarness()
    const id = await createEmail(t)

    expect(await claim(t, id, 'success')).toBe(true)
    expect((await readNotified(t, id)).kind).toBe('success')
  })

  test('a replayed row that succeeded again says nothing', async () => {
    const t = setupHarness()
    const id = await createEmail(t)

    expect(await claim(t, id, 'success')).toBe(true)
    // Five replays from the queue: this is the Corma case.
    for (let i = 0; i < 5; i += 1) {
      expect(await claim(t, id, 'success')).toBe(false)
    }
  })

  test('a problem after a problem stays silent', async () => {
    const t = setupHarness()
    const id = await createEmail(t)

    expect(await claim(t, id, 'failure')).toBe(true)
    expect(await claim(t, id, 'failure')).toBe(false)
    expect(await claim(t, id, 'quarantine')).toBe(false)
  })

  test('a row that failed speaks once more when the replay succeeds', async () => {
    const t = setupHarness()
    const id = await createEmail(t)

    expect(await claim(t, id, 'failure')).toBe(true)
    expect(await claim(t, id, 'success')).toBe(true)
    expect((await readNotified(t, id)).kind).toBe('success')
    // And only once — the recovery is not a new licence to speak.
    expect(await claim(t, id, 'success')).toBe(false)
  })

  test('a quarantined row also earns its recovery mail', async () => {
    const t = setupHarness()
    const id = await createEmail(t)

    expect(await claim(t, id, 'quarantine')).toBe(true)
    expect(await claim(t, id, 'success')).toBe(true)
  })

  test('a row notified before the outcome was recorded stays silent', async () => {
    const t = setupHarness()
    const id = await createEmail(t, { notifiedAt: Date.now() })

    expect(await claim(t, id, 'success')).toBe(false)
    expect(await claim(t, id, 'failure')).toBe(false)
  })
})

describe('replaying a row from the queue keeps the guard', () => {
  async function setup() {
    const t = setupHarness()
    const user = await createUser(t, 'reports@test.dev')
    const albo = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await t.run(async (ctx) => {
      return await ctx.db.insert('companies', {
        orgId: albo.orgId,
        name: 'Corma',
        kind: 'portfolio',
        domain: 'corma.io',
      })
    })
    return { t, user, companyId }
  }

  test('"Retraiter" does not release the notification slot', async () => {
    const { t, user } = await setup()
    const notifiedAt = Date.now()
    const id = await createEmail(t, { notifiedAt, notifiedKind: 'failure' })

    await user.as.mutation(api.reportInbox.reprocess, { inboundEmailId: id })

    expect((await readNotified(t, id)).at).toBe(notifiedAt)
  })

  test('"Rattacher" on an untreated row does not release it either', async () => {
    const { t, user, companyId } = await setup()
    const notifiedAt = Date.now()
    const id = await createEmail(t, { notifiedAt, notifiedKind: 'failure' })

    await user.as.mutation(api.reportInbox.assignCompany, {
      inboundEmailId: id,
      companyIds: [companyId],
    })

    expect((await readNotified(t, id)).at).toBe(notifiedAt)
  })
})
