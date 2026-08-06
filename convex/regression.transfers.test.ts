/// <reference types="vite/client" />
/**
 * Regression: internal transfers (convex/transfers.ts + lib/pointage.ts).
 *
 * Invariants (cf. KNOWN_ISSUES « Virements internes »):
 * - A transfer is an OBJECT with two legs: tagging one leg opens an
 *   INCOMPLETE transfer, which stays visible instead of silently leaving the
 *   analysis.
 * - Both legs must sit on accounts of the SAME legal entity
 *   (`bankAccounts.ownerCompanyId`), on two different accounts, in opposite
 *   directions — otherwise the pairing is refused.
 * - The amount gap between the legs (bank fees, partial transfer) is
 *   surfaced, never absorbed.
 * - Both legs stay `internal_transfer`, so `effectiveCategory` keeps
 *   returning null: the analysis and the forecast grid do not move.
 */
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import { effectiveCategory } from './lib/categories'
import {
  createBankAccount,
  createGroupEntity,
  createOrg,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'

const DAY = 86_400_000

/**
 * One entity with two accounts (two different banks), and the two legs of a
 * 50 000 € transfer: out on the first account, in on the second two days
 * later.
 */
async function transferSetup(opts: { inAmount?: number } = {}) {
  const t = setupHarness()
  const user = await createUser(t, 'transfers@test.dev')
  const org = await createOrg(t, 'org-transfers', [
    { userId: user.userId, role: 'owner' },
  ])
  const accountA = await createBankAccount(t, org)
  const accountB = await createBankAccount(t, org)
  const now = Date.now()
  const outLeg = await createTransaction(t, org.orgId, accountA, {
    direction: 'out',
    amount: 5_000_000,
    rawLabel: 'VIR INTERNE PALATINE',
    transactionDate: now - 2 * DAY,
  })
  const inLeg = await createTransaction(t, org.orgId, accountB, {
    direction: 'in',
    amount: opts.inAmount ?? 5_000_000,
    rawLabel: 'VIR RECU QONTO',
    transactionDate: now,
  })
  return { t, user, org, accountA, accountB, outLeg, inLeg }
}

describe('internal transfers: opening a transfer on one leg', () => {
  test('tagging one leg opens an INCOMPLETE transfer, visible as such', async () => {
    const { t, user, org, outLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })

    const tx = await t.run(async (ctx) => ctx.db.get('transactions', outLeg))
    expect(tx?.matchStatus).toBe('internal_transfer')
    expect(tx?.allocation?.kind).toBe('transfer')

    // The register surfaces it under the « à apparier » filter…
    const incomplete = await user.as.query(api.transactions.listLedger, {
      orgId: org.orgId,
      transferState: 'incomplete',
    })
    expect(incomplete.map((row) => row._id)).toContain(outLeg)
    expect(incomplete[0].transferIncomplete).toBe(true)

    // …and the detail query says the counter-leg is missing.
    const detail = await user.as.query(api.transfers.getForTransaction, {
      transactionId: outLeg,
    })
    expect(detail?.complete).toBe(false)
  })

  test('a transfer NEVER memorizes a learned rule', async () => {
    const { t, user, outLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })

    const rules = await t.run(async (ctx) =>
      ctx.db.query('categoryRules').collect(),
    )
    expect(rules).toHaveLength(0)
  })
})

describe('internal transfers: pairing', () => {
  test('pairing completes the transfer and keeps both legs out of the analysis', async () => {
    const { t, user, org, outLeg, inLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })

    const legs = await t.run(async (ctx) => [
      await ctx.db.get('transactions', outLeg),
      await ctx.db.get('transactions', inLeg),
    ])
    // Both legs share the same transfer row…
    expect(legs[0]?.allocation?.targetId).toBe(legs[1]?.allocation?.targetId)
    // …both stay « écarté », so the analysis and the forecast grid do not move.
    for (const leg of legs) {
      expect(leg?.matchStatus).toBe('internal_transfer')
      expect(effectiveCategory(leg!)).toBeNull()
    }

    const detail = await user.as.query(api.transfers.getForTransaction, {
      transactionId: outLeg,
    })
    expect(detail?.complete).toBe(true)
    expect(detail?.gapCents).toBe(0)
    expect(detail?.transitDays).toBe(2)

    // It has left the « à apparier » filter.
    const incomplete = await user.as.query(api.transactions.listLedger, {
      orgId: org.orgId,
      transferState: 'incomplete',
    })
    expect(incomplete).toHaveLength(0)
  })

  test('an amount gap is surfaced, not absorbed', async () => {
    const { user, outLeg, inLeg } = await transferSetup({ inAmount: 4_998_500 })

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })

    const detail = await user.as.query(api.transfers.getForTransaction, {
      transactionId: outLeg,
    })
    expect(detail?.complete).toBe(true)
    expect(detail?.gapCents).toBe(1_500) // 15 € of bank fees
  })

  test('two legs tagged separately merge into ONE transfer', async () => {
    const { t, user, outLeg, inLeg } = await transferSetup()

    // The shape a bulk categorization leaves behind: two half-transfers.
    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: inLeg,
    })
    expect(
      await t.run(async (ctx) => ctx.db.query('transfers').collect()),
    ).toHaveLength(2)

    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })

    // The absorbed half-transfer is gone — no orphan row left behind.
    expect(
      await t.run(async (ctx) => ctx.db.query('transfers').collect()),
    ).toHaveLength(1)
  })

  test('the candidate list only offers the other accounts of the SAME entity', async () => {
    const { t, user, org, outLeg, inLeg } = await transferSetup()

    // A movement of another entity, in the right direction, same amount.
    const otherEntity = await createGroupEntity(t, org.orgId, 'Caltimo')
    const otherAccount = await createBankAccount(t, org, {
      ownerCompanyId: otherEntity,
    })
    const decoy = await createTransaction(t, org.orgId, otherAccount, {
      direction: 'in',
      amount: 5_000_000,
      rawLabel: 'VIR RECU CALTIMO',
    })

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    const candidates = await user.as.query(api.transfers.listPairable, {
      transactionId: outLeg,
    })
    const ids = candidates.map((row) => row._id)
    expect(ids).toContain(inLeg)
    expect(ids).not.toContain(decoy)
  })
})

describe('internal transfers: refused pairings', () => {
  test('two accounts of DIFFERENT entities are refused', async () => {
    const { t, user, org, outLeg } = await transferSetup()

    const otherEntity = await createGroupEntity(t, org.orgId, 'Caltimo')
    const otherAccount = await createBankAccount(t, org, {
      ownerCompanyId: otherEntity,
    })
    const otherLeg = await createTransaction(t, org.orgId, otherAccount, {
      direction: 'in',
      amount: 5_000_000,
    })

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await expectConvexError(
      user.as.mutation(api.transfers.pairTransfer, {
        transactionId: outLeg,
        counterpartTransactionId: otherLeg,
      }),
      'transfer_wrong_entity',
    )
  })

  test('two legs going the same way are refused', async () => {
    const { t, user, org, accountB, outLeg } = await transferSetup()

    const alsoOut = await createTransaction(t, org.orgId, accountB, {
      direction: 'out',
      amount: 5_000_000,
    })

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await expectConvexError(
      user.as.mutation(api.transfers.pairTransfer, {
        transactionId: outLeg,
        counterpartTransactionId: alsoOut,
      }),
      'transfer_same_direction',
    )
  })

  test('two legs on the same account are refused', async () => {
    const { t, user, org, accountA, outLeg } = await transferSetup()

    const sameAccount = await createTransaction(t, org.orgId, accountA, {
      direction: 'in',
      amount: 5_000_000,
    })

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await expectConvexError(
      user.as.mutation(api.transfers.pairTransfer, {
        transactionId: outLeg,
        counterpartTransactionId: sameAccount,
      }),
      'transfer_same_account',
    )
  })

  test('a paired leg cannot be re-categorized without being unpaired first', async () => {
    const { user, outLeg, inLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })

    await expectConvexError(
      user.as.mutation(api.transactions.categorizeAsCharge, {
        transactionId: outLeg,
      }),
      'allocated_to_transfer',
    )
  })
})

describe('internal transfers: unpairing', () => {
  test('unpairing one leg frees it and leaves the other incomplete', async () => {
    const { t, user, outLeg, inLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })
    await user.as.mutation(api.transfers.unpairTransfer, {
      transactionId: inLeg,
    })

    const freed = await t.run(async (ctx) => ctx.db.get('transactions', inLeg))
    expect(freed?.matchStatus).toBe('unmatched')
    expect(freed?.allocation).toBeUndefined()

    const remaining = await user.as.query(api.transfers.getForTransaction, {
      transactionId: outLeg,
    })
    expect(remaining?.complete).toBe(false)
  })

  test('unpairing the last leg deletes the transfer row', async () => {
    const { t, user, outLeg } = await transferSetup()

    await user.as.mutation(api.transactions.categorizeAsInternalTransfer, {
      transactionId: outLeg,
    })
    await user.as.mutation(api.transfers.unpairTransfer, {
      transactionId: outLeg,
    })

    expect(
      await t.run(async (ctx) => ctx.db.query('transfers').collect()),
    ).toHaveLength(0)
  })
})

describe('internal transfers: legacy rows tagged before transfers were an object', () => {
  test('a tagged row with no allocation reads as incomplete and can be paired', async () => {
    const { t, user, org, outLeg, inLeg } = await transferSetup()

    // Pre-feature shape: the status alone, no allocation.
    await t.run(async (ctx) =>
      ctx.db.patch('transactions', outLeg, {
        matchStatus: 'internal_transfer',
      }),
    )

    const incomplete = await user.as.query(api.transactions.listLedger, {
      orgId: org.orgId,
      transferState: 'incomplete',
    })
    expect(incomplete.map((row) => row._id)).toContain(outLeg)

    // Pairing adopts it — no backfill needed.
    await user.as.mutation(api.transfers.pairTransfer, {
      transactionId: outLeg,
      counterpartTransactionId: inLeg,
    })
    const detail = await user.as.query(api.transfers.getForTransaction, {
      transactionId: outLeg,
    })
    expect(detail?.complete).toBe(true)
  })
})
