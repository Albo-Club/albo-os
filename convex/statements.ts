/**
 * Bank-statement import — the door that fills a placement when no connection
 * can (convex/lib/statements.ts holds the pure half).
 *
 * Why it exists: Powens does not cover the securities accounts of every bank
 * (Natixis Wealth Management among them), so their valuation has no feed. The
 * answer is not a figure typed by hand that quietly goes stale — it is the
 * statement itself, dropped in every couple of months and read by a model.
 *
 * The flow is deliberately in TWO steps, and nothing is written by the first:
 *   `parse`  (action)   PDF blob → OCR → model → a draft handed BACK to the
 *                       screen. No write at all.
 *   `apply`  (mutation) the draft the human validated → accounts, positions,
 *                       dated valuations, one `statementImports` row.
 *
 * That split is the whole safety property. A model reading a table can be
 * wrong, and a wrong valuation written in silence is invisible forever: the
 * screen shows what was understood, account per account, with the sum of the
 * lines checked against the total the statement itself prints
 * (`DraftAccount.coherent`), and a human says yes.
 *
 * Blob lifetime: an applied import OWNS its PDF (`statementImports.storageId`)
 * and deleting the row deletes the file. A `parse` the user walks away from
 * would leave a blob referenced by nothing, so it schedules its own sweep —
 * cf. KNOWN_ISSUES.md « Un proxy de téléchargement qui stocke pour servir ».
 *
 * Tenancy: `parse` and `apply` both check membership of the org they are
 * given, and every row they resolve (account, deal) is re-checked to belong
 * to it. The org is an argument here and legitimately so — a PDF carries no
 * anchor to derive one from, unlike `documents:create`.
 */

import { generateObject } from 'ai'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  action,
  internalAction,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { getModel } from './agent'
import { requireOrgMember } from './lib/auth'
import { ocrPdf } from './lib/ocr'
import {
  STATEMENT_SYSTEM_PROMPT,
  STATEMENT_TEXT_WINDOW,
  normalizeStatement,
  statementSchema,
} from './lib/statements'
import { statementSource } from './schema'

import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import type { StatementDraft } from './lib/statements'

/** How long an uploaded PDF may sit unclaimed before the sweep frees it. Long
 * enough to read a verification screen carefully, short enough that an
 * abandoned import costs nothing. */
const UNCLAIMED_BLOB_MS = 60 * 60 * 1000

/** `valuations.source` of a point written by a statement import. It is what
 * makes re-importing the same date a correction instead of a second point. */
const VALUATION_SOURCE = 'statement_import'

// ─── Parse (no write) ────────────────────────────────────────────────────────

/** Auth for `parse` — actions have no `ctx.db` (same probe pattern as
 * `investments.refreshAuthProbe`). */
export const parseAuthProbe = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return { ok: true as const }
  },
})

/**
 * Reads a statement PDF and returns what it understood. Writes NOTHING —
 * the caller shows the draft, the human validates, `apply` writes.
 *
 * Throws `statement_unreadable` when the OCR comes back empty (an image-only
 * scan, a missing OCR key) and `statement_unparsed` when the model fails or
 * finds no account: both are states the screen must name, not swallow.
 */
export const parse = action({
  args: {
    orgId: v.id('organizations'),
    storageId: v.id('_storage'),
    source: statementSource,
  },
  handler: async (ctx, { orgId, storageId }): Promise<StatementDraft> => {
    await ctx.runQuery(internal.statements.parseAuthProbe, { orgId })

    // The blob is claimed by `apply` or freed by this sweep — never left.
    await ctx.scheduler.runAfter(
      UNCLAIMED_BLOB_MS,
      internal.statements.sweepUnclaimedBlob,
      { storageId },
    )

    const blob = await ctx.storage.get(storageId)
    if (!blob) throw new ConvexError('not_found')
    const text = (await ocrPdf(await blob.arrayBuffer())).trim()
    if (!text) throw new ConvexError('statement_unreadable')

    let draft: StatementDraft
    try {
      const { object } = await generateObject({
        model: getModel(),
        schema: statementSchema,
        system: STATEMENT_SYSTEM_PROMPT,
        prompt: `TEXTE DU RELEVÉ :\n${text.slice(0, STATEMENT_TEXT_WINDOW)}`,
      })
      draft = normalizeStatement(object)
    } catch (err) {
      console.warn(
        '[statements] parse failed:',
        err instanceof Error ? err.message : String(err),
      )
      throw new ConvexError('statement_unparsed')
    }
    if (draft.accounts.length === 0) throw new ConvexError('statement_unparsed')
    return draft
  },
})

/**
 * Frees a PDF that no import ever claimed. Tolerates a world that moved on:
 * the blob may have become an import's (nothing to do) or already be gone
 * (`storage.delete` THROWS on a missing blob, which would fail a scheduled
 * job with nothing left to do).
 */
export const sweepUnclaimedBlob = internalAction({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const claimed = await ctx.runQuery(internal.statements.isBlobClaimed, {
      storageId,
    })
    if (claimed) return null
    try {
      await ctx.storage.delete(storageId)
    } catch {
      // Already gone — the point was that it stops existing.
    }
    return null
  },
})

export const isBlobClaimed = internalQuery({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const row = await ctx.db
      .query('statementImports')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first()
    return row != null
  },
})

// ─── Apply (the write) ───────────────────────────────────────────────────────

const positionArg = v.object({
  label: v.string(),
  isinCode: v.optional(v.string()),
  assetCategory: v.optional(v.string()),
  quantity: v.optional(v.number()),
  unitValue: v.optional(v.number()),
  unitValueBps: v.optional(v.number()),
  avgPrice: v.optional(v.number()),
  valuation: v.optional(v.number()),
  diff: v.optional(v.number()),
  isCash: v.boolean(),
})

const accountArg = v.object({
  accountNumber: v.string(),
  label: v.string(),
  /** Cents — what the placement's balance becomes. */
  valuation: v.number(),
  /** Existing placement to update. Absent = create one for this account. */
  dealId: v.optional(v.id('deals')),
  /** Skip the creation instead: the account is imported, no placement. */
  noPlacement: v.optional(v.boolean()),
  positions: v.array(positionArg),
})

/**
 * Writes a validated statement.
 *
 * Per account, in order: resolve or create the `bankAccounts` row (matched on
 * `accountNumber` within the org), refresh its balance AT THE STATEMENT'S
 * DATE, replace its positions wholesale, then carry the valuation to the
 * placement — an existing one, or one created on the spot.
 *
 * Re-importing the same statement date CORRECTS that import: the row, the
 * balances, the positions and the dated valuations are all rewritten in
 * place. A different date adds a point and touches no earlier one — which is
 * what builds the balance history.
 */
export const apply = mutation({
  args: {
    orgId: v.id('organizations'),
    storageId: v.id('_storage'),
    source: statementSource,
    statementDate: v.number(),
    bankName: v.string(),
    /** Group entity that owns the accounts and holds the placements. */
    ownerCompanyId: v.id('companies'),
    /** Support company of the placements created here (the bank). Required
     * only when an account actually asks for a placement to be created. */
    supportCompanyId: v.optional(v.id('companies')),
    accounts: v.array(accountArg),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrgMember(ctx, args.orgId)

    const owner = await ctx.db.get('companies', args.ownerCompanyId)
    if (!owner || owner.orgId !== args.orgId) {
      throw new ConvexError('owner_wrong_org')
    }
    // An account's owner is always a group entity — same rule as everywhere
    // else (`bankAccounts.ownerCompanyId`, `assertInvestorIsGroupEntity`).
    if (!owner.kind.startsWith('group_')) {
      throw new ConvexError('owner_must_be_group_entity')
    }
    if (args.supportCompanyId) {
      const support = await ctx.db.get('companies', args.supportCompanyId)
      if (!support || support.orgId !== args.orgId) {
        throw new ConvexError('support_wrong_org')
      }
    }
    if (args.accounts.length === 0) throw new ConvexError('no_account')

    const now = Date.now()
    let positionsCount = 0
    let totalValuation = 0

    for (const account of args.accounts) {
      const accountNumber = account.accountNumber.trim()
      if (!accountNumber) throw new ConvexError('missing_account_number')

      const existing = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org_account_number', (q) =>
          q.eq('orgId', args.orgId).eq('accountNumber', accountNumber),
        )
        .first()
      const bankAccountId =
        existing?._id ??
        (await ctx.db.insert('bankAccounts', {
          orgId: args.orgId,
          ownerCompanyId: args.ownerCompanyId,
          bankName: args.bankName,
          label: account.label,
          accountNumber,
          accountKind: 'cto',
          currency: 'EUR',
          // Securities pledged to a lender are not mobilizable cash. The
          // statement cannot say whether they are, so the safe default is to
          // keep them OUT of the available balance: an account wrongly
          // counted as cash overstates what the group can spend, and the
          // Trésorerie page is where that is corrected in one click.
          pledged: true,
        }))
      // The balance is dated at the STATEMENT, not at the import: a statement
      // read three weeks late describes the day it was drawn.
      await ctx.db.patch('bankAccounts', bankAccountId, {
        currentBalance: account.valuation,
        balanceAsOf: args.statementDate,
      })

      const previous = await ctx.db
        .query('investmentPositions')
        .withIndex('by_account', (q) => q.eq('bankAccountId', bankAccountId))
        .collect()
      for (const row of previous) {
        await ctx.db.delete('investmentPositions', row._id)
      }
      for (const position of account.positions) {
        await ctx.db.insert('investmentPositions', {
          orgId: args.orgId,
          bankAccountId,
          source: 'statement',
          ...position,
          valuationDate: args.statementDate,
          syncedAt: now,
        })
      }
      positionsCount += account.positions.length
      totalValuation += account.valuation

      if (account.noPlacement) continue
      if (!account.dealId && !args.supportCompanyId) {
        throw new ConvexError('support_required')
      }
      const dealId =
        account.dealId ??
        (await ctx.db.insert('deals', {
          orgId: args.orgId,
          investorCompanyId: args.ownerCompanyId,
          targetCompanyId: args.supportCompanyId!,
          instrumentKind: 'cto',
          status: 'active',
          currency: 'EUR',
          name: account.label,
          bankName: args.bankName,
          bankAccountId,
        }))
      const deal = await ctx.db.get('deals', dealId)
      if (!deal || deal.orgId !== args.orgId) {
        throw new ConvexError('deal_wrong_org')
      }
      await ctx.db.patch('deals', dealId, {
        currentValue: account.valuation,
        // An existing placement may not have been linked to its account yet —
        // importing its statement is exactly the moment it becomes known.
        bankAccountId: deal.bankAccountId ?? bankAccountId,
      })
      await upsertValuation(ctx, {
        orgId: args.orgId,
        dealId,
        asOf: args.statementDate,
        fairValue: account.valuation,
      })
    }

    // One import per (org, source, statement date): a statement sent twice is
    // a correction, never a second history point.
    const previousImport = await ctx.db
      .query('statementImports')
      .withIndex('by_org_source_date', (q) =>
        q
          .eq('orgId', args.orgId)
          .eq('source', args.source)
          .eq('statementDate', args.statementDate),
      )
      .first()
    const summary = {
      accountsCount: args.accounts.length,
      positionsCount,
      totalValuation,
      bankName: args.bankName,
      storageId: args.storageId,
      importedBy: user._id,
      importedAt: now,
    }
    if (previousImport) {
      const staleBlob =
        previousImport.storageId !== args.storageId
          ? previousImport.storageId
          : null
      await ctx.db.patch('statementImports', previousImport._id, summary)
      // The superseded PDF has lost its only referent.
      if (staleBlob) await ctx.storage.delete(staleBlob)
      return { statementImportId: previousImport._id, ...summary }
    }
    const statementImportId = await ctx.db.insert('statementImports', {
      orgId: args.orgId,
      source: args.source,
      statementDate: args.statementDate,
      ...summary,
    })
    return { statementImportId, ...summary }
  },
})

/**
 * Writes the placement's dated valuation, replacing the one already standing
 * at that exact date. `deals:update` logs a valuation at `Date.now()`, which
 * is the right answer for a balance typed today and the wrong one here: a
 * statement's value belongs to the statement's date, and re-importing it must
 * correct that point rather than stack a second one on the same day.
 */
async function upsertValuation(
  ctx: MutationCtx,
  row: {
    orgId: Id<'organizations'>
    dealId: Id<'deals'>
    asOf: number
    fairValue: number
  },
) {
  // The valuations module's contract: a fair value is strictly positive.
  if (row.fairValue <= 0) return
  const sameDate = await ctx.db
    .query('valuations')
    .withIndex('by_deal_asof', (q) =>
      q.eq('dealId', row.dealId).eq('asOf', row.asOf),
    )
    .collect()
  const standing = sameDate.find((point) => point.source === VALUATION_SOURCE)
  if (standing) {
    await ctx.db.patch('valuations', standing._id, { fairValue: row.fairValue })
    return
  }
  await ctx.db.insert('valuations', {
    orgId: row.orgId,
    dealId: row.dealId,
    asOf: row.asOf,
    fairValue: row.fairValue,
    valuationMethod: 'mark_to_market',
    source: VALUATION_SOURCE,
  })
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Imports of an org, most recent statement first. Feeds the "last statement"
 * line of the Placements page — and the freshness signal that will read the
 * same row.
 */
export const listImports = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const rows = await ctx.db
      .query('statementImports')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .order('desc')
      .take(12)
    return rows.map((row) => ({
      _id: row._id,
      source: row.source,
      statementDate: row.statementDate,
      bankName: row.bankName,
      accountsCount: row.accountsCount,
      positionsCount: row.positionsCount,
      totalValuation: row.totalValuation ?? null,
      importedAt: row.importedAt,
    }))
  },
})

/** Deletes an import and frees its PDF. The data it wrote STAYS: balances,
 * positions and valuations are the statement's readings, not the row's
 * property — removing the trace of an import must not silently empty a
 * placement. */
export const removeImport = mutation({
  args: { statementImportId: v.id('statementImports') },
  handler: async (ctx, { statementImportId }) => {
    const row = await ctx.db.get('statementImports', statementImportId)
    if (!row) throw new ConvexError('not_found')
    await requireOrgMember(ctx, row.orgId)
    await ctx.db.delete('statementImports', statementImportId)
    await ctx.storage.delete(row.storageId)
    return null
  },
})

/** Placements of an org that a statement account can be attached to, with the
 * account they already point at. Feeds the per-account Select of the
 * verification screen. */
export const listPlacementTargets = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const placements = deals.filter((d) => d.instrumentKind === 'cto')
    return await Promise.all(
      placements.map(async (deal) => {
        const account = deal.bankAccountId
          ? await ctx.db.get('bankAccounts', deal.bankAccountId)
          : null
        const target = await ctx.db.get('companies', deal.targetCompanyId)
        return {
          _id: deal._id,
          name: deal.name ?? target?.name ?? '—',
          accountNumber: account?.accountNumber ?? null,
        }
      }),
    )
  },
})

/** Internal reader used by the regression tests and, later, the freshness
 * signal: the most recent statement date of an org. */
export const lastStatementDate = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const row = await ctx.db
      .query('statementImports')
      .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
      .order('desc')
      .first()
    return row?.statementDate ?? null
  },
})
