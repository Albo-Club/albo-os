import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { effectiveCategory, isValidCategory } from './lib/categories'
import {
  loadOrgRules,
  ruleFieldsFor,
  upsertRuleFromGesture,
} from './lib/categoryRules'
import {
  applyCategorization,
  applyMatchToDeal,
  applyUnmatch,
} from './lib/pointage'
import { buildSearchText, normalizeSearch } from './lib/searchText'
import { vatCentsFromTtc, vatRateBpsValidator } from './lib/vat'

import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

/**
 * Bound on full-text search results (the no-search listing keeps its
 * historical `.collect()` — the matching queue must stay exhaustive).
 */
const SEARCH_LIMIT = 200

/**
 * Bound on the complete ledger (`listLedger`). Newest-first, so the cap drops
 * the oldest tail of a >LEDGER_LIMIT-tx org — the exhaustive per-account
 * browse stays on /cash/$accountId. See KNOWN_ISSUES.md « Registre Transactions ».
 */
const LEDGER_LIMIT = 1000

/** An org's bank accounts keyed by id, to enrich rows without N+1 gets. */
async function orgAccountsById(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
): Promise<Map<Id<'bankAccounts'>, Doc<'bankAccounts'>>> {
  const accounts = await ctx.db
    .query('bankAccounts')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  return new Map(accounts.map((a) => [a._id, a]))
}

/**
 * Transactions attached to a deal (reconciled via `dealId`), sorted by
 * descending date and enriched with the bank account. Scoped to the deal's org.
 */
export const listByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get("deals", dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgMember(ctx, deal.orgId)

    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get("bankAccounts", tx.bankAccountId)
        return {
          _id: tx._id,
          direction: tx.direction,
          amount: tx.amount,
          transactionDate: tx.transactionDate,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          reconciled: tx.reconciled,
          account: account
            ? { label: account.label, bankName: account.bankName }
            : null,
        }
      }),
    )
  },
})

/**
 * Matching queue: an org's `unmatched` transactions, sorted by descending
 * date and enriched with the bank account. Transactions without
 * `matchStatus` (pre-backfill) do not appear — run
 * `transactions:backfillMatchStatus` first.
 *
 * `search` (optional) filters by label/counterparty via the `search_text`
 * search index (case/accent-insensitive), scoped to org + status.
 */
export const listUnmatched = query({
  args: {
    orgId: v.id('organizations'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, search }) => {
    await requireOrgMember(ctx, orgId)

    const term = search ? normalizeSearch(search) : ''
    const rows = term
      ? await ctx.db
          .query('transactions')
          .withSearchIndex('search_text', (q) =>
            q
              .search('searchText', term)
              .eq('orgId', orgId)
              .eq('matchStatus', 'unmatched'),
          )
          .take(SEARCH_LIMIT)
      : await ctx.db
          .query('transactions')
          .withIndex('by_org_matchStatus', (q) =>
            q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
          )
          .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    // One indexed read of the org's few accounts instead of one `db.get`
    // per row (the queue can hold thousands of rows after a bank import).
    const accountsById = await orgAccountsById(ctx, orgId)

    return rows.map((tx) => {
      const account = accountsById.get(tx.bankAccountId)
      return {
        _id: tx._id,
        direction: tx.direction,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        rawLabel: tx.rawLabel,
        counterparty: tx.counterparty ?? null,
        // Generalized allocation (safety filter on the Passif page — a tx
        // allocated to liabilities is `matched` and should never be here).
        allocation: tx.allocation ?? null,
        account: account
          ? { label: account.label, bankName: account.bankName }
          : null,
      }
    })
  },
})

/**
 * An org's transactions in a given matching status (to browse the set-aside
 * ones: ignored / charges / taxes / products / internal transfers, or the
 * matched ones), sorted by descending date and enriched with the bank
 * account. Same shape as `listUnmatched` (minus `allocation`).
 *
 * `search` (optional) filters by label/counterparty via the `search_text`
 * search index (case/accent-insensitive), scoped to org + status.
 */
export const listByStatus = query({
  args: {
    orgId: v.id('organizations'),
    status: v.union(
      v.literal('matched'),
      v.literal('ignored'),
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, status, search }) => {
    await requireOrgMember(ctx, orgId)

    const term = search ? normalizeSearch(search) : ''
    const rows = term
      ? await ctx.db
          .query('transactions')
          .withSearchIndex('search_text', (q) =>
            q
              .search('searchText', term)
              .eq('orgId', orgId)
              .eq('matchStatus', status),
          )
          .take(SEARCH_LIMIT)
      : await ctx.db
          .query('transactions')
          .withIndex('by_org_matchStatus', (q) =>
            q.eq('orgId', orgId).eq('matchStatus', status),
          )
          .collect()

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    // Same batching as `listUnmatched`: the matched/charge sets grow with
    // the bank history, one account read per row does not scale.
    const accountsById = await orgAccountsById(ctx, orgId)

    return rows.map((tx) => {
      const account = accountsById.get(tx.bankAccountId)
      return {
        _id: tx._id,
        direction: tx.direction,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        rawLabel: tx.rawLabel,
        counterparty: tx.counterparty ?? null,
        // VAT (charge/product statuses only) — null = to be qualified.
        vatRateBps: tx.vatRateBps ?? null,
        // Broad treasury category (charge/product only) — null = to qualify.
        category: tx.category ?? null,
        account: account
          ? { label: account.label, bankName: account.bankName }
          : null,
      }
    })
  },
})

/**
 * Complete transactions ledger (Pennylane-style): an org's transactions across
 * ALL accounts and statuses, optionally narrowed by `status`, `bankAccountId`
 * and `search`, sorted by descending date and enriched with the bank account.
 * Drives the Transactions tab of the Cash section — a matched row stays visible
 * (with its `matchStatus`), unlike `listUnmatched`. Rows without `matchStatus`
 * (pre-backfill) surface as 'unmatched'.
 *
 * Bounded to the LEDGER_LIMIT most recent rows per filter.
 */
export const listLedger = query({
  args: {
    orgId: v.id('organizations'),
    status: v.optional(
      v.union(
        v.literal('unmatched'),
        v.literal('matched'),
        v.literal('ignored'),
        v.literal('charge'),
        v.literal('tax'),
        v.literal('product'),
        v.literal('internal_transfer'),
      ),
    ),
    bankAccountId: v.optional(v.id('bankAccounts')),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, status, bankAccountId, search }) => {
    await requireOrgMember(ctx, orgId)

    // The org's accounts, read once — also gates the by-account branch below
    // (that index is not org-scoped, so we must verify ownership ourselves).
    const accountsById = await orgAccountsById(ctx, orgId)
    if (bankAccountId && !accountsById.has(bankAccountId)) return []

    const term = search ? normalizeSearch(search) : ''
    let rows: Array<Doc<'transactions'>>
    // The `search_text` filter fields are declared [orgId, matchStatus,
    // bankAccountId] and must be applied in order without a gap — so
    // `bankAccountId` only enters the index when `status` is set too;
    // otherwise (and for the no-search status branch) we narrow the account in
    // JS after the bounded read.
    let filterAccountInJs = false

    if (term) {
      rows = await ctx.db
        .query('transactions')
        .withSearchIndex('search_text', (q) => {
          let s = q.search('searchText', term).eq('orgId', orgId)
          if (status) s = s.eq('matchStatus', status)
          if (status && bankAccountId) s = s.eq('bankAccountId', bankAccountId)
          return s
        })
        .take(LEDGER_LIMIT)
      if (bankAccountId && !status) filterAccountInJs = true
    } else if (status) {
      rows = await ctx.db
        .query('transactions')
        .withIndex('by_org_matchStatus', (q) =>
          q.eq('orgId', orgId).eq('matchStatus', status),
        )
        .take(LEDGER_LIMIT)
      if (bankAccountId) filterAccountInJs = true
    } else if (bankAccountId) {
      // "Tout" scoped to one account — naturally newest-first.
      rows = await ctx.db
        .query('transactions')
        .withIndex('by_account_date', (q) => q.eq('bankAccountId', bankAccountId))
        .order('desc')
        .take(LEDGER_LIMIT)
    } else {
      // "Tout", all accounts — newest-first.
      rows = await ctx.db
        .query('transactions')
        .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
        .order('desc')
        .take(LEDGER_LIMIT)
    }

    if (filterAccountInJs) {
      rows = rows.filter((tx) => tx.bankAccountId === bankAccountId)
    }

    rows.sort((a, b) => b.transactionDate - a.transactionDate)

    return rows.map((tx) => {
      const account = accountsById.get(tx.bankAccountId)
      return {
        _id: tx._id,
        direction: tx.direction,
        amount: tx.amount,
        transactionDate: tx.transactionDate,
        rawLabel: tx.rawLabel,
        counterparty: tx.counterparty ?? null,
        // Drives the status badge + per-row action; absence = 'unmatched'.
        matchStatus: tx.matchStatus ?? 'unmatched',
        // Routes the un-match (deal vs liability) + Passif safety filter.
        allocation: tx.allocation ?? null,
        // VAT (charge/product only) — null = to qualify.
        vatRateBps: tx.vatRateBps ?? null,
        // Broad treasury category (charge/product only) — null = to qualify.
        category: tx.category ?? null,
        account: account
          ? { label: account.label, bankName: account.bankName }
          : null,
      }
    })
  },
})

/**
 * Count of an org's transactions in a given matching status — feeds the
 * "À pointer" badge of the Transactions tab (returns a number, not the rows).
 */
export const countByStatus = query({
  args: {
    orgId: v.id('organizations'),
    status: v.union(
      v.literal('unmatched'),
      v.literal('matched'),
      v.literal('ignored'),
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_matchStatus', (q) =>
        q.eq('orgId', orgId).eq('matchStatus', status),
      )
      .collect()
    return rows.length
  },
})

// ─── Manual transaction → deal matching ─────────────────────────────────────
//
// Invariant: `matchStatus === 'matched'` ⟺ attached to a deal
// (`dealId != null` + `allocation.kind === 'deal'`) OR allocated to
// liabilities (`dealId == null` + `allocation.kind === 'equity' |
// 'intercompany_loan'`, cf. convex/liabilities.ts:allocateTransaction).
// `reconciled` (+ by/at) is a mirror derived from the DEAL matching only,
// kept for existing readers (deal UI, Cash view, agent).
// `allocation` (generalized matching) coexists with `dealId`:
// `dealId != null` ⟺ `allocation = { kind: 'deal', targetId: dealId }`
// (backfill of pre-existing rows: transactions:backfillAllocation).
// Each deal mutation writes an append-only row to `matchingDecisions`
// (dataset for the agent's suggestions); liability matching never writes
// there.
//
// The core (patches + invariants + logging) lives in convex/lib/pointage.ts,
// shared with the agent tools (convex/agentToolsPointage.ts) — never rewrite
// those patches here.

/**
 * Attaches a transaction to a deal in the same org.
 */
export const matchTransaction = mutation({
  args: { transactionId: v.id('transactions'), dealId: v.id('deals') },
  handler: async (ctx, { transactionId, dealId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyMatchToDeal(ctx, tx, dealId, user._id, 'manual')
    return null
  },
})

/**
 * Marks a transaction as unrelated to any deal (rent, payroll, bank fees,
 * internal movement…).
 */
export const ignoreTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'ignored', user._id, 'manual')
    return null
  },
})

/**
 * Categorizes a transaction as a running charge (rent, fees, expenses…).
 * Subtype of "set aside": same behavior as `ignoreTransaction`, only the
 * status differs so these transactions can be browsed later.
 * `vatRateBps` (optional) sets the deductible VAT rate — the UI sends 20 %
 * by default, adjustable later via `setVatRate`. `category` (optional)
 * sets the broad treasury category (lib/categories.ts).
 *
 * The gesture is memorized as a learned rule (categoryRules) replayed on
 * future ingested transactions with the same label pattern — returns
 * `ruleCreated` so the UI can surface it once.
 */
export const categorizeAsCharge = mutation({
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.optional(vatRateBpsValidator),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { transactionId, vatRateBps, category }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)
    if (category !== undefined && !isValidCategory('charge', category)) {
      throw new ConvexError('invalid_category')
    }

    await applyCategorization(
      ctx,
      tx,
      'charge',
      user._id,
      'manual',
      vatRateBps,
      category,
    )
    const rule = await upsertRuleFromGesture(ctx, {
      orgId: tx.orgId,
      tx,
      status: 'charge',
      category: category ?? tx.category,
      vatRateBps: vatRateBps ?? tx.vatRateBps,
      createdBy: user._id,
    })
    return { ruleCreated: rule?.created ?? false }
  },
})

/**
 * Categorizes a transaction as a tax. Subtype of "set aside": same behavior
 * as `ignoreTransaction`, only the status differs so these transactions can
 * be browsed later.
 */
export const categorizeAsTax = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'tax', user._id, 'manual')
    const rule = await upsertRuleFromGesture(ctx, {
      orgId: tx.orgId,
      tx,
      status: 'tax',
      createdBy: user._id,
    })
    return { ruleCreated: rule?.created ?? false }
  },
})

/**
 * Categorizes a transaction as a product: incoming money not attachable to a
 * deal (bank interest, miscellaneous refunds…). Subtype of "set aside": same
 * behavior as `ignoreTransaction`, only the status differs so these
 * transactions can be browsed later.
 */
export const categorizeAsProduct = mutation({
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.optional(vatRateBpsValidator),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { transactionId, vatRateBps, category }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)
    if (category !== undefined && !isValidCategory('product', category)) {
      throw new ConvexError('invalid_category')
    }

    await applyCategorization(
      ctx,
      tx,
      'product',
      user._id,
      'manual',
      vatRateBps,
      category,
    )
    const rule = await upsertRuleFromGesture(ctx, {
      orgId: tx.orgId,
      tx,
      status: 'product',
      category: category ?? tx.category,
      vatRateBps: vatRateBps ?? tx.vatRateBps,
      createdBy: user._id,
    })
    return { ruleCreated: rule?.created ?? false }
  },
})

/**
 * Categorizes a transaction as an internal transfer (movement between two of
 * the user's accounts). V1: a simple label, no pairing of the two legs
 * (out ↔ in). Subtype of "set aside": same behavior as `ignoreTransaction`,
 * only the status differs so these transactions can be browsed later.
 */
export const categorizeAsInternalTransfer = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyCategorization(ctx, tx, 'internal_transfer', user._id, 'manual')
    const rule = await upsertRuleFromGesture(ctx, {
      orgId: tx.orgId,
      tx,
      status: 'internal_transfer',
      createdBy: user._id,
    })
    return { ruleCreated: rule?.created ?? false }
  },
})

/**
 * Bulk categorization as charge, tax, product or internal transfer. Each
 * transaction is processed independently (same path as the unitary one: auth
 * via the tx's org, patch, `matchingDecisions` row); a failure on one does
 * not block the others. Returns the categorized ids and the failures
 * ("apply whatever goes through").
 */
export const bulkCategorize = mutation({
  args: {
    transactionIds: v.array(v.id('transactions')),
    status: v.union(
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
    vatRateBps: v.optional(vatRateBpsValidator),
  },
  handler: async (ctx, { transactionIds, status, vatRateBps }) => {
    const succeeded: Array<Id<'transactions'>> = []
    const failed: Array<{ id: Id<'transactions'>; reason: string }> = []

    for (const transactionId of transactionIds) {
      try {
        const tx = await ctx.db.get('transactions', transactionId)
        if (!tx) throw new ConvexError('not_found')
        const { user } = await requireOrgMember(ctx, tx.orgId)

        await applyCategorization(ctx, tx, status, user._id, 'manual', vatRateBps)
        succeeded.push(transactionId)
      } catch (err) {
        failed.push({
          id: transactionId,
          reason: err instanceof ConvexError ? String(err.data) : 'unknown',
        })
      }
    }

    return { succeeded, failed }
  },
})

/**
 * Unmatches a transaction (back to the `unmatched` state). The rollback is
 * logged too — a negative signal useful to the agent.
 */
export const unmatchTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)

    await applyUnmatch(ctx, tx, user._id, 'manual')
    return null
  },
})

// ─── Categories (broad treasury buckets on charges/products) ────────────────

/**
 * Sets or clears (`null` = back to « à qualifier ») the broad treasury
 * category of a transaction already categorized as charge or product.
 * Setting a category also memorizes the gesture as a learned rule
 * (categoryRules — with the transaction's current VAT rate), so future
 * ingested transactions with the same label pattern are classified
 * automatically. Clearing removes nothing from the rules.
 */
export const setCategory = mutation({
  args: {
    transactionId: v.id('transactions'),
    category: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { transactionId, category }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    const { user } = await requireOrgMember(ctx, tx.orgId)
    if (tx.matchStatus !== 'charge' && tx.matchStatus !== 'product') {
      throw new ConvexError('not_categorized')
    }
    if (category !== null && !isValidCategory(tx.matchStatus, category)) {
      throw new ConvexError('invalid_category')
    }

    await ctx.db.patch('transactions', transactionId, {
      category: category ?? undefined,
    })
    if (category === null) return { ruleCreated: false }
    const rule = await upsertRuleFromGesture(ctx, {
      orgId: tx.orgId,
      tx,
      status: tx.matchStatus,
      category,
      vatRateBps: tx.vatRateBps,
      createdBy: user._id,
    })
    return { ruleCreated: rule?.created ?? false }
  },
})

/**
 * Replays the org's learned rules on the whole `unmatched` queue (on-demand
 * catch-up — new ingested transactions get the rules applied at insert).
 * Direct patch, NO `matchingDecisions` row (machine decision, same principle
 * as the backfills). Rows without `searchText` (pre-backfill) never match.
 */
export const applyCategoryRules = mutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const rules = await loadOrgRules(ctx, orgId)
    if (rules.length === 0) return { applied: 0 }

    const unmatched = await ctx.db
      .query('transactions')
      .withIndex('by_org_matchStatus', (q) =>
        q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
      )
      .collect()

    let applied = 0
    for (const tx of unmatched) {
      const fields = ruleFieldsFor(rules, tx.searchText)
      if (!fields) continue
      await ctx.db.patch('transactions', tx._id, fields)
      applied += 1
    }
    return { applied }
  },
})

/**
 * Monthly in/out breakdown by analysis bucket over the last `monthsBack`
 * months (current month included) — the « Analyse » tab of the Cash page.
 * Buckets derive from the pointage state (lib/categories.ts
 * effectiveCategory): deal matches, liability allocations, taxes, then the
 * stored charge/product categories; `unmatched` rows surface as their own
 * bucket so the analysis is honest about what is not qualified yet.
 * Internal transfers and explicitly ignored rows are excluded (not flows),
 * tallied separately for visibility.
 */
export const getCategoryBreakdown = query({
  args: {
    orgId: v.id('organizations'),
    monthsBack: v.number(),
  },
  handler: async (ctx, { orgId, monthsBack }) => {
    await requireOrgMember(ctx, orgId)
    if (!Number.isInteger(monthsBack) || monthsBack < 1 || monthsBack > 24) {
      throw new ConvexError('invalid_horizon')
    }

    // Date.now() here defeats the query cache — same accepted trade-off as
    // getForecastGrid (cf. KNOWN_ISSUES.md « Cash flow forecast »).
    const now = new Date()
    const windowStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (monthsBack - 1),
      1,
    )
    const months: Array<string> = []
    for (let i = monthsBack - 1; i >= 0; i--) {
      months.push(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
          .toISOString()
          .slice(0, 7),
      )
    }

    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) =>
        q.eq('orgId', orgId).gte('transactionDate', windowStart),
      )
      .collect()

    const buckets = new Map<
      string,
      {
        direction: 'in' | 'out'
        category: string
        byMonth: Record<string, number>
        totalCents: number
      }
    >()
    let internalTransferCents = 0
    let ignoredCents = 0

    for (const tx of txs) {
      const category = effectiveCategory(tx)
      if (category === null) {
        if ((tx.matchStatus ?? 'unmatched') === 'internal_transfer') {
          internalTransferCents += tx.amount
        } else {
          ignoredCents += tx.amount
        }
        continue
      }
      const monthKey = new Date(tx.transactionDate).toISOString().slice(0, 7)
      const key = `${tx.direction}:${category}`
      const bucket = buckets.get(key) ?? {
        direction: tx.direction,
        category,
        byMonth: {},
        totalCents: 0,
      }
      bucket.byMonth[monthKey] = (bucket.byMonth[monthKey] ?? 0) + tx.amount
      bucket.totalCents += tx.amount
      buckets.set(key, bucket)
    }

    return {
      months,
      rows: [...buckets.values()].sort((a, b) => b.totalCents - a.totalCents),
      internalTransferCents,
      ignoredCents,
    }
  },
})

// ─── VAT (rate on charges/products, recoverable position) ───────────────────

/**
 * Sets or clears (`null` = back to « à qualifier ») the VAT rate of a
 * transaction already categorized as charge or product. Metadata, not a
 * matching decision: writes nothing to `matchingDecisions`.
 */
export const setVatRate = mutation({
  args: {
    transactionId: v.id('transactions'),
    vatRateBps: v.union(vatRateBpsValidator, v.null()),
  },
  handler: async (ctx, { transactionId, vatRateBps }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)
    if (tx.matchStatus !== 'charge' && tx.matchStatus !== 'product') {
      throw new ConvexError('not_categorized')
    }

    await ctx.db.patch('transactions', transactionId, {
      vatRateBps: vatRateBps ?? undefined,
    })
    return null
  },
})

/**
 * The org's VAT position: deductible VAT (qualified charges) − collected VAT
 * (qualified products), derived from the VAT-inclusive (TTC) amounts —
 * nothing is stored. Signed by direction: an `in` charge (supplier credit
 * note) subtracts, and so does an `out` product. `unqualifiedCount` counts
 * the charges/products without a rate (0 % = qualified).
 */
export const getVatPosition = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)

    let deductibleCents = 0
    let collectedCents = 0
    let unqualifiedCount = 0
    for (const status of ['charge', 'product'] as const) {
      const rows = await ctx.db
        .query('transactions')
        .withIndex('by_org_matchStatus', (q) =>
          q.eq('orgId', orgId).eq('matchStatus', status),
        )
        .collect()
      for (const tx of rows) {
        if (tx.vatRateBps == null) {
          unqualifiedCount += 1
          continue
        }
        const vat = vatCentsFromTtc(tx.amount, tx.vatRateBps)
        if (status === 'charge') {
          deductibleCents += tx.direction === 'out' ? vat : -vat
        } else {
          collectedCents += tx.direction === 'in' ? vat : -vat
        }
      }
    }

    return {
      deductibleCents,
      collectedCents,
      netCents: deductibleCents - collectedCents,
      unqualifiedCount,
    }
  },
})

/**
 * One-shot (idempotent) backfill of pre-existing transactions without
 * `matchStatus`. Rule: `reconciled === true` + `dealId` → 'matched';
 * everything else → 'unmatched' (a `dealId` not validated by a human is
 * cleared to preserve the matched ⟺ dealId invariant).
 *
 * Writes NOTHING to `matchingDecisions`: a backfill is not a human decision,
 * we don't pollute the dataset.
 *
 * To run manually ('{}' = all orgs, or target '{"orgId": "…"}'):
 *   pnpm exec convex run transactions:backfillMatchStatus '{}' --prod
 */
export const backfillMatchStatus = internalMutation({
  args: { orgId: v.optional(v.id('organizations')) },
  handler: async (ctx, { orgId }) => {
    const rows = orgId
      ? await ctx.db
          .query('transactions')
          .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
          .collect()
      : await ctx.db.query('transactions').collect()

    let matched = 0
    let unmatched = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.matchStatus !== undefined) {
        skipped += 1
        continue
      }
      if (tx.reconciled && tx.dealId) {
        await ctx.db.patch('transactions', tx._id, { matchStatus: 'matched' })
        matched += 1
      } else {
        await ctx.db.patch('transactions', tx._id, {
          matchStatus: 'unmatched',
          dealId: undefined,
        })
        unmatched += 1
      }
    }
    return { matched, unmatched, skipped }
  },
})

/**
 * One-shot (idempotent) backfill of the derived `searchText` field (full-text
 * search) on pre-existing transactions. Recent writes already set it (Powens,
 * Airtable import, Mémo CSV, agent) — a row without `searchText` is simply
 * invisible to search.
 *
 * To run manually ('{}' = all orgs, or target '{"orgId": "…"}'):
 *   pnpm exec convex run transactions:backfillSearchText '{}' --prod
 */
export const backfillSearchText = internalMutation({
  args: { orgId: v.optional(v.id('organizations')) },
  handler: async (ctx, { orgId }) => {
    const rows = orgId
      ? await ctx.db
          .query('transactions')
          .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
          .collect()
      : await ctx.db.query('transactions').collect()

    let updated = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.searchText !== undefined) {
        skipped += 1
        continue
      }
      await ctx.db.patch('transactions', tx._id, {
        searchText: buildSearchText(tx.rawLabel, tx.counterparty),
      })
      updated += 1
    }
    return { updated, skipped }
  },
})

/**
 * One-shot (idempotent) backfill of the generalized `allocation` matching on
 * pre-existing transactions: every transaction with a non-null `dealId` and
 * no `allocation` gets `allocation = { kind: 'deal', targetId: dealId }`.
 * Does not touch `dealId` (coexistence). A transaction with `allocation`
 * already set is skipped (re-running changes nothing).
 *
 * Writes NOTHING to `matchingDecisions`: a backfill is not a human decision,
 * we don't pollute the dataset.
 *
 * To run manually per org:
 *   pnpm exec convex run transactions:backfillAllocation '{"orgId": "…"}' --prod
 */
export const backfillAllocation = internalMutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('transactions')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .collect()

    let updated = 0
    let skipped = 0
    for (const tx of rows) {
      if (tx.allocation !== undefined || tx.dealId == null) {
        skipped += 1
        continue
      }
      await ctx.db.patch('transactions', tx._id, {
        allocation: { kind: 'deal', targetId: tx.dealId },
      })
      updated += 1
    }
    return { updated, skipped }
  },
})
