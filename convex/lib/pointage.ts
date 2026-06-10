import { ConvexError } from 'convex/values'

import { recordDecision } from './matchingLog'
import { loanSideForOrg } from './liabilities'

import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { VatRateBps } from './vat'

type MutCtx = GenericMutationCtx<DataModel>

/**
 * Cœur du pointage transaction → deal / passif, partagé par les mutations
 * publiques (convex/transactions.ts, convex/liabilities.ts) et les outils
 * agent (convex/agentToolsPointage.ts) pour qu'ils ne divergent jamais.
 *
 * Invariants (cf. KNOWN_ISSUES.md « Pointage » / « Passif ») :
 * - `matchStatus === 'matched'` ⟺ rattachée à un deal (`dealId != null` +
 *   `allocation.kind === 'deal'`) OU allouée au passif (`dealId == null` +
 *   `allocation.kind === 'equity' | 'intercompany_loan'`).
 * - `reconciled` (+ by/at) est un miroir dérivé du pointage DEAL uniquement.
 * - Chaque décision deal écrit une ligne append-only dans `matchingDecisions`
 *   (`source: 'manual' | 'agent_suggested'`) ; le pointage passif n'y écrit
 *   jamais.
 * - `vatRateBps` ne vit que sur les statuts `charge` / `product` : tout
 *   pointage qui fait quitter ces statuts l'efface (cf. KNOWN_ISSUES.md
 *   « TVA récupérable »).
 *
 * L'appelant a déjà chargé la transaction et vérifié l'appartenance à l'org.
 */

export type PointageSource = 'manual' | 'agent_suggested'

export type CategorizeStatus =
  | 'ignored'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

/**
 * Garde-fou : refuse d'écraser silencieusement un pointage passif
 * (equity / C/C). Détacher d'abord via `applyDeallocate`.
 */
export function assertNotAllocatedToLiability(tx: Doc<'transactions'>) {
  if (tx.allocation && tx.allocation.kind !== 'deal') {
    throw new ConvexError('allocated_to_liability')
  }
}

/** Rattache une transaction à un deal de la même org. */
export async function applyMatchToDeal(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  dealId: Id<'deals'>,
  decidedBy: Id<'users'>,
  source: PointageSource,
) {
  assertNotAllocatedToLiability(tx)

  const deal = await ctx.db.get('deals', dealId)
  if (!deal || deal.orgId !== tx.orgId) {
    throw new ConvexError('deal_wrong_org')
  }

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'matched',
    dealId,
    allocation: { kind: 'deal', targetId: dealId },
    vatRateBps: undefined,
    reconciled: true,
    reconciledBy: decidedBy,
    reconciledAt: Date.now(),
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: 'matched',
    dealId,
    source,
    decidedBy,
  })
}

/** Dé-pointe une transaction deal (retour à `unmatched`), décision loggée. */
export async function applyUnmatch(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  decidedBy: Id<'users'>,
  source: PointageSource,
) {
  // Une tx allouée au passif se détache via applyDeallocate — un unmatch
  // deal ici laisserait son allocation orpheline.
  assertNotAllocatedToLiability(tx)

  await ctx.db.patch('transactions', tx._id, {
    matchStatus: 'unmatched',
    dealId: undefined,
    allocation: undefined,
    vatRateBps: undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: 'unmatched',
    source,
    decidedBy,
  })
}

/**
 * Écarte une transaction : ignorée, charge, impôt, produit ou virement
 * interne. Même patch pour tous les statuts — seul le statut diffère pour
 * pouvoir consulter ces transactions plus tard. `vatRateBps` (TVA) n'existe
 * que sur charge/produit : posé si fourni (sinon valeur existante conservée),
 * effacé pour tout autre statut.
 */
export async function applyCategorization(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  status: CategorizeStatus,
  decidedBy: Id<'users'>,
  source: PointageSource,
  vatRateBps?: VatRateBps,
) {
  assertNotAllocatedToLiability(tx)
  const vatBearing = status === 'charge' || status === 'product'
  await ctx.db.patch('transactions', tx._id, {
    matchStatus: status,
    dealId: undefined,
    allocation: undefined,
    vatRateBps: vatBearing ? (vatRateBps ?? tx.vatRateBps) : undefined,
    reconciled: false,
    reconciledBy: undefined,
    reconciledAt: undefined,
  })
  await recordDecision(ctx, {
    transaction: tx,
    decision: status,
    source,
    decidedBy,
  })
}

/**
 * Pointe une transaction sur une position de capital (`equity`) ou un compte
 * courant inter-entités (`intercompany_loan`). La cible doit appartenir à la
 * même org que la transaction (pour un C/C : l'org de la tx doit être l'une
 * des deux parties du prêt). N'écrit JAMAIS dans `matchingDecisions`, ne
 * touche jamais `reconciled` (miroir du pointage deal uniquement).
 */
export async function applyAllocateToLiability(
  ctx: MutCtx,
  tx: Doc<'transactions'>,
  kind: 'equity' | 'intercompany_loan',
  targetId: string,
) {
  // Garde-fou : pas de double pointage silencieux. Une tx rattachée à un
  // deal doit être dé-pointée (applyUnmatch) avant d'aller au passif.
  if (tx.dealId != null || tx.allocation?.kind === 'deal') {
    throw new ConvexError('already_matched_to_deal')
  }

  if (kind === 'equity') {
    const positionId = ctx.db.normalizeId('equityPositions', targetId)
    const position = positionId
      ? await ctx.db.get('equityPositions', positionId)
      : null
    if (!position) throw new ConvexError('not_found')
    if (position.orgId !== tx.orgId) throw new ConvexError('equity_wrong_org')
  } else {
    const loanId = ctx.db.normalizeId('intercompanyLoans', targetId)
    const loan = loanId ? await ctx.db.get('intercompanyLoans', loanId) : null
    if (!loan) throw new ConvexError('not_found')
    // La tx doit appartenir à l'une des deux orgs du C/C (créancier ou
    // débiteur) — sinon elle ne peut pas porter une jambe de ce prêt.
    if (loanSideForOrg(loan, tx.orgId) === null) {
      throw new ConvexError('loan_wrong_org')
    }
  }

  await ctx.db.patch('transactions', tx._id, {
    allocation: { kind, targetId },
    matchStatus: 'matched',
    vatRateBps: undefined,
  })
}

/**
 * Détache une transaction du passif : retour à l'état non pointé
 * (`unmatched`). Idempotent — sans allocation passif, ne touche à rien.
 * Une tx rattachée à un deal n'est pas concernée : passer par `applyUnmatch`.
 */
export async function applyDeallocate(ctx: MutCtx, tx: Doc<'transactions'>) {
  if (tx.allocation?.kind === 'deal') {
    throw new ConvexError('already_matched_to_deal')
  }
  if (!tx.allocation) return

  await ctx.db.patch('transactions', tx._id, {
    allocation: undefined,
    matchStatus: 'unmatched',
    vatRateBps: undefined,
  })
}
