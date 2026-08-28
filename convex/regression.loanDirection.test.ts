/// <reference types="vite/client" />
/**
 * Regression: `migrations/fixLoanDirection` (ALB-128 follow-up).
 *
 * A current account entered backwards is only visible through the movements:
 * both derived balances contradict the recorded roles. The swap must fix that
 * — and must refuse to run twice, since swapping again puts the error back.
 */
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import {
  createBankAccount,
  createOrg,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

// Addressed by path: `_generated/api.d.ts` only learns about a new module
// when a Convex deployment regenerates it (CLAUDE.md § Anti-patterns).
type InspectResult = Array<{
  loanId: Id<'intercompanyLoans'>
  from: { slug: string | null; name: string | null }
  to: { slug: string | null; name: string | null }
  creditorSide: { balanceCents: number; allocatedTransactions: number }
  debtorSide: { balanceCents: number; allocatedTransactions: number }
  looksReversed: boolean
}>

const inspectRef = makeFunctionReference<
  'query',
  Record<string, never>,
  InspectResult
>('migrations/fixLoanDirection:inspect')

const applyRef = makeFunctionReference<
  'mutation',
  {
    loanId: Id<'intercompanyLoans'>
    currentFromSlug: string
    currentToSlug: string
  },
  { swapped: true; creditor: string | null; debtor: string | null }
>('migrations/fixLoanDirection:apply')

/**
 * Two orgs and a loan recorded `albo → calte` (Albo as creditor), while the
 * movements say the opposite: calte pays out, albo cashes in.
 */
async function reversedLoanSetup(t: Harness) {
  const user = await createUser(t, 'owner@test.dev')
  const calte = await createOrg(t, 'calte', [
    { userId: user.userId, role: 'owner' },
  ])
  const albo = await createOrg(t, 'albo', [
    { userId: user.userId, role: 'owner' },
  ])
  const calteAccount = await createBankAccount(t, calte)
  const alboAccount = await createBankAccount(t, albo)

  const loanId = await t.run(async (ctx) =>
    ctx.db.insert('intercompanyLoans', {
      fromOrgId: albo.orgId, // recorded creditor — wrong
      toOrgId: calte.orgId, // recorded debtor — wrong
      isBlocked: false,
      openedDate: Date.now(),
    }),
  )

  // CALTE pays out 250 000 €, Albo receives it: the lender is CALTE.
  const allocate = async (
    orgId: Id<'organizations'>,
    accountId: Id<'bankAccounts'>,
    direction: 'in' | 'out',
  ) => {
    const txId = await createTransaction(t, orgId, accountId, {
      direction,
      amount: 25_000_000,
    })
    await t.run(async (ctx) => {
      await ctx.db.patch('transactions', txId, {
        matchStatus: 'matched',
        allocation: { kind: 'intercompany_loan', targetId: loanId },
      })
    })
  }
  await allocate(calte.orgId, calteAccount, 'out')
  await allocate(albo.orgId, alboAccount, 'in')

  return { user, calte, albo, loanId }
}

describe('fixLoanDirection: inspect', () => {
  test('flags a loan whose movements contradict the recorded roles', async () => {
    const t = setupHarness()
    await reversedLoanSetup(t)

    const [loan] = await t.query(inspectRef, {})
    expect(loan.from.slug).toBe('albo')
    expect(loan.to.slug).toBe('calte')
    // The recorded creditor cashed in, the recorded debtor paid out.
    expect(loan.creditorSide.balanceCents).toBe(-25_000_000)
    expect(loan.debtorSide.balanceCents).toBe(25_000_000)
    expect(loan.looksReversed).toBe(true)
  })

  test('does not flag a loan recorded the right way round', async () => {
    const t = setupHarness()
    const { loanId, calte, albo } = await reversedLoanSetup(t)
    await t.run(async (ctx) => {
      await ctx.db.patch('intercompanyLoans', loanId, {
        fromOrgId: calte.orgId,
        toOrgId: albo.orgId,
      })
    })

    const [loan] = await t.query(inspectRef, {})
    expect(loan.creditorSide.balanceCents).toBe(25_000_000)
    expect(loan.debtorSide.balanceCents).toBe(-25_000_000)
    expect(loan.looksReversed).toBe(false)
  })
})

describe('fixLoanDirection: apply', () => {
  test('swaps the roles, and the balances then read correctly', async () => {
    const t = setupHarness()
    const { loanId } = await reversedLoanSetup(t)

    const result = await t.mutation(applyRef, {
      loanId,
      currentFromSlug: 'albo',
      currentToSlug: 'calte',
    })
    expect(result).toMatchObject({ creditor: 'calte', debtor: 'albo' })

    const [loan] = await t.query(inspectRef, {})
    expect(loan.from.slug).toBe('calte')
    expect(loan.to.slug).toBe('albo')
    expect(loan.creditorSide.balanceCents).toBe(25_000_000) // receivable
    expect(loan.debtorSide.balanceCents).toBe(-25_000_000) // debt
    expect(loan.looksReversed).toBe(false)
  })

  test('refuses a second run instead of putting the error back', async () => {
    const t = setupHarness()
    const { loanId } = await reversedLoanSetup(t)
    const args = {
      loanId,
      currentFromSlug: 'albo',
      currentToSlug: 'calte',
    }
    await t.mutation(applyRef, args)

    await expectConvexError(
      t.mutation(applyRef, args),
      'direction_mismatch:calte->albo',
    )
  })
})
