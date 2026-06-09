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
import { instrumentValidator } from './lib/instruments'

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

// Source unique : convex/lib/instruments.ts
const instrumentKind = instrumentValidator

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
  v.literal('memo_csv'), // import one-shot historique CSV Mémo Bank
)

// Pointage transaction → deal. `matchStatus` est la source de vérité de
// l'intention ; `reconciled` reste un miroir dérivé (cf. KNOWN_ISSUES.md).
const txMatchStatus = v.union(
  v.literal('unmatched'), // à traiter (défaut logique)
  // Rattachée à un deal (`dealId` obligatoire) OU allouée au passif
  // (equity / C/C : `allocation` posée, `dealId` null).
  v.literal('matched'),
  v.literal('ignored'), // décision explicite « ne concerne aucun deal »
  v.literal('charge'), // écartée : charge courante (sous-type d'« écarté »)
  v.literal('tax'), // écartée : impôt (sous-type d'« écarté »)
  v.literal('product'), // écartée : produit hors deal (sous-type d'« écarté »)
  v.literal('internal_transfer'), // écartée : virement entre comptes (sous-type d'« écarté »)
)

// Action posée dans la decision log (`unmatched` = dé-pointage, loggé aussi).
const matchDecision = v.union(
  v.literal('matched'),
  v.literal('ignored'),
  v.literal('unmatched'),
  v.literal('charge'),
  v.literal('tax'),
  v.literal('product'),
  v.literal('internal_transfer'),
)

// 'manual' = mutations publiques (UI) ; 'agent_suggested' = écritures des
// outils agent (convex/agentToolsPointage.ts) après confirmation utilisateur.
const matchDecisionSource = v.union(
  v.literal('manual'),
  v.literal('agent_suggested'),
)

// ─── Enums passif (equityPositions / intercompanyLoans / allocation) ────────

// Nature d'une position de capitaux propres. Exporté pour la mutation
// publique de création (convex/liabilities.ts:createEquityPosition).
export const equityPositionType = v.union(
  v.literal('capital_social'),
  v.literal('prime_emission'),
  v.literal('augmentation_capital'),
  v.literal('report_a_nouveau'),
)

// Cible d'un pointage généralisé (`transactions.allocation`). Cohabite avec
// `dealId` : un pointage deal écrit les deux (cf. convex/transactions.ts).
const allocationKind = v.union(
  v.literal('deal'),
  v.literal('equity'),
  v.literal('intercompany_loan'),
)

const forecastConfidence = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
)

// ─── Enums cash flow forecast (forecastRules / forecastEntries) ─────────────

// Confiance d'un flux prévisionnel. `confirmed` = engagé/contractuel,
// `expected` = attendu (récurrence connue), `probable` = hypothèse.
const forecastEntryConfidence = v.union(
  v.literal('confirmed'),
  v.literal('expected'),
  v.literal('probable'),
)

const forecastFrequency = v.union(
  v.literal('weekly'),
  v.literal('monthly'),
  v.literal('quarterly'),
  v.literal('yearly'),
)

// Cycle de vie d'une occurrence prévisionnelle. `realized` une fois pointée
// sur une transaction réelle, `cancelled` si elle n'aura jamais lieu.
const forecastEntryStatus = v.union(
  v.literal('pending'),
  v.literal('realized'),
  v.literal('cancelled'),
)

// MVP : toujours 'manual'. 'derived' réservé aux générateurs futurs
// (deriveFromDeals, deriveFromPipeline Attio).
const forecastSourceType = v.union(v.literal('manual'), v.literal('derived'))

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

  /**
   * powensUsers — user Powens permanent par org (émission de connexions
   * bancaires). INTERNE : `authToken` est un secret au repos, jamais exposé au
   * front. Lu/écrit uniquement par des internalQuery/internalMutation
   * (cf. convex/powens.ts). Ne PAS ajouter sur `organizations` (api.bySlug
   * fait `return {...org}` → fuiterait le token).
   */
  powensUsers: defineTable({
    orgId: v.id('organizations'),
    powensUserId: v.string(), // id_user renvoyé par POST /auth/init
    authToken: v.string(), // token permanent — secret
    createdAt: v.number(),
  })
    .index('by_org', ['orgId'])
    // Filtre des webhooks entrants : seul un id_user connu est ingéré.
    .index('by_powens_user_id', ['powensUserId']),

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

    // Ancre import Airtable (one-shot, idempotence/résolution de liens)
    airtableId: v.optional(v.string()),

    // Contexte capital (pour calcul % de détention)
    totalShares: v.optional(v.number()),

    // Group-specific
    legalForm: v.optional(v.string()), // SAS, SASU, SCI, SARL, SCPI…
    incorporationDate: v.optional(v.number()),

    // Meta
    sector: v.optional(v.string()),
    // Plateforme d'origine pour les SPV externes (ex. "Parallel", "Sezame")
    sponsor: v.optional(v.string()),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_kind', ['orgId', 'kind'])
    .index('by_org_siren', ['orgId', 'siren'])
    .index('by_attio_company_id', ['attioCompanyId'])
    .index('by_org_domain', ['orgId', 'domain'])
    .index('by_airtable_id', ['airtableId']),

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

    // Nom personnalisé (optionnel) — affiché à la place du titre dérivé
    // (instrument / société cible) quand il est présent.
    name: v.optional(v.string()),

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

    // Ancre import Airtable (clé dérivée `${companyRecId}:${instrumentKind}`)
    airtableId: v.optional(v.string()),

    // Meta
    notes: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_investor', ['orgId', 'investorCompanyId'])
    .index('by_org_target', ['orgId', 'targetCompanyId'])
    .index('by_org_status', ['orgId', 'status'])
    .index('by_attio_deal_id', ['attioDealId'])
    .index('by_airtable_id', ['airtableId']),

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
    airtableId: v.optional(v.string()), // ancre import Airtable
  })
    .index('by_deal_asof', ['dealId', 'asOf'])
    .index('by_org_asof', ['orgId', 'asOf'])
    .index('by_airtable_id', ['airtableId']),

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

  // ─── Passif (capitaux propres + comptes courants d'associés) ──────────────

  /**
   * equityPositions — capitaux propres émis par une org (quasi-statique).
   * `orgId` = entité émettrice. Le détenteur est SOIT une org du groupe
   * (`holderOrgId`), SOIT une personne physique (`holderPersonId`), SOIT un
   * externe en libellé libre (`holderLabel`).
   */
  equityPositions: defineTable({
    orgId: v.id('organizations'), // entité émettrice
    holderOrgId: v.optional(v.id('organizations')), // détenteur si entité du groupe
    holderPersonId: v.optional(v.string()), // si personne physique
    holderLabel: v.optional(v.string()), // libellé libre si externe
    type: equityPositionType,
    amountCents: v.number(), // cents EUR
    shares: v.optional(v.number()),
    effectiveDate: v.number(), // ms epoch
    actDriveId: v.optional(v.string()),
    airtableId: v.optional(v.string()), // ancre import Airtable (idempotence)
  })
    .index('by_org', ['orgId'])
    .index('by_holder_org', ['holderOrgId'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * intercompanyLoans — comptes courants d'associés inter-entités.
   * UN enregistrement partagé par relation créancier → débiteur.
   *
   * PAS de champ solde : le solde est toujours dérivé des transactions
   * pointées dessus (`transactions.allocation.kind === 'intercompany_loan'`),
   * chaque org sommant SES propres transactions (cf. convex/liabilities.ts
   * `getLiabilities` + KNOWN_ISSUES.md « Passif »).
   */
  intercompanyLoans: defineTable({
    fromOrgId: v.id('organizations'), // créancier
    toOrgId: v.id('organizations'), // débiteur
    fromPersonId: v.optional(v.string()), // si contrepartie personne physique
    fromLabel: v.optional(v.string()),
    interestRateBps: v.optional(v.number()), // bps ; absent = 0 = non rémunéré
    isBlocked: v.boolean(),
    conventionDriveId: v.optional(v.string()),
    openedDate: v.number(), // ms epoch
    airtableId: v.optional(v.string()), // ancre import Airtable (idempotence)
  })
    .index('by_from', ['fromOrgId'])
    .index('by_to', ['toOrgId'])
    .index('by_airtable_id', ['airtableId']),

  // ─── Phase 2 — cash management (tables déclarées, mutations vides) ────────

  /**
   * bankAccounts — comptes des entités du groupe. Powens en cible,
   * manuel en attendant.
   */
  bankAccounts: defineTable({
    orgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'), // doit être une "group_*"
    bankName: v.string(), // "Qonto", "Palatine", "Neuflize", "Wormser"
    label: v.string(), // nom d'origine import/banque — jamais écrasé après création
    // Nom personnalisé éditable — affiché à la place de `label` si présent.
    displayName: v.optional(v.string()),
    iban: v.optional(v.string()),
    accountKind: v.optional(v.string()), // "checking", "cto", "dat", "savings"
    currency: v.string(),
    currentBalance: v.optional(v.number()), // cents, dernier connu
    balanceAsOf: v.optional(v.number()),
    powensConnectionId: v.optional(v.string()),
    powensAccountId: v.optional(v.string()),
    airtableId: v.optional(v.string()), // ancre import Airtable
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_owner', ['orgId', 'ownerCompanyId'])
    .index('by_powens_account', ['powensAccountId'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * transactions — flux bancaire réalisé. `dealId` nullable car certains
   * mouvements sont opérationnels (impôts, honoraires, charges courantes).
   * Le rapprochement (pointage) se fait via `matchStatus` + `dealId` :
   * invariant `matchStatus === 'matched'` ⟺ rattachée à un deal
   * (`dealId != null`) OU allouée au passif (`allocation` equity/C-C,
   * `dealId` null — cf. convex/liabilities.ts). `reconciled` est un miroir
   * dérivé du pointage DEAL conservé pour les lecteurs existants — ne jamais
   * l'écrire directement (cf. KNOWN_ISSUES.md « Pointage transaction → deal »).
   *
   * `matchStatus` est optionnel au schéma (les docs pré-existants n'ont pas
   * le champ tant que `transactions:backfillMatchStatus` n'a pas tourné) ;
   * absence = logiquement 'unmatched'.
   *
   * `searchText` (recherche full-text) est dérivé de `rawLabel` +
   * `counterparty`, normalisé (minuscules, sans accents) via
   * `lib/searchText.buildSearchText` — à poser à chaque écriture. Optionnel
   * au schéma : les lignes pré-existantes ne l'ont pas tant que
   * `transactions:backfillSearchText` n'a pas tourné (elles sont alors
   * invisibles à la recherche, pas aux listes).
   */
  transactions: defineTable({
    orgId: v.id('organizations'),
    bankAccountId: v.id('bankAccounts'),
    dealId: v.optional(v.id('deals')),
    matchStatus: v.optional(txMatchStatus),
    // Pointage généralisé : deal, position de capital ou C/C inter-entités.
    // Cohabite avec `dealId` : `dealId != null` ⟺ `allocation.kind === 'deal'`
    // (backfill : transactions:backfillAllocation). `targetId` est l'_id de la
    // cible, stocké en string (pas de v.id() union cross-tables).
    allocation: v.optional(
      v.object({
        kind: allocationKind,
        targetId: v.string(),
      }),
    ),
    direction: txDirection,
    amount: v.number(), // cents, toujours positif
    transactionDate: v.number(),
    rawLabel: v.string(),
    counterparty: v.optional(v.string()),
    searchText: v.optional(v.string()), // dérivé rawLabel + counterparty, normalisé
    source: txSource,
    powensTxId: v.optional(v.string()),
    memoId: v.optional(v.string()), // ancre import CSV Mémo Bank (idempotence)
    // Métadonnées d'origine import (CSV Mémo Bank…) — JAMAIS dans `notes`
    // (réservé au pointage manuel). Utile au futur pointage/agent.
    importMeta: v.optional(
      v.object({
        type: v.optional(v.string()), // ex. "Virement entrant"
        category: v.optional(v.string()), // ex. "Logiciels/SaaS", "Intérêts perçus"
        externalRef: v.optional(v.string()), // ex. "WARO - OC - albo"
      }),
    ),
    reconciled: v.boolean(),
    reconciledBy: v.optional(v.id('users')),
    reconciledAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    airtableId: v.optional(v.string()), // ancre import Airtable
  })
    .index('by_org_date', ['orgId', 'transactionDate'])
    .index('by_account_date', ['bankAccountId', 'transactionDate'])
    .index('by_deal', ['dealId'])
    .index('by_powens_id', ['powensTxId'])
    .index('by_memo_id', ['memoId'])
    .index('by_org_unreconciled', ['orgId', 'reconciled'])
    .index('by_org_matchStatus', ['orgId', 'matchStatus'])
    // Dérivation des soldes de passif : transactions d'UNE org pointées sur
    // une cible donnée (chemin imbriqué supporté par Convex).
    .index('by_org_allocation_target', ['orgId', 'allocation.targetId'])
    .index('by_airtable_id', ['airtableId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['orgId', 'matchStatus', 'bankAccountId'],
    }),

  /**
   * matchingDecisions — historique append-only des décisions de pointage
   * (dataset d'apprentissage de l'agent de rattachement, phase 2).
   * Jamais patché ni supprimé. L'état courant vit sur `transactions`
   * (`matchStatus` + `dealId`) ; ici on fige ce que voyait le décideur
   * au moment de la décision (snapshot, jamais recalculé).
   */
  matchingDecisions: defineTable({
    orgId: v.id('organizations'),
    transactionId: v.id('transactions'),
    decision: matchDecision,
    dealId: v.optional(v.id('deals')), // renseigné ssi decision === 'matched'
    source: matchDecisionSource,
    decidedBy: v.id('users'),
    decidedAt: v.number(),

    // Snapshot de la transaction au moment de la décision
    txLabel: v.string(),
    txAmount: v.number(), // cents
    txDate: v.number(), // ms epoch
    txBankAccountId: v.id('bankAccounts'),

    // Features dérivées (calculées si trivialement disponibles)
    dealAmountExpected: v.optional(v.number()), // deal.committedAmount, cents
    amountDelta: v.optional(v.number()), // txAmount - dealAmountExpected
    dateDelta: v.optional(v.number()), // txDate - deal.signedDate, ms

    // FX — phase 2, jamais écrits en MVP 1
    fxRate: v.optional(v.number()),
    amountInDealCurrency: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_transaction', ['transactionId']),

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
    airtableId: v.optional(v.string()), // ancre import Airtable
    archivedAt: v.optional(v.number()),
  })
    .index('by_org_date', ['orgId', 'expectedDate'])
    .index('by_deal', ['dealId'])
    .index('by_account_date', ['bankAccountId', 'expectedDate'])
    .index('by_airtable_id', ['airtableId']),

  // ─── Cash flow forecast (couche prévisionnelle déterministe) ──────────────

  /**
   * forecastRules — causes récurrentes de flux prévisionnels (loyers SCI,
   * salaires, échéances dette, abonnements). L'expansion en occurrences
   * datées vit dans `forecastEntries` (cf. convex/forecasts.ts:expandRules,
   * idempotente via `derivedKey`).
   */
  forecastRules: defineTable({
    orgId: v.id('organizations'),
    label: v.string(),
    amountCents: v.number(), // cents, toujours positif ; le sens vient de `direction`
    direction: txDirection,
    category: v.optional(v.string()), // "loyer", "salaires", "dette"…
    frequency: forecastFrequency,
    interval: v.number(), // « tous les N pas » (1 = chaque mois/semaine/…)
    anchorDay: v.number(), // jour du mois 1-31 (monthly/quarterly/yearly), jour ISO 1-7 (weekly)
    startDate: v.number(), // ms epoch
    endDate: v.optional(v.number()), // ms epoch ; absent = sans fin
    active: v.boolean(),
    sourceType: forecastSourceType,
  }).index('by_org', ['orgId']),

  /**
   * forecastEntries — occurrences datées d'un flux attendu. Soit générées
   * depuis une règle (`ruleId` + `derivedKey`), soit créées à la main
   * (les deux à null). `status` est la source de vérité du cycle de vie,
   * à la manière de `matchStatus` côté transactions. `overridden` protège
   * une occurrence dérivée éditée manuellement : expandRules ne la
   * réécrit jamais.
   *
   * `derivedKey` = clé d'idempotence des lignes auto, format
   * "rule:{ruleId}:{YYYY-MM-DD}" (ou "deal:{dealId}:{YYYY-MM-DD}" pour le
   * futur deriveFromDeals). Null pour les lignes 100 % manuelles.
   */
  forecastEntries: defineTable({
    orgId: v.id('organizations'),
    date: v.number(), // ms epoch, date ferme de l'occurrence
    amountCents: v.number(), // cents, toujours positif ; le sens vient de `direction`
    direction: txDirection,
    confidence: forecastEntryConfidence,
    status: forecastEntryStatus,
    label: v.string(),
    category: v.optional(v.string()),
    ruleId: v.optional(v.id('forecastRules')),
    dealId: v.optional(v.id('deals')), // réservé deriveFromDeals — non écrit en MVP
    derivedKey: v.optional(v.string()),
    overridden: v.boolean(),
    realizedTransactionId: v.optional(v.id('transactions')), // rempli au pointage

    // ── Champs réservés, NON LUS par la logique actuelle ──────────────────
    // Présents au schéma pour éviter une migration future, mais aucune
    // query/mutation ne les exploite encore.
    probabilityPct: v.optional(v.number()), // 0-100 — future couche probabiliste
    counterpartyOrgId: v.optional(v.id('organizations')), // future neutralisation inter-entités au consolidé
    currency: v.string(), // "EUR" — future FX ; seul l'EUR est agrégé pour l'instant
  })
    .index('by_org', ['orgId'])
    .index('by_org_and_date', ['orgId', 'date'])
    .index('by_derivedKey', ['derivedKey'])
    .index('by_rule', ['ruleId']),
})
