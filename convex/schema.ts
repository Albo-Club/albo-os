/**
 * Albo OS — Convex schema
 *
 * Scope: post-investment tracking. Attio reste source de vérité avant invest
 * (dealflow, term sheet, sourcing). Albo OS prend la main une fois le deal
 * signé (suivi participation, mouvements, valos, KPIs).
 *
 * Conventions (voir CLAUDE.md § Domaine métier) :
 * - Multi-tenant : chaque table métier porte `orgId` (organization Better
 *   Auth). Ne pas confondre `orgId` (compte SaaS = "Calte Family Office")
 *   avec `companies.kind = "group_*"` (entités juridiques du groupe Calte).
 * - Montants : entiers en cents (EUR par défaut). Éviter les float.
 * - Taux : basis points (bps). 1100 = 11 %. 10000 = 100 %.
 * - Dates : ms epoch (Convex est number, pas Date).
 * - Bridges Attio : `attioDealId` / `attioCompanyId` (strings, uniqueness
 *   gérée côté mutation, pas au schéma).
 */

import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// ─── Better Auth / multi-tenant validators ─────────────────────────────────

export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
)

export const invitationRoleValidator = v.union(
  v.literal('admin'),
  v.literal('member'),
)

// ─── Enums métier ───────────────────────────────────────────────────────────

// Note: le « scope » Albo / Calte est désormais porté par l'ORGANISATION
// elle-même (une org par véhicule d'invest), plus par un champ. La vue
// agrégée (convex/aggregate.ts) fait l'union des orgs de l'utilisateur.

const companyKind = v.union(
  // Racine de l'org (la holding d'invest : CALTE dans l'org Calte,
  // Albo Club dans l'org Albo)
  v.literal('group_root'),
  // Sous-entités du groupe (héritent le scope de leur racine)
  v.literal('group_operating'), // Caltimo, Relais Chapelle, RDB
  v.literal('group_sci'), // SCI Chapelle 1, 2, SCI Upload
  v.literal('group_spv'), // SPV Eben Home, SPV Hectarea…
  v.literal('group_manco'), // Banco 2
  // Externe
  v.literal('portfolio'), // boîtes investies, fonds LP, SCPI, mancos externes
)

const instrumentKind = v.union(
  v.literal('share'),
  v.literal('bsa'),
  v.literal('bsa_air'),
  v.literal('safe'),
  v.literal('oc'), // obligation convertible
  v.literal('os'), // obligation simple
  v.literal('convertible_note'),
  v.literal('cca'), // compte courant associé
  v.literal('royalty'),
  v.literal('fund_lp'), // commitment LP dans un fond
  v.literal('spv_share'), // titres d'un SPV
  v.literal('secondary'),
  v.literal('real_estate_direct'),
  v.literal('scpi'),
  v.literal('cto'),
  v.literal('dat'), // dépôt à terme
  v.literal('crypto'),
)

const dealStatus = v.union(
  v.literal('active'),
  v.literal('partially_exited'),
  v.literal('fully_exited'),
  v.literal('written_off'),
)

const txDirection = v.union(v.literal('in'), v.literal('out'))

const txSource = v.union(
  v.literal('powens'),
  v.literal('manual'),
  v.literal('imported'),
)

const forecastConfidence = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
)

// ─── Schema ───────────────────────────────────────────────────────────────

export default defineSchema({
  // ─── Better Auth / multi-tenant (natif Convex, plugin organization() off) ─

  users: defineTable({
    betterAuthId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    avatarStorageId: v.optional(v.id('_storage')),
    superAdmin: v.boolean(),
    lastOrgSlug: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(v.literal('en'), v.literal('fr'))),
    createdAt: v.number(),
  })
    .index('by_betterAuthId', ['betterAuthId'])
    .index('by_email', ['email']),

  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id('_storage')),
    createdBy: v.id('users'),
    createdAt: v.number(),
  }).index('by_slug', ['slug']),

  organizationMembers: defineTable({
    orgId: v.id('organizations'),
    userId: v.id('users'),
    role: roleValidator,
    joinedAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_user', ['userId'])
    .index('by_org_and_user', ['orgId', 'userId']),

  invitations: defineTable({
    orgId: v.id('organizations'),
    email: v.string(),
    role: invitationRoleValidator,
    token: v.string(),
    invitedBy: v.id('users'),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_org', ['orgId'])
    .index('by_email_and_org', ['email', 'orgId']),

  // ─── Cœur portfolio ──────────────────────────────────────────────────────

  /**
   * companies — entités juridiques. Mélange volontaire groupe + portfolio,
   * différenciés par `kind`. Une "company" peut aussi représenter un fond,
   * un SPV, une ManCo, une SCPI.
   *
   * `totalShares` est facultatif. S'il est rempli, on peut déduire le %
   * de détention d'un deal share-type via `deal.sharesAcquired / totalShares`.
   */
  companies: defineTable({
    orgId: v.id('organizations'),

    // Identité
    name: v.string(),
    legalName: v.optional(v.string()),
    kind: companyKind,

    // Identifiants — tous optionnels. Uniqueness gérée côté mutation.
    siren: v.optional(v.string()), // FR uniquement
    registrationNumber: v.optional(v.string()), // fallback étranger
    countryCode: v.optional(v.string()), // ISO-3166-1 alpha-2
    domain: v.optional(v.string()),

    // Bridge Attio
    attioCompanyId: v.optional(v.string()),

    // Contexte capital (pour calcul % de détention)
    totalShares: v.optional(v.number()),

    // Group-specific
    legalForm: v.optional(v.string()), // SAS, SASU, SCI, SARL, SCPI…
    incorporationDate: v.optional(v.number()),

    // Meta
    sector: v.optional(v.string()),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_kind', ['orgId', 'kind'])
    .index('by_org_siren', ['orgId', 'siren'])
    .index('by_attio_company_id', ['attioCompanyId'])
    .index('by_org_domain', ['orgId', 'domain']),

  /**
   * companyRelations — détention entre entités. Gère les cas non-binaires
   * (SCI 50/50, Banco 2 50/50…) et la part d'Albo dans un SPV.
   * Recommandation : matérialiser systématiquement, même les 100 % directs.
   */
  companyRelations: defineTable({
    orgId: v.id('organizations'),
    parentCompanyId: v.id('companies'),
    childCompanyId: v.id('companies'),
    ownershipPct: v.optional(v.number()), // 0 à 100
    sharesHeld: v.optional(v.number()),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_parent', ['orgId', 'parentCompanyId'])
    .index('by_child', ['orgId', 'childCompanyId']),

  /**
   * deals — un investissement = un instrument souscrit à un moment donné.
   * Follow-on = nouveau deal. Pattern instrument : champs spécifiques
   * nullables, discriminés par `instrumentKind`.
   *
   * `viaSpvCompanyId` : invest via SPV (1 ligne, le SPV en intermédiaire
   * dénormalisé). La part d'Albo DANS le SPV vit dans `companyRelations`.
   */
  deals: defineTable({
    orgId: v.id('organizations'),

    // Qui achète quoi
    investorCompanyId: v.id('companies'), // entité du groupe (CALTE, Albo…)
    targetCompanyId: v.id('companies'), // boîte investie
    viaSpvCompanyId: v.optional(v.id('companies')), // intermédiaire optionnel

    // Instrument
    instrumentKind,

    // Financier commun
    currency: v.string(), // "EUR" par défaut
    committedAmount: v.optional(v.number()), // engagement (LP/SAFE/OS…)
    paidAmount: v.optional(v.number()), // réellement décaissé à ce jour

    // Share-based (share, spv_share, secondary, parts SCI…)
    sharesAcquired: v.optional(v.number()),
    pricePerShare: v.optional(v.number()), // cents

    // Dette (os, oc, convertible_note)
    interestRate: v.optional(v.number()), // bps (1100 = 11 %)
    maturityDate: v.optional(v.number()),
    principalAmount: v.optional(v.number()), // cents
    repaymentFrequencyMonths: v.optional(v.number()), // 6, 12, etc.

    // Royalties
    royaltyRate: v.optional(v.number()), // bps
    royaltyCapAmount: v.optional(v.number()), // cents

    // SAFE / BSA Air
    valuationCap: v.optional(v.number()), // cents
    discount: v.optional(v.number()), // bps

    // Valorisation au moment du deal (pour share / BSA)
    entryValuation: v.optional(v.number()), // cents
    roundSize: v.optional(v.number()), // cents

    // Lifecycle
    signedDate: v.optional(v.number()),
    closingDate: v.optional(v.number()),
    exitedDate: v.optional(v.number()),
    exitProceeds: v.optional(v.number()), // cents — produit de cession (exit)
    status: dealStatus,

    // Bridge Attio
    attioDealId: v.optional(v.string()),

    // Meta
    notes: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_investor', ['orgId', 'investorCompanyId'])
    .index('by_org_target', ['orgId', 'targetCompanyId'])
    .index('by_org_status', ['orgId', 'status'])
    .index('by_attio_deal_id', ['attioDealId']),

  /**
   * valuations — historique horodaté de la valo d'un deal. Distinct de
   * kpiSnapshots pour garder une table propre côté calculs MOIC/TVPI.
   */
  valuations: defineTable({
    orgId: v.id('organizations'),
    dealId: v.id('deals'),
    asOf: v.number(),
    fairValue: v.number(), // cents
    valuationMethod: v.optional(v.string()), // "last_round", "mark_to_market"…
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index('by_deal_asof', ['dealId', 'asOf'])
    .index('by_org_asof', ['orgId', 'asOf']),

  /**
   * kpiSnapshots — historique KPI portfolio (ARR, GMV, AUM, headcount…).
   * Une ligne = une valeur de métrique à une date pour une company.
   */
  kpiSnapshots: defineTable({
    orgId: v.id('organizations'),
    companyId: v.id('companies'),
    metricType: v.string(), // "arr", "gmv", "aum", "headcount", "mrr"…
    periodStart: v.number(),
    periodEnd: v.number(),
    value: v.number(),
    unit: v.optional(v.string()), // "EUR_cents", "users", "FTE", "bps"
    source: v.optional(v.string()), // "investor_update_jan26", "founder_call"…
    capturedAt: v.number(),
    capturedBy: v.optional(v.id('users')),
  })
    .index('by_company_metric', ['companyId', 'metricType'])
    .index('by_org_period', ['orgId', 'periodEnd']),

  // ─── Phase 2 — cash management (tables déclarées, mutations vides) ────────

  /**
   * bankAccounts — comptes des entités du groupe. Powens en cible,
   * manuel en attendant.
   */
  bankAccounts: defineTable({
    orgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'), // doit être une "group_*"
    bankName: v.string(), // "Qonto", "Palatine", "Neuflize", "Wormser"
    label: v.string(),
    iban: v.optional(v.string()),
    accountKind: v.optional(v.string()), // "checking", "cto", "dat", "savings"
    currency: v.string(),
    currentBalance: v.optional(v.number()), // cents, dernier connu
    balanceAsOf: v.optional(v.number()),
    powensConnectionId: v.optional(v.string()),
    powensAccountId: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_owner', ['orgId', 'ownerCompanyId'])
    .index('by_powens_account', ['powensAccountId']),

  /**
   * transactions — flux bancaire réalisé. `dealId` nullable car certains
   * mouvements sont opérationnels (impôts, honoraires, charges courantes).
   * Le rapprochement se fait en remplissant `dealId` + `reconciled`.
   */
  transactions: defineTable({
    orgId: v.id('organizations'),
    bankAccountId: v.id('bankAccounts'),
    dealId: v.optional(v.id('deals')),
    direction: txDirection,
    amount: v.number(), // cents, toujours positif
    transactionDate: v.number(),
    rawLabel: v.string(),
    counterparty: v.optional(v.string()),
    source: txSource,
    powensTxId: v.optional(v.string()),
    reconciled: v.boolean(),
    reconciledBy: v.optional(v.id('users')),
    reconciledAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index('by_org_date', ['orgId', 'transactionDate'])
    .index('by_account_date', ['bankAccountId', 'transactionDate'])
    .index('by_deal', ['dealId'])
    .index('by_powens_id', ['powensTxId'])
    .index('by_org_unreconciled', ['orgId', 'reconciled']),

  /**
   * forecasts — flux attendus (appels de fonds, distributions, échéances
   * dette, charges récurrentes). `realizedTransactionId` rempli quand un
   * mouvement réel l'éteint.
   */
  forecasts: defineTable({
    orgId: v.id('organizations'),
    bankAccountId: v.optional(v.id('bankAccounts')),
    dealId: v.optional(v.id('deals')),
    direction: txDirection,
    expectedAmount: v.number(), // cents
    expectedDate: v.number(),
    confidence: v.optional(forecastConfidence),
    label: v.string(),
    source: v.optional(v.string()),
    realizedTransactionId: v.optional(v.id('transactions')),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org_date', ['orgId', 'expectedDate'])
    .index('by_deal', ['dealId'])
    .index('by_account_date', ['bankAccountId', 'expectedDate']),
})
