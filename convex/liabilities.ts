import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAppUser, requireOrgMember } from './lib/auth'
import { computeLoanBalanceCents, loanSideForOrg } from './lib/liabilities'
import { applyAllocateToLiability, applyDeallocate } from './lib/pointage'
import { buildSearchText } from './lib/searchText'
import { equityPositionType } from './schema'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Shape minimale d'une transaction pointée sur une cible passif, pour
 * l'affichage et le détachement côté front.
 */
function pickAllocatedTx(tx: Doc<'transactions'>) {
  return {
    _id: tx._id,
    direction: tx.direction,
    amount: tx.amount,
    transactionDate: tx.transactionDate,
    rawLabel: tx.rawLabel,
    counterparty: tx.counterparty ?? null,
  }
}

/**
 * Logique de lecture du passif, partagée par la query publique (après auth).
 *
 * Les soldes ne sont JAMAIS stockés : chaque org somme SES propres
 * transactions dont `allocation` cible le prêt (index
 * `by_org_allocation_target`). Signe : + = créance (org créancière),
 * − = dette (org débitrice). Cf. convex/lib/liabilities.ts.
 */
export async function getLiabilitiesForOrg(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
) {
  // Transactions de l'org pointées sur une cible donnée (sans le `_id` de la
  // cible on lirait toute la table : l'index porte orgId + allocation.targetId).
  const allocatedTxs = async (
    targetId: string,
    kind: 'equity' | 'intercompany_loan',
  ) => {
    const txs = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', targetId),
      )
      .collect()
    return txs.filter((tx) => tx.allocation?.kind === kind)
  }

  // 1. Capitaux propres émis par l'org, enrichis du nom du détenteur et des
  //    transactions pointées dessus.
  const positions = await ctx.db
    .query('equityPositions')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  const equityPositions = await Promise.all(
    positions.map(async (position) => {
      const holderOrg = position.holderOrgId
        ? await ctx.db.get('organizations', position.holderOrgId)
        : null
      const allocated = await allocatedTxs(position._id, 'equity')
      return {
        ...position,
        holderName:
          holderOrg?.name ??
          position.holderLabel ??
          position.holderPersonId ??
          null,
        transactions: allocated.map(pickAllocatedTx),
      }
    }),
  )

  // 2. C/C où l'org est créancière ou débitrice (dédupliqués par _id).
  const asCreditor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
    .collect()
  const asDebtor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_to', (q) => q.eq('toOrgId', orgId))
    .collect()
  const loansById = new Map<Id<'intercompanyLoans'>, Doc<'intercompanyLoans'>>()
  for (const loan of [...asCreditor, ...asDebtor]) {
    loansById.set(loan._id, loan)
  }

  // 3. Solde dérivé par prêt, depuis les transactions de CETTE org, enrichi
  //    du nom de la contrepartie (l'autre org du prêt) et des tx pointées.
  const loans = await Promise.all(
    [...loansById.values()].map(async (loan) => {
      const allocated = await allocatedTxs(loan._id, 'intercompany_loan')
      const side = loanSideForOrg(loan, orgId)
      const counterpartyOrg = await ctx.db.get(
        'organizations',
        loan.fromOrgId === orgId ? loan.toOrgId : loan.fromOrgId,
      )
      return {
        ...loan,
        // `side` est non-null par construction (le prêt vient des index
        // by_from / by_to de cette org) ; fallback créancier par sûreté.
        side: side ?? 'creditor',
        balanceCents: computeLoanBalanceCents(allocated),
        counterpartyName:
          counterpartyOrg?.name ?? loan.fromLabel ?? loan.fromPersonId ?? null,
        transactions: allocated.map(pickAllocatedTx),
      }
    }),
  )

  return { equityPositions, loans }
}

/**
 * Passif d'une org : positions de capital émises + comptes courants
 * inter-entités, avec soldes dérivés des transactions pointées.
 */
export const getLiabilities = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return await getLiabilitiesForOrg(ctx, orgId)
  },
})

// ─── Pointage transaction → passif (equity / C/C) ───────────────────────────
//
// Pendant du pointage transaction → deal (convex/transactions.ts). Une tx
// allouée au passif passe en `matchStatus: 'matched'` SANS `dealId` — c'est ce
// qui la distingue d'une tx matchée-deal — et sort donc de la file de pointage.
// N'écrit JAMAIS dans `matchingDecisions` (dataset réservé au pointage deal),
// ne touche jamais `reconciled` (miroir dérivé du pointage deal uniquement).

/**
 * Pointe une transaction sur une position de capital (`equity`) ou un compte
 * courant inter-entités (`intercompany_loan`). La cible doit appartenir à la
 * même org que la transaction (pour un C/C : l'org de la tx doit être l'une
 * des deux parties du prêt).
 */
export const allocateTransaction = mutation({
  args: {
    transactionId: v.id('transactions'),
    kind: v.union(v.literal('equity'), v.literal('intercompany_loan')),
    targetId: v.string(),
  },
  handler: async (ctx, { transactionId, kind, targetId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)

    // Cœur partagé avec les outils agent : convex/lib/pointage.ts.
    await applyAllocateToLiability(ctx, tx, kind, targetId)
    return null
  },
})

/**
 * Détache une transaction du passif : retour à l'état non pointé
 * (`unmatched`). Idempotent — sans allocation passif, ne touche à rien.
 * Une tx rattachée à un deal n'est pas concernée : passer par
 * `transactions:unmatchTransaction`.
 */
export const deallocateTransaction = mutation({
  args: { transactionId: v.id('transactions') },
  handler: async (ctx, { transactionId }) => {
    const tx = await ctx.db.get('transactions', transactionId)
    if (!tx) throw new ConvexError('not_found')
    await requireOrgMember(ctx, tx.orgId)

    // Cœur partagé avec les outils agent : convex/lib/pointage.ts.
    await applyDeallocate(ctx, tx)
    return null
  },
})

// ─── Création manuelle (equity / C/C) ────────────────────────────────────────
//
// Création seule (édition / suppression = follow-up). Les lignes créées
// deviennent immédiatement des cibles pointables (combobox de l'onglet
// Pointage, via getLiabilities réactif).

/**
 * Crée une position de capitaux propres émise par l'org. Le détenteur est
 * SOIT une org du groupe (`holderOrgId`), SOIT un libellé libre
 * (`holderLabel`), soit aucun des deux (capital sans détenteur nommé).
 * `holderPersonId` n'est pas exposé (pas de table persons).
 */
export const createEquityPosition = mutation({
  args: {
    orgId: v.id('organizations'), // entité émettrice
    holderOrgId: v.optional(v.id('organizations')),
    holderLabel: v.optional(v.string()),
    type: equityPositionType,
    amountCents: v.number(),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId)

    if (args.amountCents <= 0) throw new ConvexError('invalid_amount')
    // Une seule source de détenteur (les deux vides = autorisé).
    if (args.holderOrgId && args.holderLabel) {
      throw new ConvexError('ambiguous_holder')
    }
    if (args.holderOrgId) {
      const holderOrg = await ctx.db.get('organizations', args.holderOrgId)
      if (!holderOrg) throw new ConvexError('not_found')
    }

    return await ctx.db.insert('equityPositions', {
      orgId: args.orgId,
      holderOrgId: args.holderOrgId,
      holderLabel: args.holderLabel?.trim() || undefined,
      type: args.type,
      amountCents: args.amountCents,
      shares: args.shares,
      effectiveDate: args.effectiveDate,
    })
  },
})

/**
 * Crée un compte courant inter-entités créancier → débiteur. L'utilisateur
 * doit être membre d'au moins une des deux orgs (pas de C/C entre orgs
 * tierces). `interestRateBps` absent = 0 = non rémunéré.
 */
export const createIntercompanyLoan = mutation({
  args: {
    fromOrgId: v.id('organizations'), // créancier
    toOrgId: v.id('organizations'), // débiteur
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.fromOrgId === args.toOrgId) throw new ConvexError('same_org')

    // Membre d'au moins une des deux parties.
    const user = await requireAppUser(ctx)
    const memberships = await Promise.all(
      [args.fromOrgId, args.toOrgId].map((orgId) =>
        ctx.db
          .query('organizationMembers')
          .withIndex('by_org_and_user', (q) =>
            q.eq('orgId', orgId).eq('userId', user._id),
          )
          .unique(),
      ),
    )
    if (!memberships.some((member) => member !== null)) {
      throw new ConvexError('not_a_party')
    }

    const [fromOrg, toOrg] = await Promise.all([
      ctx.db.get('organizations', args.fromOrgId),
      ctx.db.get('organizations', args.toOrgId),
    ])
    if (!fromOrg || !toOrg) throw new ConvexError('not_found')

    if (args.interestRateBps != null && args.interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }

    return await ctx.db.insert('intercompanyLoans', {
      fromOrgId: args.fromOrgId,
      toOrgId: args.toOrgId,
      interestRateBps: args.interestRateBps,
      isBlocked: args.isBlocked,
      openedDate: args.openedDate,
    })
  },
})

// ─── Édition / suppression (equity / C/C) ────────────────────────────────────
//
// La suppression est refusée tant que des transactions sont pointées sur la
// cible (`has_allocations`) : détacher d'abord, supprimer ensuite. Jamais de
// détachement implicite — le pointage est une décision utilisateur.

/**
 * Vrai si au moins une transaction d'une des orgs passées est pointée sur la
 * cible (equity ou C/C). Lecture bornée : `.first()` par org sur l'index
 * `by_org_allocation_target`.
 */
async function hasAllocations(
  ctx: QueryCtx,
  orgIds: Array<Id<'organizations'>>,
  targetId: string,
) {
  for (const orgId of orgIds) {
    const tx = await ctx.db
      .query('transactions')
      .withIndex('by_org_allocation_target', (q) =>
        q.eq('orgId', orgId).eq('allocation.targetId', targetId),
      )
      .first()
    if (tx) return true
  }
  return false
}

/**
 * Vérifie que l'utilisateur est membre d'au moins une des deux parties d'un
 * C/C (même règle que createIntercompanyLoan).
 */
async function requireLoanParty(ctx: QueryCtx, loan: Doc<'intercompanyLoans'>) {
  const user = await requireAppUser(ctx)
  const memberships = await Promise.all(
    [loan.fromOrgId, loan.toOrgId].map((orgId) =>
      ctx.db
        .query('organizationMembers')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', user._id),
        )
        .unique(),
    ),
  )
  if (!memberships.some((member) => member !== null)) {
    throw new ConvexError('not_a_party')
  }
}

/**
 * Met à jour une position de capital (remplacement complet des champs
 * éditables — le dialog est pré-rempli avec les valeurs courantes).
 * Mêmes règles de validation que createEquityPosition.
 */
export const updateEquityPosition = mutation({
  args: {
    positionId: v.id('equityPositions'),
    holderOrgId: v.optional(v.id('organizations')),
    holderLabel: v.optional(v.string()),
    type: equityPositionType,
    amountCents: v.number(),
    shares: v.optional(v.number()),
    effectiveDate: v.number(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db.get('equityPositions', args.positionId)
    if (!position) throw new ConvexError('not_found')
    await requireOrgMember(ctx, position.orgId)

    if (args.amountCents <= 0) throw new ConvexError('invalid_amount')
    if (args.holderOrgId && args.holderLabel) {
      throw new ConvexError('ambiguous_holder')
    }
    if (args.holderOrgId) {
      const holderOrg = await ctx.db.get('organizations', args.holderOrgId)
      if (!holderOrg) throw new ConvexError('not_found')
    }

    // `undefined` retire le champ (patch Convex) — un détenteur effacé
    // redevient « aucun ».
    await ctx.db.patch('equityPositions', position._id, {
      holderOrgId: args.holderOrgId,
      holderLabel: args.holderLabel?.trim() || undefined,
      type: args.type,
      amountCents: args.amountCents,
      shares: args.shares,
      effectiveDate: args.effectiveDate,
    })
    return null
  },
})

/**
 * Supprime une position de capital. Refusé (`has_allocations`) si des
 * transactions sont encore pointées dessus.
 */
export const deleteEquityPosition = mutation({
  args: { positionId: v.id('equityPositions') },
  handler: async (ctx, { positionId }) => {
    const position = await ctx.db.get('equityPositions', positionId)
    if (!position) throw new ConvexError('not_found')
    await requireOrgMember(ctx, position.orgId)

    if (await hasAllocations(ctx, [position.orgId], position._id)) {
      throw new ConvexError('has_allocations')
    }
    await ctx.db.delete('equityPositions', positionId)
    return null
  },
})

/**
 * Met à jour un C/C (taux, blocage, date d'ouverture). Les parties
 * créancier/débiteur ne sont PAS éditables : changer de contrepartie =
 * supprimer puis recréer (le solde dérivé dépend de l'identité du prêt).
 */
export const updateIntercompanyLoan = mutation({
  args: {
    loanId: v.id('intercompanyLoans'),
    interestRateBps: v.optional(v.number()),
    isBlocked: v.boolean(),
    openedDate: v.number(),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('intercompanyLoans', args.loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireLoanParty(ctx, loan)

    if (args.interestRateBps != null && args.interestRateBps < 0) {
      throw new ConvexError('invalid_rate')
    }
    await ctx.db.patch('intercompanyLoans', loan._id, {
      interestRateBps: args.interestRateBps,
      isBlocked: args.isBlocked,
      openedDate: args.openedDate,
    })
    return null
  },
})

/**
 * Supprime un C/C. Refusé (`has_allocations`) si des transactions d'UNE DES
 * DEUX orgs sont encore pointées dessus (le solde de chaque partie dérive de
 * ses propres transactions).
 */
export const deleteIntercompanyLoan = mutation({
  args: { loanId: v.id('intercompanyLoans') },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get('intercompanyLoans', loanId)
    if (!loan) throw new ConvexError('not_found')
    await requireLoanParty(ctx, loan)

    if (await hasAllocations(ctx, [loan.fromOrgId, loan.toOrgId], loan._id)) {
      throw new ConvexError('has_allocations')
    }
    await ctx.db.delete('intercompanyLoans', loanId)
    return null
  },
})

// ─── Scénario de vérification manuelle (dev) ────────────────────────────────
//
// Cf. TESTING.md « Passif ». Données marquées TEST_MARKER pour pouvoir les
// purger via cleanupTestScenario. Jamais appelé par le code applicatif.

const TEST_MARKER = '[TEST liabilities]'

/**
 * Seed du scénario de vérification : 1 equityPosition émise par fromOrg,
 * 1 C/C fromOrg → toOrg, et 2 transactions pointées dessus (une jambe par
 * org : `out` chez le créancier, `in` chez le débiteur, 100 000 € chacune).
 *
 * Attendu ensuite via getLiabilities :
 *   fromOrg (créancier) → side 'creditor', balanceCents +10_000_000
 *   toOrg (débiteur)    → side 'debtor',   balanceCents −10_000_000
 *
 *   pnpm exec convex run liabilities:seedTestScenario \
 *     '{"fromOrgId": "…", "toOrgId": "…"}'
 */
export const seedTestScenario = internalMutation({
  args: {
    fromOrgId: v.id('organizations'),
    toOrgId: v.id('organizations'),
  },
  handler: async (ctx, { fromOrgId, toOrgId }) => {
    if (fromOrgId === toOrgId) throw new ConvexError('same_org')
    const now = Date.now()
    const amountCents = 10_000_000 // 100 000 €

    // Un compte bancaire par org (créé si absent, marqué TEST pour cleanup).
    const accountFor = async (orgId: Id<'organizations'>) => {
      const existing = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .first()
      if (existing) return existing._id

      const root = await ctx.db
        .query('companies')
        .withIndex('by_org_kind', (q) =>
          q.eq('orgId', orgId).eq('kind', 'group_root'),
        )
        .first()
      if (!root) throw new ConvexError('no_group_root_company')
      return await ctx.db.insert('bankAccounts', {
        orgId,
        ownerCompanyId: root._id,
        bankName: 'Test',
        label: TEST_MARKER,
        currency: 'EUR',
      })
    }
    const fromAccountId = await accountFor(fromOrgId)
    const toAccountId = await accountFor(toOrgId)

    // 1 position de capital émise par le créancier (détenteur libre TEST).
    const equityPositionId = await ctx.db.insert('equityPositions', {
      orgId: fromOrgId,
      holderLabel: TEST_MARKER,
      type: 'capital_social',
      amountCents: 1_000_000, // 10 000 €
      effectiveDate: now,
    })

    // 1 C/C créancier → débiteur.
    const loanId = await ctx.db.insert('intercompanyLoans', {
      fromOrgId,
      toOrgId,
      fromLabel: TEST_MARKER,
      isBlocked: false,
      openedDate: now,
    })

    // 2 transactions pointées sur le prêt : une jambe par org.
    const insertLeg = async (
      orgId: Id<'organizations'>,
      bankAccountId: Id<'bankAccounts'>,
      direction: 'in' | 'out',
    ) =>
      await ctx.db.insert('transactions', {
        orgId,
        bankAccountId,
        direction,
        amount: amountCents,
        transactionDate: now,
        rawLabel: `${TEST_MARKER} avance C/C`,
        searchText: buildSearchText(`${TEST_MARKER} avance C/C`, undefined),
        source: 'manual',
        // Une tx allouée au passif est `matched` sans dealId (même état que
        // produirait allocateTransaction).
        matchStatus: 'matched',
        allocation: { kind: 'intercompany_loan', targetId: loanId },
        reconciled: false,
      })
    const fromTxId = await insertLeg(fromOrgId, fromAccountId, 'out')
    const toTxId = await insertLeg(toOrgId, toAccountId, 'in')

    return { equityPositionId, loanId, fromTxId, toTxId }
  },
})

/**
 * Purge des données créées par seedTestScenario (idempotent : ne supprime
 * que les lignes marquées TEST_MARKER des deux orgs passées en args).
 *
 *   pnpm exec convex run liabilities:cleanupTestScenario \
 *     '{"fromOrgId": "…", "toOrgId": "…"}'
 */
export const cleanupTestScenario = internalMutation({
  args: {
    fromOrgId: v.id('organizations'),
    toOrgId: v.id('organizations'),
  },
  handler: async (ctx, { fromOrgId, toOrgId }) => {
    let deleted = 0

    for (const orgId of [fromOrgId, toOrgId]) {
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
        .collect()
      for (const tx of txs) {
        if (!tx.rawLabel.startsWith(TEST_MARKER)) continue
        await ctx.db.delete('transactions', tx._id)
        deleted += 1
      }

      const positions = await ctx.db
        .query('equityPositions')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      for (const position of positions) {
        if (position.holderLabel !== TEST_MARKER) continue
        await ctx.db.delete('equityPositions', position._id)
        deleted += 1
      }

      const loans = await ctx.db
        .query('intercompanyLoans')
        .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
        .collect()
      for (const loan of loans) {
        if (loan.fromLabel !== TEST_MARKER) continue
        await ctx.db.delete('intercompanyLoans', loan._id)
        deleted += 1
      }

      const accounts = await ctx.db
        .query('bankAccounts')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect()
      for (const account of accounts) {
        if (account.label !== TEST_MARKER) continue
        await ctx.db.delete('bankAccounts', account._id)
        deleted += 1
      }
    }

    return { deleted }
  },
})
