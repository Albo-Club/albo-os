/// <reference types="vite/client" />
/**
 * Regression: who the report circuit recognizes, and who it refuses to talk to
 * (ALB-115, groupe de transfert).
 *
 * The rule this file defends: an alias is an IDENTITY MAP, not an access
 * grant. It never decides whether a mail is processed — the content does — it
 * decides who is entitled to an answer. Two ways to break it by accident:
 * giving one address to two people (who gets the confirmation becomes a coin
 * toss), and letting the mailing group's own address be claimed by someone
 * (the loop guard would then be answering itself).
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  createOrg,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

describe('memberByEmail — account address or declared alias', () => {
  test('an alias resolves to its member, an unknown address to nobody', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])

    await ben.as.mutation(api.organizations.addMemberAlias, {
      orgId: org.orgId,
      userId: ben.userId,
      email: 'ben.perso@gmail.com',
    })

    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'ben.perso@gmail.com',
      }),
    ).toEqual({ userId: ben.userId })
    // Same person, account address — unchanged behaviour.
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'benjamin@alboteam.com',
      }),
    ).toEqual({ userId: ben.userId })
    // A founder writing in: processed by the pipeline, never answered.
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'founder@sezame.io',
      }),
    ).toBeNull()
  })

  test('an alias of a user who belongs to no org grants nothing', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    const outsider = await createUser(t, 'outsider@test.dev')

    // Ben is an admin of the org, but the target is not a member of it.
    await expectConvexError(
      ben.as.mutation(api.organizations.addMemberAlias, {
        orgId: org.orgId,
        userId: outsider.userId,
        email: 'outsider.perso@gmail.com',
      }),
      'not_found',
    )
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'outsider.perso@gmail.com',
      }),
    ).toBeNull()
  })
})

describe('addMemberAlias — one address, one owner', () => {
  test('refuses an address that is already an account or another alias', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const clement = await createUser(t, 'clement@alboteam.com')
    const org = await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: clement.userId, role: 'admin' },
    ])

    await expectConvexError(
      ben.as.mutation(api.organizations.addMemberAlias, {
        orgId: org.orgId,
        userId: ben.userId,
        email: 'clement@alboteam.com',
      }),
      'email_taken',
    )

    await ben.as.mutation(api.organizations.addMemberAlias, {
      orgId: org.orgId,
      userId: ben.userId,
      email: 'shared@gmail.com',
    })
    await expectConvexError(
      clement.as.mutation(api.organizations.addMemberAlias, {
        orgId: org.orgId,
        userId: clement.userId,
        email: 'SHARED@gmail.com',
      }),
      'email_taken',
    )
  })

  test('refuses the forwarding group address, in any casing', async () => {
    const t = setupHarness()
    const previous = process.env.REPORT_GROUP_ADDRESSES
    process.env.REPORT_GROUP_ADDRESSES = 'report@alboteam.com'
    try {
      const ben = await createUser(t, 'benjamin@alboteam.com')
      const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
      await expectConvexError(
        ben.as.mutation(api.organizations.addMemberAlias, {
          orgId: org.orgId,
          userId: ben.userId,
          email: 'Report@Alboteam.com',
        }),
        'blocked_address',
      )
    } finally {
      if (previous === undefined) delete process.env.REPORT_GROUP_ADDRESSES
      else process.env.REPORT_GROUP_ADDRESSES = previous
    }
  })

  test('a plain member cannot declare an address for someone else', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const clement = await createUser(t, 'clement@alboteam.com')
    const org = await createOrg(t, 'albo', [
      { userId: ben.userId, role: 'owner' },
      { userId: clement.userId, role: 'member' },
    ])

    await expectConvexError(
      clement.as.mutation(api.organizations.addMemberAlias, {
        orgId: org.orgId,
        userId: ben.userId,
        email: 'ben.perso@gmail.com',
      }),
      'insufficient_role',
    )
    // Their own line, on the other hand, is theirs to edit.
    await clement.as.mutation(api.organizations.addMemberAlias, {
      orgId: org.orgId,
      userId: clement.userId,
      email: 'clement.perso@gmail.com',
    })
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'clement.perso@gmail.com',
      }),
    ).toEqual({ userId: clement.userId })
  })

  test('refuses something that is not an email address', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    await expectConvexError(
      ben.as.mutation(api.organizations.addMemberAlias, {
        orgId: org.orgId,
        userId: ben.userId,
        email: 'pas-une-adresse',
      }),
      'invalid_email',
    )
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

describe('removeMemberAlias — the answer stops with the address', () => {
  test('a removed alias no longer resolves to its member', async () => {
    const t = setupHarness()
    const ben = await createUser(t, 'benjamin@alboteam.com')
    const org = await createOrg(t, 'albo', [{ userId: ben.userId, role: 'owner' }])
    await ben.as.mutation(api.organizations.addMemberAlias, {
      orgId: org.orgId,
      userId: ben.userId,
      email: 'ben.perso@gmail.com',
    })

    const aliases = await ben.as.query(api.organizations.listMemberAliases, {
      orgId: org.orgId,
    })
    expect(aliases.map((a) => a.email)).toEqual(['ben.perso@gmail.com'])

    await ben.as.mutation(api.organizations.removeMemberAlias, {
      orgId: org.orgId,
      aliasId: aliases[0]._id,
    })
    expect(
      await t.query(internal.reportNotify.memberByEmail, {
        email: 'ben.perso@gmail.com',
      }),
    ).toBeNull()
  })
})
