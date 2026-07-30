/// <reference types="vite/client" />
/**
 * Regression: liabilities (passif) — convex/liabilities.ts.
 *
 * Invariant (KNOWN_ISSUES « Passif »): C/C balances are NEVER stored — each
 * org derives its balance from ITS OWN transactions allocated to the loan
 * (Σ out − Σ in). Allocating / deallocating a transaction must therefore be
 * immediately reflected in `getLiabilities`.
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
  test('each org derives its own signed balance from its allocated legs', async () => {
    const { t, user, fromOrg, toOrg, loanId } = await loanSetup()
    const fromAccount = await createBankAccount(t, fromOrg)
    const toAccount = await createBankAccount(t, toOrg)
    // One leg per org: out on the creditor side, in on the debtor side.
    const fromTx = await createTransaction(t, fromOrg.orgId, fromAccount, {
      direction: 'out',
      amount: 10_000_000, // 100 000 €
    })
    const toTx = await createTransaction(t, toOrg.orgId, toAccount, {
      direction: 'in',
      amount: 10_000_000,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: fromTx,
      kind: 'intercompany_loan',
      targetId: loanId,
    })
    await user.as.mutation(api.liabilities.allocateTransaction, {
      transactionId: toTx,
      kind: 'intercompany_loan',
      targetId: loanId,
    })

    const fromSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: fromOrg.orgId,
    })
    expect(fromSide.loans).toHaveLength(1)
    expect(fromSide.loans[0]).toMatchObject({
      side: 'creditor',
      balanceCents: 10_000_000, // + = receivable
    })
    expect(fromSide.loans[0].transactions).toHaveLength(1)

    const toSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: toOrg.orgId,
    })
    expect(toSide.loans).toHaveLength(1)
    expect(toSide.loans[0]).toMatchObject({
      side: 'debtor',
      balanceCents: -10_000_000, // − = debt
    })
    expect(toSide.loans[0].transactions).toHaveLength(1)
  })

  test('a partial repayment moves the derived balance, deallocating restores it', async () => {
    const { t, user, fromOrg, toOrg, loanId } = await loanSetup()
    const fromAccount = await createBankAccount(t, fromOrg)
    const advance = await createTransaction(t, fromOrg.orgId, fromAccount, {
      direction: 'out',
      amount: 10_000_000,
    })
    const repayment = await createTransaction(t, fromOrg.orgId, fromAccount, {
      direction: 'in',
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

    let fromSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: fromOrg.orgId,
    })
    expect(fromSide.loans[0].balanceCents).toBe(6_000_000)

    // The allocation flips the tx to `matched` without a dealId.
    const tx = await t.run(async (ctx) => ctx.db.get('transactions', repayment))
    expect(tx).toMatchObject({
      matchStatus: 'matched',
      allocation: { kind: 'intercompany_loan', targetId: loanId },
    })
    expect(tx?.dealId).toBeUndefined()

    // Deallocating the repayment restores the full receivable.
    await user.as.mutation(api.liabilities.deallocateTransaction, {
      transactionId: repayment,
    })
    fromSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: fromOrg.orgId,
    })
    expect(fromSide.loans[0].balanceCents).toBe(10_000_000)
    const deallocated = await t.run(async (ctx) =>
      ctx.db.get('transactions', repayment),
    )
    expect(deallocated).toMatchObject({ matchStatus: 'unmatched' })
    expect(deallocated?.allocation).toBeUndefined()

    // The debtor org never allocated anything: its side stays at 0 (the
    // divergence is a reconciliation signal, never a shared stored balance).
    const toSide = await user.as.query(api.liabilities.getLiabilities, {
      orgId: toOrg.orgId,
    })
    expect(toSide.loans[0].balanceCents).toBe(0)
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
