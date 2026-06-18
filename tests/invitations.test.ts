/**
 * Pure tests for the invitation predicates (convex/lib/invitations.ts) that
 * back `invitations.accept` (email match) and the token-gated verification
 * bypass in the `user.create.before` hook (convex/auth.ts).
 *
 * The DB orchestration (idempotent replay, member insertion, session
 * chaining) needs a running deployment and is covered by the manual E2E
 * checklist in TESTING.md — these tests pin the decision logic.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emailsMatch,
  isInviteLiveForSignup,
  normalizeEmail,
} from '../convex/lib/invitations'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com')
  })
})

describe('emailsMatch', () => {
  it('matches regardless of case and surrounding whitespace', () => {
    assert.equal(emailsMatch('Alice@Example.com', ' alice@example.com '), true)
  })

  it('rejects genuinely different addresses', () => {
    assert.equal(emailsMatch('alice@example.com', 'bob@example.com'), false)
  })
})

describe('isInviteLiveForSignup', () => {
  const now = 1_000_000
  const base = { email: 'invitee@org.com', expiresAt: now + 1000 }

  it('accepts a pending, unexpired invite for the matching email', () => {
    assert.equal(isInviteLiveForSignup(base, 'invitee@org.com', now), true)
  })

  it('accepts despite different casing / whitespace on the signup email', () => {
    assert.equal(
      isInviteLiveForSignup(base, '  Invitee@Org.com ', now),
      true,
    )
  })

  it('rejects an already-accepted invite', () => {
    assert.equal(
      isInviteLiveForSignup({ ...base, acceptedAt: now - 1 }, 'invitee@org.com', now),
      false,
    )
  })

  it('rejects an expired invite', () => {
    assert.equal(
      isInviteLiveForSignup({ ...base, expiresAt: now - 1 }, 'invitee@org.com', now),
      false,
    )
  })

  it('rejects when the signup email is a different address', () => {
    assert.equal(isInviteLiveForSignup(base, 'someone-else@org.com', now), false)
  })
})
