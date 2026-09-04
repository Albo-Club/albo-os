/// <reference types="vite/client" />
/**
 * Regression: liabilities (passif) — convex/liabilities.ts.
 *
 * Two invariants (KNOWN_ISSUES « Passif »):
 * - C/C balances are NEVER stored — the debtor derives its balance from ITS
 *   OWN transactions allocated to the loan (Σ out − Σ in), so allocating /
 *   deallocating is immediately reflected in `getLiabilities`.
 * - ONLY the debtor carries a C/C. The creditor's side of the same advance
 *   is an asset (a `cca` deal on the borrower), so it neither appears in its
 *   Passif nor accepts an allocation.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  createBankAccount,
  createOrg,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

async function loanSetup() {
  const t = setupHarness()
  const user = await createUser(t, 'passif@test.dev')
  // Creditor (from) and debtor (to) orgs — the same user is member of both.
  const fromOrg = await createOrg(t, 'org-creditor', [
    { userId: user.userId, role: 'owner' },
  ])
  const toOrg = await createOrg(t, 'org-debtor', [
    { userId: user.userId, role: 'owner' },
  ])
  const loanId = await user.as.mutation(api.liabilities.createIntercompanyLoan, {
    fromOrgId: fromOrg.orgId,
    toOrgId: toOrg.orgId,
    isBlocked: false,
    openedDate: Date.now(),
  })
  return { t, user, fromOrg, toOrg, loanId }
}

describe('liabilities: C/C balances derived from transactions', () => {
  test('only the debtor carries the C/C and derives its balance from its legs', async () => {
    const { t, user, fromOrg, toOrg, loanId } = await loanSetup()
    const fromAccount = await createBankAccount(t, fromOrg)
    const toAccount = await createBankAccount(t, toOrg)
    // The debtor's leg: it receives the advance.
    const toTx = await createTransaction(t, toOrg.orgId, toAccount, {
      direction: 'in',
      amount: 10_000_000, // 100 000 €
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: toTx,
      kind: 'intercompany_loan',
      targetId: loanId,
    })

    const toSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: toOrg.orgId,
    })
    expect(toSide.loans).toHaveLength(1)
    expect(toSide.loans[0]).toMatchObject({ balanceCents: -10_000_000 })
    expect(toSide.loans[0].transactions).toHaveLength(1)

    // The creditor's leg is refused: its side of the advance is a `cca`
    // deal, never a liability.
    const fromTx = await createTransaction(t, fromOrg.orgId, fromAccount, {
      direction: 'out',
      amount: 10_000_000,
    })
    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: fromTx,
        kind: 'intercompany_loan',
        targetId: loanId,
      }),
      'loan_wrong_side',
    )

    // ... and the creditor does not see the C/C at all.
    const fromSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: fromOrg.orgId,
    })
    expect(fromSide.loans).toHaveLength(0)
  })

  test('a partial repayment moves the derived balance, deallocating restores it', async () => {
    const { t, user, toOrg, loanId } = await loanSetup()
    const toAccount = await createBankAccount(t, toOrg)
    const advance = await createTransaction(t, toOrg.orgId, toAccount, {
      direction: 'in',
      amount: 10_000_000,
    })
    const repayment = await createTransaction(t, toOrg.orgId, toAccount, {
      direction: 'out',
      amount: 4_000_000,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: advance,
      kind: 'intercompany_loan',
      targetId: loanId,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: repayment,
      kind: 'intercompany_loan',
      targetId: loanId,
    })

    let toSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: toOrg.orgId,
    })
    expect(toSide.loans[0].balanceCents).toBe(-6_000_000)

    // The allocation flips the tx to `matched` without a dealId.
    const tx = await t.run(async (ctx) => ctx.db.get('transactions', repayment))
    expect(tx).toMatchObject({
      matchStatus: 'matched',
      allocation: { kind: 'intercompany_loan', targetId: loanId },
    })
    expect(tx?.dealId).toBeUndefined()

    // Deallocating the repayment restores the full debt.
    await user.as.mutation(api.liabilities.deallocateTransaction, {
      transactionId: repayment,
    })
    toSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: toOrg.orgId,
    })
    expect(toSide.loans[0].balanceCents).toBe(-10_000_000)
    const deallocated = await t.run(async (ctx) =>
      ctx.db.get('transactions', repayment),
    )
    expect(deallocated).toMatchObject({ matchStatus: 'unmatched' })
    expect(deallocated?.allocation).toBeUndefined()
  })

  test('allocating a transaction to a loan the org is not a party to is refused', async () => {
    const { t, user, loanId } = await loanSetup()
    const thirdOrg = await createOrg(t, 'org-third', [
      { userId: user.userId, role: 'owner' },
    ])
    const thirdAccount = await createBankAccount(t, thirdOrg)
    const thirdTx = await createTransaction(t, thirdOrg.orgId, thirdAccount, {
      direction: 'out',
      amount: 1_000_000,
    })

    await expectConvexError(
      user.as.mutation(api.liabilities.allocateTransaction, {
        transactionId: thirdTx,
        kind: 'intercompany_loan',
        targetId: loanId,
      }),
      'loan_wrong_org',
    )
  })
})

describe('liabilities: equity allocations', () => {
  test('an equity allocation shows on the position and is deal-exclusive', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'equity@test.dev')
    const org = await createOrg(t, 'org-equity', [
      { userId: user.userId, role: 'owner' },
    ])
    const positionId = await user.as.mutation(
      api.liabilities.createEquityPosition,
      {
        orgId: org.orgId,
        holderLabel: 'Holder X',
        type: 'capital_social',
        amountCents: 1_000_000,
        effectiveDate: Date.now(),
      },
    )
    const accountId = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, accountId, {
      direction: 'in',
      amount: 1_000_000,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: txId,
      kind: 'equity',
      targetId: positionId,
    })

    const liabilities = await user.as.query(api.liabilities.getLiabilities, {
      orgId: org.orgId,
    })
    expect(liabilities.equityPositions).toHaveLength(1)
    expect(liabilities.equityPositions[0].transactions).toHaveLength(1)
    expect(liabilities.equityPositions[0].transactions[0]._id).toBe(txId)

    // A liability-allocated transaction cannot silently become a deal match.
    const target = await t.run(async (ctx) =>
      ctx.db.insert('companies', {
        orgId: org.orgId,
        name: 'Target',
        kind: 'portfolio',
      }),
    )
    const dealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: target,
      instrumentKind: 'share',
    })
    await expectConvexError(
      user.as.mutation(api.transactions.matchTransaction, {
        transactionId: txId,
        dealId,
      }),
      'allocated_to_liability',
    )
  })
})
