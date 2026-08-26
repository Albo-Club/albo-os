/// <reference types="vite/client" />
/**
 * Regression: what `invitations.preview` tells the accept page about the
 * invitee's account.
 *
 * The page branches on `accountState`, and getting it wrong is what stranded
 * an invitee: a Better Auth row that nobody had ever verified was reported as
 * an existing account, so the page asked for a password that had never been
 * set — with no way to set one. The three states must stay distinct.
 */
import { describe, expect, test } from 'vitest'
import { api, components, internal } from './_generated/api'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'

const TOKEN = 'invite-token'

async function inviteTo(t: Harness, email: string) {
  const inviter = await createUser(t, 'inviter@test.dev')
  const org = await createOrg(t, 'calte', [
    { userId: inviter.userId, role: 'owner' },
  ])
  await t.run(async (ctx) => {
    await ctx.db.insert('invitations', {
      orgId: org.orgId,
      email,
      role: 'member',
      token: TOKEN,
      invitedBy: inviter.userId,
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
  })
}

/** Better Auth row with no proof anyone owns the mailbox. */
async function createUnverifiedBaUser(t: Harness, email: string) {
  const now = Date.now()
  await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: {
        name: email,
        email,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  })
}

describe('invitations.preview: accountState', () => {
  test('none when no Better Auth row carries the invited email', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    // The inviter has an account — it must not count for the invitee.
    expect(
      await t.query(api.invitations.preview, { token: TOKEN }),
    ).toMatchObject({ kind: 'ok', accountState: 'none' })
  })

  test('claimable when the row exists but is unverified', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    await createUnverifiedBaUser(t, 'ghost@gmail.com')
    expect(
      await t.query(api.invitations.preview, { token: TOKEN }),
    ).toMatchObject({ kind: 'ok', accountState: 'claimable' })
  })

  test('active when the row is verified', async () => {
    const t = setupHarness()
    await inviteTo(t, 'known@gmail.com')
    await createUser(t, 'known@gmail.com')
    expect(
      await t.query(api.invitations.preview, { token: TOKEN }),
    ).toMatchObject({ kind: 'ok', accountState: 'active' })
  })
})

describe('invitations.liveInviteEmail', () => {
  test('resolves a live token to the invited email', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    expect(
      await t.query(internal.invitations.liveInviteEmail, { token: TOKEN }),
    ).toBe('ghost@gmail.com')
  })

  test('returns null for an unknown token', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    expect(
      await t.query(internal.invitations.liveInviteEmail, { token: 'nope' }),
    ).toBeNull()
  })

  test('returns null once the invitation is accepted', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    await t.run(async (ctx) => {
      const inv = await ctx.db
        .query('invitations')
        .withIndex('by_token', (q) => q.eq('token', TOKEN))
        .unique()
      await ctx.db.patch('invitations', inv!._id, { acceptedAt: Date.now() })
    })
    expect(
      await t.query(internal.invitations.liveInviteEmail, { token: TOKEN }),
    ).toBeNull()
  })

  test('returns null once the invitation has expired', async () => {
    const t = setupHarness()
    await inviteTo(t, 'ghost@gmail.com')
    await t.run(async (ctx) => {
      const inv = await ctx.db
        .query('invitations')
        .withIndex('by_token', (q) => q.eq('token', TOKEN))
        .unique()
      await ctx.db.patch('invitations', inv!._id, {
        expiresAt: Date.now() - 1,
      })
    })
    expect(
      await t.query(internal.invitations.liveInviteEmail, { token: TOKEN }),
    ).toBeNull()
  })
})
