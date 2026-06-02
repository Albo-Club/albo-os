import { ConvexError, v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { requireOrgMember } from './lib/auth'
import {
  computeLoanBalanceCents,
  loanSideForOrg,
} from './lib/liabilities'
import { buildSearchText } from './lib/searchText'

import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

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
  // 1. Capitaux propres émis par l'org.
  const equityPositions = await ctx.db
    .query('equityPositions')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()

  // 2. C/C où l'org est créancière ou débitrice (dédupliqués par _id).
  const asCreditor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_from', (q) => q.eq('fromOrgId', orgId))
    .collect()
  const asDebtor = await ctx.db
    .query('intercompanyLoans')
    .withIndex('by_to', (q) => q.eq('toOrgId', orgId))
    .collect()
  const loansById = new Map<
    Id<'intercompanyLoans'>,
    Doc<'intercompanyLoans'>
  >()
  for (const loan of [...asCreditor, ...asDebtor]) {
    loansById.set(loan._id, loan)
  }

  // 3. Solde dérivé par prêt, depuis les transactions de CETTE org.
  const loans = await Promise.all(
    [...loansById.values()].map(async (loan) => {
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_org_allocation_target', (q) =>
          q.eq('orgId', orgId).eq('allocation.targetId', loan._id),
        )
        .collect()
      const allocated = txs.filter(
        (tx) => tx.allocation?.kind === 'intercompany_loan',
      )
      const side = loanSideForOrg(loan, orgId)
      return {
        ...loan,
        // `side` est non-null par construction (le prêt vient des index
        // by_from / by_to de cette org) ; fallback créancier par sûreté.
        side: side ?? 'creditor',
        balanceCents: computeLoanBalanceCents(allocated),
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
        matchStatus: 'unmatched',
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
