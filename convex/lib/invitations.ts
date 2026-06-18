/**
 * Pure invitation predicates, extracted so the matching / validity rules can
 * be unit-tested without a Convex harness (tests/invitations.test.ts). The
 * Convex functions in `convex/invitations.ts` and the Better Auth
 * `user.create.before` hook in `convex/auth.ts` are thin wrappers around
 * these.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Case-insensitive, whitespace-tolerant email equality. */
export function emailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b)
}

type InviteForSignup = {
  email: string
  acceptedAt?: number
  expiresAt: number
}

/**
 * Is this invitation a valid basis to skip email verification for a signup of
 * `signupEmail`? True only when it is still pending (not yet accepted), not
 * expired at `now`, and addressed to `signupEmail`. This is the token-gated
 * trust check: following the signed, single-use link proves inbox possession.
 */
export function isInviteLiveForSignup(
  inv: InviteForSignup,
  signupEmail: string,
  now: number,
): boolean {
  if (inv.acceptedAt) return false
  if (inv.expiresAt < now) return false
  return emailsMatch(inv.email, signupEmail)
}
