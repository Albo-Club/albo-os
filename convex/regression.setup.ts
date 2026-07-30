/// <reference types="vite/client" />
/**
 * Shared harness for the Convex regression suite (regression.*.test.ts).
 *
 * Everything runs against convex-test's in-memory backend — no network, no
 * dev/prod deployment. Auth goes through the real Better Auth component
 * (registered via the official @convex-dev/better-auth/test helper): a user
 * is a row in the component's `user` + `session` tables plus an app `users`
 * row, and requests are authenticated with `t.withIdentity({ subject,
 * sessionId })`, exactly the claims `safeGetAuthUser` resolves in prod.
 *
 * The filename carries two dots on purpose: the Convex CLI skips any module
 * whose basename contains more than one dot, so this file (and the test
 * files) are never bundled into a deployment.
 */
import betterAuthTest from '@convex-dev/better-auth/test'
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { components } from './_generated/api'
import schema from './schema'
import type { TestConvex } from 'convex-test'
import type { UserIdentity } from 'convex/server'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

export type Harness = TestConvex<typeof schema>

/** Fresh in-memory backend with the Better Auth component registered. */
export function setupHarness(): Harness {
  const t = convexTest(schema, modules)
  betterAuthTest.register(t, 'betterAuth')
  return t
}

export type TestUser = {
  userId: Id<'users'>
  /** Accessor authenticated as this user (t.query/t.mutation/t.run). */
  as: ReturnType<Harness['withIdentity']>
}

/**
 * Creates a fully authenticated user: Better Auth component `user` +
 * `session` rows, the mirrored app `users` row, and an identity carrying the
 * `subject` / `sessionId` claims that `authComponent.safeGetAuthUser` reads.
 */
export async function createUser(
  t: Harness,
  email: string,
  opts: { superAdmin?: boolean } = {},
): Promise<TestUser> {
  const now = Date.now()
  const baUser = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: {
        name: email,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    },
  })
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: 'session',
      data: {
        userId: baUser._id,
        token: `test-token-${email}`,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
      },
    },
  })
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      betterAuthId: baUser._id as string,
      email,
      name: email,
      superAdmin: opts.superAdmin ?? false,
      createdAt: now,
    })
  })
  const identity = {
    subject: baUser._id as string,
    sessionId: session._id as string,
  } as Partial<UserIdentity>
  return { userId, as: t.withIdentity(identity) }
}

export type TestOrg = {
  orgId: Id<'organizations'>
  /** The org's `group_root` company (valid deal investor). */
  rootCompanyId: Id<'companies'>
}

/**
 * Creates an org with its `group_root` company and the given memberships.
 * The first member is also the org creator.
 */
export async function createOrg(
  t: Harness,
  slug: string,
  members: Array<{ userId: Id<'users'>; role: 'owner' | 'admin' | 'member' }>,
): Promise<TestOrg> {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const orgId = await ctx.db.insert('organizations', {
      slug,
      name: slug,
      createdBy: members[0].userId,
      createdAt: now,
    })
    for (const member of members) {
      await ctx.db.insert('organizationMembers', {
        orgId,
        userId: member.userId,
        role: member.role,
        joinedAt: now,
      })
    }
    const rootCompanyId = await ctx.db.insert('companies', {
      orgId,
      name: `${slug}-root`,
      kind: 'group_root',
    })
    return { orgId, rootCompanyId }
  })
}

/** Portfolio company in an org (valid deal target, invalid investor). */
export async function createPortfolioCompany(
  t: Harness,
  orgId: Id<'organizations'>,
  name: string,
): Promise<Id<'companies'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('companies', { orgId, name, kind: 'portfolio' })
  })
}

/** EUR bank account owned by the org's root company. */
export async function createBankAccount(
  t: Harness,
  org: TestOrg,
  opts: { currentBalance?: number } = {},
): Promise<Id<'bankAccounts'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('bankAccounts', {
      orgId: org.orgId,
      ownerCompanyId: org.rootCompanyId,
      bankName: 'Test Bank',
      label: 'Compte test',
      currency: 'EUR',
      currentBalance: opts.currentBalance,
    })
  })
}

/** Unmatched manual transaction on the given account. */
export async function createTransaction(
  t: Harness,
  orgId: Id<'organizations'>,
  bankAccountId: Id<'bankAccounts'>,
  opts: {
    direction: 'in' | 'out'
    amount: number
    rawLabel?: string
    transactionDate?: number
  },
): Promise<Id<'transactions'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('transactions', {
      orgId,
      bankAccountId,
      direction: opts.direction,
      amount: opts.amount,
      transactionDate: opts.transactionDate ?? Date.now(),
      rawLabel: opts.rawLabel ?? 'test transaction',
      source: 'manual',
      matchStatus: 'unmatched',
      reconciled: false,
    })
  })
}

/**
 * Asserts that a call rejects with the given ConvexError code (our internal
 * error convention: `throw new ConvexError('some_code')`).
 */
export async function expectConvexError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let outcome: unknown = null
  let threw = false
  try {
    await promise
  } catch (err) {
    threw = true
    outcome = err
  }
  if (!threw) {
    throw new Error(`Expected ConvexError('${code}') but the call succeeded`)
  }
  if (outcome instanceof ConvexError && outcome.data === code) return
  // convex-test can rethrow wrapped errors — fall back to a message match.
  if (outcome instanceof Error && outcome.message.includes(code)) return
  throw new Error(
    `Expected ConvexError('${code}') but got: ${String(outcome)}`,
  )
}
