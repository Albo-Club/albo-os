/**
 * Outils agent de pointage transaction → deal / passif, scopés à l'org du
 * thread (même pattern que convex/agentTools.ts : internalQuery /
 * internalMutation + re-check membership via `actorUserId`).
 *
 * Le cœur des écritures vit dans convex/lib/pointage.ts (partagé avec les
 * mutations publiques) ; les décisions agent sont loggées
 * `source: 'agent_suggested'` dans `matchingDecisions`.
 *
 * Toute liste retournée est BORNÉE (`.take`) — jamais le `.collect()`
 * exhaustif des queries publiques (contexte LLM + guidelines Convex).
 */

import { ConvexError, v } from 'convex/values'
import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'
import { parseScope, readMembership } from './lib/agentScope'
import {
  applyAllocateToLiability,
  applyCategorization,
  applyDeallocate,
  applyMatchToDeal,
  applyUnmatch,
} from './lib/pointage'
import { rankCandidates } from './lib/suggest'
import { normalizeSearch } from './lib/searchText'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import type { SimilarTarget } from './lib/suggest'

const LIST_LIMIT_MAX = 50
const LIST_LIMIT_DEFAULT = 25
const SUGGEST_TX_MAX = 10
const SUGGEST_TX_DEFAULT = 5
const SIMILAR_PER_TX = 8
const DECISIONS_SCAN = 200

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

async function getOrgTransaction(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
  transactionId: Id<'transactions'>,
): Promise<Doc<'transactions'>> {
  const tx = await ctx.db.get('transactions', transactionId)
  if (!tx || tx.orgId !== orgId) throw new ConvexError('not_found')
  return tx
}

// ─── Internal queries / mutations (re-check membership) ─────────────────────

export const listUnmatchedInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, actorUserId, search, limit }) => {
    await readMembership(ctx, orgId, actorUserId)
    const take = Math.min(Math.max(limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX)

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
          .take(take)
      : await ctx.db
          .query('transactions')
          .withIndex('by_org_matchStatus', (q) =>
            q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
          )
          .order('desc')
          .take(take)

    rows.sort((a, b) => b.transactionDate - a.transactionDate)
    return await Promise.all(
      rows.map(async (tx) => {
        const account = await ctx.db.get('bankAccounts', tx.bankAccountId)
        return {
          _id: tx._id,
          dateISO: toISODate(tx.transactionDate),
          direction: tx.direction,
          amountCents: tx.amount,
          rawLabel: tx.rawLabel,
          counterparty: tx.counterparty ?? null,
          accountLabel: account?.label ?? null,
        }
      }),
    )
  },
})

export const matchToDealInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.id('transactions'),
    dealId: v.id('deals'),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId, dealId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const tx = await getOrgTransaction(ctx, orgId, transactionId)
    await applyMatchToDeal(ctx, tx, dealId, actorUserId, 'agent_suggested')
    return { _id: transactionId, matchStatus: 'matched' as const }
  },
})

export const allocateToLiabilityInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.id('transactions'),
    kind: v.union(v.literal('equity'), v.literal('intercompany_loan')),
    targetId: v.string(),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId, kind, targetId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const tx = await getOrgTransaction(ctx, orgId, transactionId)
    await applyAllocateToLiability(ctx, tx, kind, targetId)
    return { _id: transactionId, matchStatus: 'matched' as const }
  },
})

export const categorizeInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.id('transactions'),
    status: v.union(
      v.literal('ignored'),
      v.literal('charge'),
      v.literal('tax'),
      v.literal('product'),
      v.literal('internal_transfer'),
    ),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId, status }) => {
    await readMembership(ctx, orgId, actorUserId)
    const tx = await getOrgTransaction(ctx, orgId, transactionId)
    await applyCategorization(ctx, tx, status, actorUserId, 'agent_suggested')
    return { _id: transactionId, matchStatus: status }
  },
})

export const unpointInternal = internalMutation({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.id('transactions'),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId }) => {
    await readMembership(ctx, orgId, actorUserId)
    const tx = await getOrgTransaction(ctx, orgId, transactionId)
    // Route selon le type de pointage : passif → détachement silencieux,
    // deal (ou rien) → unmatch loggé.
    if (tx.allocation && tx.allocation.kind !== 'deal') {
      await applyDeallocate(ctx, tx)
    } else {
      await applyUnmatch(ctx, tx, actorUserId, 'agent_suggested')
    }
    return { _id: transactionId, matchStatus: 'unmatched' as const }
  },
})

/**
 * Libellé lisible d'une cible de pointage (pour les suggestions).
 * Mise en cache par l'appelant via `labelCache`.
 */
async function resolveTargetLabel(
  ctx: QueryCtx,
  kind: 'deal' | 'equity' | 'intercompany_loan',
  targetId: string,
  labelCache: Map<string, { label: string | null; committed: number | null }>,
): Promise<{ label: string | null; committed: number | null }> {
  const key = `${kind}:${targetId}`
  const cached = labelCache.get(key)
  if (cached) return cached

  let resolved: { label: string | null; committed: number | null } = {
    label: null,
    committed: null,
  }
  if (kind === 'deal') {
    const dealId = ctx.db.normalizeId('deals', targetId)
    const deal = dealId ? await ctx.db.get('deals', dealId) : null
    if (deal) {
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      resolved = {
        label:
          deal.name ??
          (target ? `${target.name} · ${deal.instrumentKind}` : null),
        committed: deal.committedAmount ?? null,
      }
    }
  } else if (kind === 'equity') {
    const positionId = ctx.db.normalizeId('equityPositions', targetId)
    const position = positionId
      ? await ctx.db.get('equityPositions', positionId)
      : null
    if (position) resolved = { label: position.type, committed: null }
  } else {
    const loanId = ctx.db.normalizeId('intercompanyLoans', targetId)
    const loan = loanId ? await ctx.db.get('intercompanyLoans', loanId) : null
    if (loan) {
      const [from, to] = await Promise.all([
        ctx.db.get('organizations', loan.fromOrgId),
        ctx.db.get('organizations', loan.toOrgId),
      ])
      resolved = {
        label: `${from?.name ?? '?'} → ${to?.name ?? '?'}`,
        committed: null,
      }
    }
  }
  labelCache.set(key, resolved)
  return resolved
}

export const suggestMatchesInternal = internalQuery({
  args: {
    orgId: v.id('organizations'),
    actorUserId: v.id('users'),
    transactionId: v.optional(v.id('transactions')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, actorUserId, transactionId, limit }) => {
    await readMembership(ctx, orgId, actorUserId)

    // Transactions à traiter : une seule (id fourni) ou les N plus récentes
    // de la file.
    const targets = transactionId
      ? [await getOrgTransaction(ctx, orgId, transactionId)]
      : await ctx.db
          .query('transactions')
          .withIndex('by_org_matchStatus', (q) =>
            q.eq('orgId', orgId).eq('matchStatus', 'unmatched'),
          )
          .order('desc')
          .take(Math.min(Math.max(limit ?? SUGGEST_TX_DEFAULT, 1), SUGGEST_TX_MAX))

    // Signal secondaire : décisions `matched` récentes par deal.
    const decisions = await ctx.db
      .query('matchingDecisions')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .order('desc')
      .take(DECISIONS_SCAN)
    const decisionsCountByTarget: Record<string, number> = {}
    for (const decision of decisions) {
      if (decision.decision !== 'matched' || !decision.dealId) continue
      decisionsCountByTarget[decision.dealId] =
        (decisionsCountByTarget[decision.dealId] ?? 0) + 1
    }

    const labelCache = new Map<
      string,
      { label: string | null; committed: number | null }
    >()

    return await Promise.all(
      targets.map(async (tx) => {
        const term = normalizeSearch(
          `${tx.rawLabel} ${tx.counterparty ?? ''}`,
        ).trim()
        const similar = term
          ? await ctx.db
              .query('transactions')
              .withSearchIndex('search_text', (q) =>
                q
                  .search('searchText', term)
                  .eq('orgId', orgId)
                  .eq('matchStatus', 'matched'),
              )
              .take(SIMILAR_PER_TX)
          : []

        const similarTargets: Array<SimilarTarget> = []
        for (const s of similar) {
          if (s._id === tx._id) continue
          const kind = s.dealId
            ? ('deal' as const)
            : s.allocation && s.allocation.kind !== 'deal'
              ? s.allocation.kind
              : null
          if (!kind) continue
          const targetId = s.dealId ?? s.allocation?.targetId
          if (!targetId) continue
          const { label, committed } = await resolveTargetLabel(
            ctx,
            kind,
            targetId,
            labelCache,
          )
          similarTargets.push({
            kind,
            targetId,
            targetLabel: label,
            committedAmountCents: committed,
          })
        }

        return {
          transactionId: tx._id,
          dateISO: toISODate(tx.transactionDate),
          direction: tx.direction,
          amountCents: tx.amount,
          rawLabel: tx.rawLabel,
          candidates: rankCandidates({
            txAmountCents: tx.amount,
            similarTargets,
            decisionsCountByTarget,
          }),
        }
      }),
    )
  },
})

// ─── Tools exposés à l'agent ────────────────────────────────────────────────

const listUnmatchedTransactions = createTool({
  description:
    'List unreconciled bank transactions (the pointage queue) in the ' +
    'current org, most recent first. Optional search filters by ' +
    'label/counterparty. Returns at most 50 rows (default 25). Amounts are ' +
    'in CENTS EUR.',
  inputSchema: z.object({
    search: z.string().optional().describe('Filter by label/counterparty'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(internal.agentToolsPointage.listUnmatchedInternal, {
      orgId,
      actorUserId: userId,
      search: input.search,
      limit: input.limit,
    })
  },
})

const suggestMatches = createTool({
  description:
    'Suggest likely reconciliation targets (deal, equity position or ' +
    'intercompany loan) for unmatched transactions, based on previously ' +
    'matched transactions with similar labels and past matching decisions. ' +
    'Pass transactionId to analyse one transaction, or omit it to analyse ' +
    'the most recent unmatched ones (default 5, max 10). Present the ' +
    'candidates to the user and WAIT for their confirmation before calling ' +
    'matchTransactionToDeal / allocateTransactionToLiability. An empty ' +
    'candidates list means no signal — do not guess.',
  inputSchema: z.object({
    transactionId: z.string().optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runQuery(
      internal.agentToolsPointage.suggestMatchesInternal,
      {
        orgId,
        actorUserId: userId,
        transactionId: input.transactionId
          ? (input.transactionId as Id<'transactions'>)
          : undefined,
        limit: input.limit,
      },
    )
  },
})

const matchTransactionToDeal = createTool({
  description:
    'Reconcile a transaction with a deal of the current org. The user MUST ' +
    'confirm the exact transaction + deal pair first (e.g. after ' +
    'suggestMatches). Fails if the transaction is allocated to a liability ' +
    '(unpoint it first).',
  inputSchema: z.object({
    transactionId: z.string(),
    dealId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsPointage.matchToDealInternal,
      {
        orgId,
        actorUserId: userId,
        transactionId: input.transactionId as Id<'transactions'>,
        dealId: input.dealId as Id<'deals'>,
      },
    )
  },
})

const allocateTransactionToLiability = createTool({
  description:
    'Reconcile a transaction with a liability of the current org: an equity ' +
    'position (kind "equity") or an intercompany loan (kind ' +
    '"intercompany_loan"). Find target ids via listLiabilities. The user ' +
    'MUST confirm first. Fails if the transaction is matched to a deal ' +
    '(unpoint it first).',
  inputSchema: z.object({
    transactionId: z.string(),
    kind: z.enum(['equity', 'intercompany_loan']),
    targetId: z.string().describe('equityPositions or intercompanyLoans id'),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(
      internal.agentToolsPointage.allocateToLiabilityInternal,
      {
        orgId,
        actorUserId: userId,
        transactionId: input.transactionId as Id<'transactions'>,
        kind: input.kind,
        targetId: input.targetId,
      },
    )
  },
})

const categorizeTransaction = createTool({
  description:
    'Set aside a transaction that concerns no deal: "ignored", "charge" ' +
    '(operating cost), "tax", "product" (income unrelated to a deal) or ' +
    '"internal_transfer" (between own accounts). The user MUST confirm ' +
    'first.',
  inputSchema: z.object({
    transactionId: z.string(),
    status: z.enum(['ignored', 'charge', 'tax', 'product', 'internal_transfer']),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.agentToolsPointage.categorizeInternal, {
      orgId,
      actorUserId: userId,
      transactionId: input.transactionId as Id<'transactions'>,
      status: input.status,
    })
  },
})

const unpointTransaction = createTool({
  description:
    'Undo the reconciliation of a transaction (deal match, liability ' +
    'allocation or categorization): it returns to the unmatched queue. The ' +
    'user MUST confirm first.',
  inputSchema: z.object({
    transactionId: z.string(),
  }),
  execute: async (ctx, input): Promise<unknown> => {
    const { orgId, userId } = parseScope(ctx.userId)
    return await ctx.runMutation(internal.agentToolsPointage.unpointInternal, {
      orgId,
      actorUserId: userId,
      transactionId: input.transactionId as Id<'transactions'>,
    })
  },
})

export const pointageTools = {
  listUnmatchedTransactions,
  suggestMatches,
  matchTransactionToDeal,
  allocateTransactionToLiability,
  categorizeTransaction,
  unpointTransaction,
}
