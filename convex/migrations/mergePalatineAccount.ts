/**
 * One-shot merge of the two Palatine current-account rows of the calte org.
 *
 * Why: the Airtable import created a `PALATINE` row (88 transactions, 2020 →
 * 20/02/2026, no IBAN) and the Powens connection later created a SECOND row
 * for the same real account (`COMPTE COURANT GG21 CALTE`, acct 35). Neither
 * side could recognize the other — the imported record has no IBAN and a
 * label that does not match the bank's, and Palatine delivers five accounts,
 * so the "lone account" rule cannot apply either (cf.
 * `convex/lib/powensAccounts.ts`). Hence this manual merge, once.
 *
 * Direction: the IMPORTED row survives (it holds the history and the pointage
 * decisions) and takes over the Powens link. Its `airtableId` keeps the
 * ingestion cutover at the last imported transaction (`computeCutoff`,
 * 20/02/2026), which is also the floor of the catch-up: once merged, the
 * 21/02 → 08/06 gap can be repaired with
 * `powens:backfillConnection '{"orgId":"…","powensConnectionId":"30","minDate":"2026-02-21"}'`.
 * The Powens row is emptied then deleted.
 *
 * Target chosen by Benjamin: the ACTIVE current account (`…1522708000146`,
 * 19 movements) — Palatine exposes a second, barely-used one
 * (`…2137518521552`) which is left untouched.
 *
 * Anchored on the prod `_id`s read from
 * `powens:diagnoseOrgAccountLinks '{"orgSlug":"calte"}'` (29/07/2026), with
 * guards on org, bank and link state: a row that does not match its expected
 * shape stops the migration instead of being rewritten.
 *
 * Idempotent: once the Powens row is gone and the link sits on the imported
 * row, every entry point is a no-op.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/mergePalatineAccount:dryRun
 *   # STOP: check the counts, then:
 *   pnpm exec convex run --prod migrations/mergePalatineAccount:apply
 *   pnpm exec convex run --prod migrations/mergePalatineAccount:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { normalizeName } from '../lib/powensAccounts'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Prod anchors (org calte). */
const KEEP_ID = 'js73nkp9260rfhvnczpes6tfns87sbd0' as Id<'bankAccounts'>
const MERGE_ID = 'js77yb161vyrp7kgcw2p09yyns87w9qq' as Id<'bankAccounts'>
/** Bank label the merged row ends up with — the one its siblings already use,
 * so the Cash page groups the six Palatine accounts together. */
const BANK_NAME = 'Palatine'

type Plan = {
  keep: Doc<'bankAccounts'>
  merge: Doc<'bankAccounts'>
  txCount: number
  decisionCount: number
  legacyForecastCount: number
}

/** Loads both rows, checks they are the expected ones, and counts what would
 * move. Returns `null` when the merge has already been applied. */
async function resolve(ctx: Ctx): Promise<Plan | null> {
  const keep = await ctx.db.get('bankAccounts', KEEP_ID)
  if (!keep) throw new ConvexError('keep_account_not_found')
  const merge = await ctx.db.get('bankAccounts', MERGE_ID)
  if (!merge) {
    // Already merged: the link must sit on the surviving row, otherwise
    // something else deleted it and a human has to look.
    if (!keep.powensAccountId) throw new ConvexError('merge_account_vanished')
    return null
  }

  const org = await ctx.db.get('organizations', keep.orgId)
  if (org?.slug !== 'calte') throw new ConvexError('keep_not_calte')
  if (merge.orgId !== keep.orgId) throw new ConvexError('org_mismatch')
  if (merge.ownerCompanyId !== keep.ownerCompanyId) {
    throw new ConvexError('owner_mismatch')
  }
  if (normalizeName(keep.bankName) !== normalizeName(BANK_NAME)) {
    throw new ConvexError(`keep_not_palatine:${keep.bankName}`)
  }
  if (normalizeName(merge.bankName) !== normalizeName(BANK_NAME)) {
    throw new ConvexError(`merge_not_palatine:${merge.bankName}`)
  }
  // Shape guards: the survivor is the imported row (history, no Powens link),
  // the merged one is the Powens row.
  if (!keep.airtableId) throw new ConvexError('keep_not_imported')
  if (keep.powensAccountId) throw new ConvexError('keep_already_linked')
  if (!merge.powensAccountId) throw new ConvexError('merge_not_powens')
  if (merge.airtableId) throw new ConvexError('merge_is_imported')

  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_account_date', (q) => q.eq('bankAccountId', MERGE_ID))
    .collect()
  const decisions = (
    await ctx.db
      .query('matchingDecisions')
      .withIndex('by_org', (q) => q.eq('orgId', keep.orgId))
      .collect()
  ).filter((d) => d.txBankAccountId === MERGE_ID)
  const legacyForecasts = await ctx.db
    .query('forecasts')
    .withIndex('by_account_date', (q) => q.eq('bankAccountId', MERGE_ID))
    .collect()

  return {
    keep,
    merge,
    txCount: txs.length,
    decisionCount: decisions.length,
    legacyForecastCount: legacyForecasts.length,
  }
}

function describe(account: Doc<'bankAccounts'>) {
  return {
    _id: account._id,
    bankName: account.bankName,
    label: account.label,
    iban: account.iban ?? null,
    airtableId: account.airtableId ?? null,
    powensAccountId: account.powensAccountId ?? null,
    powensConnectionId: account.powensConnectionId ?? null,
    currentBalance: account.currentBalance ?? null,
  }
}

/** Read-only: what `apply` would move. */
export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const plan = await resolve(ctx)
    if (!plan) return { alreadyMerged: true as const }
    return {
      alreadyMerged: false as const,
      keep: describe(plan.keep),
      merge: describe(plan.merge),
      willMove: {
        transactions: plan.txCount,
        matchingDecisions: plan.decisionCount,
        legacyForecasts: plan.legacyForecastCount,
      },
      keepAfter: {
        bankName: BANK_NAME,
        iban: plan.merge.iban ?? null,
        powensAccountId: plan.merge.powensAccountId ?? null,
        powensConnectionId: plan.merge.powensConnectionId ?? null,
      },
    }
  },
})

/** Moves the movements onto the imported row, transfers the Powens link, then
 * deletes the emptied row. */
export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const plan = await resolve(ctx)
    if (!plan) return { applied: false as const, reason: 'already_merged' }
    const { keep, merge } = plan

    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', MERGE_ID))
      .collect()
    for (const tx of txs) {
      await ctx.db.patch('transactions', tx._id, { bankAccountId: KEEP_ID })
    }
    // Append-only decision log: its snapshot must keep pointing at a row that
    // exists.
    const decisions = (
      await ctx.db
        .query('matchingDecisions')
        .withIndex('by_org', (q) => q.eq('orgId', keep.orgId))
        .collect()
    ).filter((d) => d.txBankAccountId === MERGE_ID)
    for (const decision of decisions) {
      await ctx.db.patch('matchingDecisions', decision._id, {
        txBankAccountId: KEEP_ID,
      })
    }
    const legacyForecasts = await ctx.db
      .query('forecasts')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', MERGE_ID))
      .collect()
    for (const forecast of legacyForecasts) {
      await ctx.db.patch('forecasts', forecast._id, { bankAccountId: KEEP_ID })
    }

    // `label` is never overwritten after creation (schema rule): the surviving
    // row keeps "PALATINE". Only the bank label is aligned, so the Cash page
    // stops showing two Palatine groups.
    await ctx.db.patch('bankAccounts', KEEP_ID, {
      bankName: BANK_NAME,
      iban: merge.iban,
      accountKind: merge.accountKind ?? keep.accountKind,
      currentBalance: merge.currentBalance,
      balanceAsOf: merge.balanceAsOf,
      powensAccountId: merge.powensAccountId,
      powensConnectionId: merge.powensConnectionId,
    })
    await ctx.db.delete('bankAccounts', MERGE_ID)

    return {
      applied: true as const,
      movedTransactions: txs.length,
      repointedDecisions: decisions.length,
      repointedLegacyForecasts: legacyForecasts.length,
      deletedAccount: describe(merge),
    }
  },
})

/** Read-only: state of the surviving row + leftovers that should be zero. */
export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keep = await ctx.db.get('bankAccounts', KEEP_ID)
    if (!keep) throw new ConvexError('keep_account_not_found')
    const merge = await ctx.db.get('bankAccounts', MERGE_ID)
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', KEEP_ID))
      .collect()
    const dates = txs.map((t) => t.transactionDate).sort((a, b) => a - b)
    const orphanTxs = await ctx.db
      .query('transactions')
      .withIndex('by_account_date', (q) => q.eq('bankAccountId', MERGE_ID))
      .collect()
    const orphanDecisions = (
      await ctx.db
        .query('matchingDecisions')
        .withIndex('by_org', (q) => q.eq('orgId', keep.orgId))
        .collect()
    ).filter((d) => d.txBankAccountId === MERGE_ID)
    const iso = (ms: number | undefined) =>
      ms == null ? null : new Date(ms).toISOString().slice(0, 10)
    return {
      keep: describe(keep),
      mergedRowDeleted: merge === null,
      txCount: txs.length,
      firstTx: iso(dates[0]),
      lastTx: iso(dates[dates.length - 1]),
      orphanTransactions: orphanTxs.length,
      orphanDecisions: orphanDecisions.length,
    }
  },
})
