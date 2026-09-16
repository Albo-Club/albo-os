/// <reference types="vite/client" />
/**
 * Regression: who the report circuit is allowed to answer (ALB-115, groupe de
 * transfert).
 *
 * The rule this file defends: being answered and being processed are two
 * different questions. The CONTENT decides whether a mail is filed — a founder
 * writing in directly gets their update classified all the same. Membership
 * decides only who is entitled to a reply, because the confirmation carries
 * amounts, org names and fiche links.
 *
 * A member is recognized by `users.email`, and by nothing else: an address
 * someone forwards from regularly is an account of theirs. The blocked-sender
 * list that keeps the pipeline from answering itself is covered purely in
 * `tests/reportSenders.test.ts`.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'

describe('memberByEmail — the account address, and only it', () => {
  test('each account address resolves to its own member, an unknown one to nobody', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    // The address someone also forwards from is an account of theirs, not a
    // declaration on the side: it resolves because it is a member.
    const benPerso = await createUser(t, 'bouquetbenjamin@gmail.com')
    await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: benPerso.userId, role: 'admin' },
    ])

    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'benjamin@alboteam.com',
      }),
    ).toEqual({ userId: ben.userId })
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'bouquetbenjamin@gmail.com',
      }),
    ).toEqual({ userId: benPerso.userId })
    // A founder writing in: processed by the pipeline, never answered.
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'founder@sezame.io',
      }),
    ).toBeNull()
  })

  test('an account that belongs to no org is answered no more than a stranger', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    await createUser(t, 'outsider@test.dev')

    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'outsider@test.dev',
      }),
    ).toBeNull()
  })
})

describe('the analysis runs whoever sent the mail', () => {
  test('a row with no attributed sender is still claimed for identification', async () => {
    const t = setupHarness()
    // The founder of a participation writing to the open address directly:
    // nobody in `users`, so no `senderUserId` on the row. Being a member is
    // not what earns a mail its analysis — the content is.
    const id = await t.run(async (ctx) =>
      ctx.db.insert('inboundEmails', {
        agentmailInboxId: 'report-albo-os@agentmail.to',
        agentmailMessageId: 'msg-founder-q3',
        fromEmail: 'founder@sezame.io',
        toEmails: ['report@alboteam.com'],
        ccEmails: [],
        subject: 'Sezame — Q3 2026 investor update',
        receivedAt: Date.now(),
        attachments: [],
        status: 'received' as const,
      }),
    )

    expect(
      await t.mutation(internal.reportIdentify.markProcessing, { inboundEmailId: id }),
    ).toBe(true)
    // And the claim is exclusive, as before.
    expect(
      await t.mutation(internal.reportIdentify.markProcessing, { inboundEmailId: id }),
    ).toBe(false)
  })
})
