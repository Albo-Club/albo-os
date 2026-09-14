/**
 * One-shot cleanup of the transactions a bank account received TWICE, because
 * the same bank was connected twice on the Powens side.
 *
 * Why: two live Powens connections delivering the same real account each hand
 * out their own `powensTxId` for the very same movement. Ingestion dedups by
 * `powensTxId` alone (`convex/powens.ts:writeAccountTransactions`), so nothing
 * downstream could tell the two series apart — every movement landed twice.
 * Seen on the Natixis Wealth Management account of CALTE (09/2026). The leak
 * itself is now closed at the source (`resolveAccount`,
 * `duplicate_live_connection`); this module cleans up what got in before.
 *
 * SCOPED TO ONE ACCOUNT, on purpose. Perfect duplicates also occur for real —
 * two identical transfers, same day, same amount, same label — so a global
 * pass would destroy legitimate movements. The operator names the account,
 * reads the plan, then applies it.
 *
 * Only `source: 'powens'` rows carrying a `powensTxId` are ever considered: a
 * manual entry or a CSV import is never deleted by this.
 *
 * Which copy survives, in order:
 *  1. the one another row POINTS AT (`matchingDecisions.transactionId`,
 *     `forecastEntries` / legacy `forecasts`.`realizedTransactionId`) —
 *     deleting it would dangle that reference. Several pointed at → the group
 *     is left alone for a human to sort out;
 *  2. failing that, the one carrying a DECISION (matching status, allocation,
 *     deal, reconciliation, notes). Two rows carrying DIFFERENT decisions →
 *     left alone likewise: that shape is what a genuine double movement,
 *     pointed twice, looks like;
 *  3. failing that, the oldest row.
 *
 * Idempotent: once applied, every group is down to one row and each entry
 * point is a no-op.
 *
 * Execution (prod, manual). The snapshot below covers what this destroys —
 * database rows, no file storage:
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   # STOP: check the file exists and is not empty, THEN:
 *   pnpm exec convex run --prod migrations/dedupPowensTransactions:dryRun '{"bankAccountId":"<id>"}'
 *   # STOP: read the groups, count the deletions, then pass that count back —
 *   # `apply` refuses if the plan has moved since.
 *   pnpm exec convex run --prod migrations/dedupPowensTransactions:apply '{"bankAccountId":"<id>","expectedDeletions":<n>}'
 *   pnpm exec convex run --prod migrations/dedupPowensTransactions:verify '{"bankAccountId":"<id>"}'
 *
 * The account id is read from the Cash page URL, or from
 * `powens:diagnoseOrgAccountLinks '{"orgSlug":"calte"}'`.
 */
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { squashName } from '../lib/powensAccounts'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Same real movement = same account, date, direction, amount, label and
 * counterparty. Deliberately strict: everything the bank tells us about a
 * movement has to match before we call two rows the same one. */
function movementKey(tx: Doc<'transactions'>): string {
  return [
    tx.transactionDate,
    tx.direction,
    tx.amount,
    squashName(tx.rawLabel),
    squashName(tx.counterparty ?? ''),
  ].join('|')
}

/** The human state carried BY a row. Two copies whose fingerprints are equal
 * are interchangeable — keeping either loses nothing. */
function decisionFingerprint(tx: Doc<'transactions'>): string {
  return JSON.stringify({
    matchStatus: tx.matchStatus ?? null,
    dealId: tx.dealId ?? null,
    allocation: tx.allocation ?? null,
    category: tx.category ?? null,
    vatRateBps: tx.vatRateBps ?? null,
    reconciled: tx.reconciled,
    notes: tx.notes ?? null,
  })
}

/** Has this row been decided on at all? `unmatched` with nothing else is the
 * untouched state an ingestion leaves behind. */
function isDecided(tx: Doc<'transactions'>): boolean {
  return (
    (tx.matchStatus != null && tx.matchStatus !== 'unmatched') ||
    tx.allocation != null ||
    tx.dealId != null ||
    tx.reconciled ||
    tx.notes != null
  )
}

type GroupPlan = {
  key: string
  rows: Array<Doc<'transactions'>>
  /** Null when the group must be left alone. */
  keep: Doc<'transactions'> | null
  delete: Array<Doc<'transactions'>>
  reason: 'referenced' | 'decided' | 'identical' | 'oldest' | 'needs_review'
}

/** Rows of OTHER tables pointing at a given transaction. Deleting a pointed-at
 * row would leave the pointer dangling — `matchingDecisions` is append-only
 * and never rewritten, so the survivor has to be the pointed one. */
async function isReferenced(
  ctx: Ctx,
  tx: Doc<'transactions'>,
  realized: ReadonlySet<string>,
): Promise<boolean> {
  if (realized.has(tx._id)) return true
  const decision = await ctx.db
    .query('matchingDecisions')
    .withIndex('by_transaction', (q) => q.eq('transactionId', tx._id))
    .first()
  return decision != null
}

async function buildPlan(
  ctx: Ctx,
  bankAccountId: Id<'bankAccounts'>,
): Promise<{ account: Doc<'bankAccounts'>; groups: Array<GroupPlan> }> {
  const account = await ctx.db.get('bankAccounts', bankAccountId)
  if (!account) throw new ConvexError('account_not_found')

  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_account_date', (q) => q.eq('bankAccountId', bankAccountId))
    .collect()

  // Forecast rows that claim a transaction as their realization — both the
  // live table and the legacy one, which still holds imported data.
  const realized = new Set<string>()
  for (const entry of await ctx.db
    .query('forecastEntries')
    .withIndex('by_org', (q) => q.eq('orgId', account.orgId))
    .collect()) {
    if (entry.realizedTransactionId) realized.add(entry.realizedTransactionId)
  }
  for (const forecast of await ctx.db
    .query('forecasts')
    .withIndex('by_account_date', (q) => q.eq('bankAccountId', bankAccountId))
    .collect()) {
    if (forecast.realizedTransactionId) {
      realized.add(forecast.realizedTransactionId)
    }
  }

  const byKey = new Map<string, Array<Doc<'transactions'>>>()
  for (const tx of txs) {
    // Powens-delivered rows only: a manual entry or an import that happens to
    // look like a duplicate is none of this module's business.
    if (tx.source !== 'powens' || !tx.powensTxId) continue
    const key = movementKey(tx)
    byKey.set(key, [...(byKey.get(key) ?? []), tx])
  }

  const groups: Array<GroupPlan> = []
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue
    const oldest = [...rows].sort((a, b) => a._creationTime - b._creationTime)

    const referenced: Array<Doc<'transactions'>> = []
    for (const tx of rows) {
      if (await isReferenced(ctx, tx, realized)) referenced.push(tx)
    }
    if (referenced.length > 1) {
      groups.push({ key, rows, keep: null, delete: [], reason: 'needs_review' })
      continue
    }
    if (referenced.length === 1) {
      const keep = referenced[0]
      groups.push({
        key,
        rows,
        keep,
        delete: rows.filter((tx) => tx._id !== keep._id),
        reason: 'referenced',
      })
      continue
    }

    const decided = rows.filter(isDecided)
    if (decided.length > 1) {
      const fingerprints = new Set(decided.map(decisionFingerprint))
      // Same decision on every copy → they are interchangeable.
      if (fingerprints.size > 1) {
        groups.push({
          key,
          rows,
          keep: null,
          delete: [],
          reason: 'needs_review',
        })
        continue
      }
      const keep = [...decided].sort(
        (a, b) => a._creationTime - b._creationTime,
      )[0]
      groups.push({
        key,
        rows,
        keep,
        delete: rows.filter((tx) => tx._id !== keep._id),
        reason: 'identical',
      })
      continue
    }
    const keep = decided.length === 1 ? decided[0] : oldest[0]
    groups.push({
      key,
      rows,
      keep,
      delete: rows.filter((tx) => tx._id !== keep._id),
      reason: decided.length === 1 ? 'decided' : 'oldest',
    })
  }
  return { account, groups }
}

function describeTx(tx: Doc<'transactions'>) {
  return {
    _id: tx._id,
    powensTxId: tx.powensTxId ?? null,
    dateISO: new Date(tx.transactionDate).toISOString().slice(0, 10),
    direction: tx.direction,
    amountCents: tx.amount,
    rawLabel: tx.rawLabel,
    matchStatus: tx.matchStatus ?? null,
    reconciled: tx.reconciled,
  }
}

/** Read-only: every duplicate group, what would be kept, what would go. */
export const dryRun = internalQuery({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const { account, groups } = await buildPlan(ctx, bankAccountId)
    const deletions = groups.reduce((n, g) => n + g.delete.length, 0)
    return {
      account: {
        _id: account._id,
        bankName: account.bankName,
        label: account.label,
      },
      // Pass this back to `apply`, which refuses if the plan has moved.
      expectedDeletions: deletions,
      groups: groups.map((g) => ({
        reason: g.reason,
        keep: g.keep ? describeTx(g.keep) : null,
        delete: g.delete.map(describeTx),
        // Left alone: a human decides. Shown in full so they can.
        review: g.reason === 'needs_review' ? g.rows.map(describeTx) : [],
      })),
      needsReview: groups.filter((g) => g.reason === 'needs_review').length,
    }
  },
})

/** Deletes the surplus copies. `expectedDeletions` must match the count the
 * dry run reported — the operator has to have read the plan. */
export const apply = internalMutation({
  args: {
    bankAccountId: v.id('bankAccounts'),
    expectedDeletions: v.number(),
  },
  handler: async (ctx, { bankAccountId, expectedDeletions }) => {
    const { groups } = await buildPlan(ctx, bankAccountId)
    const toDelete = groups.flatMap((g) => g.delete)
    if (toDelete.length !== expectedDeletions) {
      throw new ConvexError(
        `plan_changed:expected=${expectedDeletions}:actual=${toDelete.length}`,
      )
    }
    for (const tx of toDelete) {
      await ctx.db.delete('transactions', tx._id)
    }
    return {
      applied: true as const,
      deleted: toDelete.length,
      deletedRows: toDelete.map(describeTx),
      leftForReview: groups.filter((g) => g.reason === 'needs_review').length,
    }
  },
})

/** Read-only: what is left. `remainingDuplicates` must be 0 (bar the groups
 * left for review), and no reference may dangle. */
export const verify = internalQuery({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const { account, groups } = await buildPlan(ctx, bankAccountId)
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', bankAccountId))
      .collect()

    // A reference pointing at a row that no longer exists would be the one
    // unforgivable outcome here.
    const ids = new Set(txs.map((tx) => tx._id))
    const decisions = await ctx.db
      .query('matchingDecisions')
      .withIndex('by_org', (q) => q.eq('orgId', account.orgId))
      .collect()
    const dangling = decisions.filter(
      (d) => d.txBankAccountId === bankAccountId && !ids.has(d.transactionId),
    ).length

    const sum = (direction: 'in' | 'out') =>
      txs
        .filter((tx) => tx.direction === direction)
        .reduce((total, tx) => total + tx.amount, 0)

    return {
      account: { _id: account._id, label: account.label },
      transactions: txs.length,
      totalInCents: sum('in'),
      totalOutCents: sum('out'),
      remainingDuplicates: groups.reduce((n, g) => n + g.delete.length, 0),
      leftForReview: groups.filter((g) => g.reason === 'needs_review').length,
      danglingDecisions: dangling,
    }
  },
})
