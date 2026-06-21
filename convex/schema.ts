/**
 * Albo OS — Convex schema
 *
 * Scope: post-investment tracking. Attio remains the source of truth before
 * investment (dealflow, term sheet, sourcing). Albo OS takes over once the
 * deal is signed (stake tracking, movements, valuations, KPIs).
 *
 * Conventions (see CLAUDE.md § Domaine métier):
 * - Multi-tenant: every business table carries `orgId` (Better Auth
 *   organization). Do not confuse `orgId` (SaaS account = "Calte Family
 *   Office") with `companies.kind = "group_*"` (legal entities of the Calte
 *   group).
 * - Amounts: integers in cents (EUR by default). Avoid floats.
 * - Rates: basis points (bps). 1100 = 11 %. 10000 = 100 %.
 * - Dates: ms epoch (Convex stores number, not Date).
 * - Attio bridges: `attioDealId` / `attioCompanyId` (strings, uniqueness
 *   enforced in mutations, not at the schema level).
 */

import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { instrumentValidator } from './lib/instruments'
import { vatRateBpsValidator } from './lib/vat'

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

// ─── Business enums ─────────────────────────────────────────────────────────

// Note: the Albo / Calte "scope" is now carried by the ORGANIZATION itself
// (one org per investment vehicle), no longer by a field. The aggregated
// view (convex/aggregate.ts) unions the user's orgs.

const companyKind = v.union(
  // Root of the org (the investment holding: CALTE in the Calte org,
  // Albo Club in the Albo org)
  v.literal('group_root'),
  // Sub-entities of the group (inherit the scope of their root)
  v.literal('group_operating'), // Caltimo, Relais Chapelle, RDB
  v.literal('group_sci'), // SCI Chapelle 1, 2, SCI Upload
  v.literal('group_spv'), // SPV Eben Home, SPV Hectarea…
  v.literal('group_manco'), // Banco 2
  // External
  v.literal('portfolio'), // invested companies, LP funds, SCPI, external mancos
)

// Single source: convex/lib/instruments.ts
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
  v.literal('memo_csv'), // one-shot historical Mémo Bank CSV import
)

// Transaction → deal matching. `matchStatus` is the source of truth for the
// intent; `reconciled` remains a derived mirror (cf. KNOWN_ISSUES.md).
const txMatchStatus = v.union(
  v.literal('unmatched'), // to process (logical default)
  // Attached to a deal (`dealId` required) OR allocated to liabilities
  // (equity / shareholder account: `allocation` set, `dealId` null).
  v.literal('matched'),
  v.literal('ignored'), // explicit decision "concerns no deal"
  v.literal('charge'), // discarded: operating expense (subtype of « écarté »)
  v.literal('tax'), // discarded: tax (subtype of « écarté »)
  v.literal('product'), // discarded: non-deal income (subtype of « écarté »)
  v.literal('internal_transfer'), // discarded: transfer between accounts (subtype of « écarté »)
)

// Action recorded in the decision log (`unmatched` = un-matching, also logged).
const matchDecision = v.union(
  v.literal('matched'),
  v.literal('ignored'),
  v.literal('unmatched'),
  v.literal('charge'),
  v.literal('tax'),
  v.literal('product'),
  v.literal('internal_transfer'),
)

// 'manual' = public mutations (UI); 'agent_suggested' = writes from the
// agent tools (convex/agentToolsPointage.ts) after user confirmation.
const matchDecisionSource = v.union(
  v.literal('manual'),
  v.literal('agent_suggested'),
)

// ─── Liability enums (equityPositions / intercompanyLoans / allocation) ─────

// Nature of an equity position. Exported for the public creation
// mutation (convex/liabilities.ts:createEquityPosition).
export const equityPositionType = v.union(
  v.literal('capital_social'),
  v.literal('prime_emission'),
  v.literal('augmentation_capital'),
  v.literal('report_a_nouveau'),
)

// Target of a generalized allocation (`transactions.allocation`). Coexists
// with `dealId`: a deal match writes both (cf. convex/transactions.ts).
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

// ─── Cash flow forecast enums (forecastRules / forecastEntries) ─────────────

// Confidence of a forecast flow. `confirmed` = committed/contractual,
// `expected` = anticipated (known recurrence), `probable` = hypothesis.
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

// Lifecycle of a forecast occurrence. `realized` once matched to a real
// transaction, `cancelled` if it will never happen.
const forecastEntryStatus = v.union(
  v.literal('pending'),
  v.literal('realized'),
  v.literal('cancelled'),
)

// MVP: always 'manual'. 'derived' reserved for future generators
// (deriveFromDeals, deriveFromPipeline Attio).
const forecastSourceType = v.union(v.literal('manual'), v.literal('derived'))

// ─── Schema ───────────────────────────────────────────────────────────────

export default defineSchema({
  // ─── Better Auth / multi-tenant (native Convex, organization() plugin off) ─

  users: defineTable({
    betterAuthId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    avatarStorageId: v.optional(v.id('_storage')),
    superAdmin: v.boolean(),
    preferredLanguage: v.optional(v.union(v.literal('en'), v.literal('fr'))),
    createdAt: v.number(),
  })
    .index('by_betterAuthId', ['betterAuthId'])
    .index('by_email', ['email']),

  // Frequently-written per-user state, isolated from `users` on purpose:
  // every query reads the caller's `users` row (requireAppUser), so writes
  // there invalidate ALL open subscriptions. See KNOWN_ISSUES.md
  // § "Hot `users` row".
  userPrefs: defineTable({
    userId: v.id('users'),
    lastOrgSlug: v.optional(v.string()),
  }).index('by_user', ['userId']),

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
   * powensUsers — permanent Powens user per org (issuing bank connections).
   * INTERNAL: `authToken` is a secret at rest, never exposed to the front
   * end. Read/written only by internalQuery/internalMutation
   * (cf. convex/powens.ts). Do NOT add it to `organizations` (api.bySlug
   * does `return {...org}` → would leak the token).
   */
  powensUsers: defineTable({
    orgId: v.id('organizations'),
    powensUserId: v.string(), // id_user returned by POST /auth/init
    authToken: v.string(), // permanent token — secret
    createdAt: v.number(),
  })
    .index('by_org', ['orgId'])
    // Incoming webhook filter: only a known id_user is ingested.
    .index('by_powens_user_id', ['powensUserId']),

  /**
   * telegramAccounts — one row per app user bridging their Telegram account
   * to the AI agent (cf. convex/telegram.ts). Linked via a one-shot
   * `linkCode` (CLI runbook `telegram:createLinkCode` + `/start <code>`).
   * `orgId` is the current org of the bot conversation (`/org` switches it),
   * `threadId` the current agent thread (`/new` resets it).
   * INTERNAL: read/written only by internal functions — the webhook has no
   * auth identity, membership is re-checked on every message.
   */
  telegramAccounts: defineTable({
    userId: v.id('users'),
    orgId: v.id('organizations'),
    telegramUserId: v.optional(v.string()), // absent until /start links it
    chatId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    linkCode: v.optional(v.string()), // one-shot, cleared after /start
    linkCodeCreatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    // Incoming webhook filter: only a linked telegram user id is served.
    .index('by_telegram_user_id', ['telegramUserId'])
    .index('by_link_code', ['linkCode']),

  // ─── Portfolio core ──────────────────────────────────────────────────────

  /**
   * companies — legal entities. Deliberate mix of group + portfolio,
   * differentiated by `kind`. A "company" can also represent a fund,
   * an SPV, a ManCo, an SCPI.
   *
   * `totalShares` is optional. If set, the ownership % of a share-type
   * deal can be derived via `deal.sharesAcquired / totalShares`.
   */
  companies: defineTable({
    orgId: v.id('organizations'),

    // Identity
    name: v.string(),
    legalName: v.optional(v.string()),
    kind: companyKind,

    // Identifiers — all optional. Uniqueness enforced in mutations.
    siren: v.optional(v.string()), // FR only
    registrationNumber: v.optional(v.string()), // foreign fallback
    countryCode: v.optional(v.string()), // ISO-3166-1 alpha-2
    domain: v.optional(v.string()),

    // Attio bridge
    attioCompanyId: v.optional(v.string()),

    // Airtable import anchor (one-shot, idempotency/link resolution)
    airtableId: v.optional(v.string()),

    // Capital context (to compute ownership %)
    totalShares: v.optional(v.number()),

    // Group-specific
    legalForm: v.optional(v.string()), // SAS, SASU, SCI, SARL, SCPI…
    incorporationDate: v.optional(v.number()),

    // Meta
    sector: v.optional(v.string()),
    // Origin platform for external SPVs (e.g. "Parallel", "Sezame")
    sponsor: v.optional(v.string()),
    // Portfolio group: consolidates several entities under one line in the
    // Participations view (e.g. the SPVs of "Parallel"). Logical key — a group
    // "exists" as soon as one entity carries its value. Distinct from sponsor.
    group: v.optional(v.string()),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_kind', ['orgId', 'kind'])
    .index('by_org_siren', ['orgId', 'siren'])
    .index('by_org_group', ['orgId', 'group'])
    .index('by_attio_company_id', ['attioCompanyId'])
    .index('by_org_domain', ['orgId', 'domain'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * portfolioGroupSettings — canonical record of a portfolio group: a stable
   * URL slug (generated once, never changes), an editable display name, and
   * the consolidated KPI blocks config (order + visibility). The logical key
   * stays `companies.group`; this table only carries presentation state. A row
   * is ensured on first assignment of an entity to a group.
   */
  portfolioGroupSettings: defineTable({
    orgId: v.id('organizations'),
    group: v.string(), // logical key = companies.group
    slug: v.string(), // stable URL identifier, generated at creation
    displayName: v.optional(v.string()), // editable; fallback = group
    // Ordered KPI blocks; keys validated against the catalogue in mutations.
    blocks: v.array(v.object({ key: v.string(), visible: v.boolean() })),
  })
    .index('by_org_group', ['orgId', 'group'])
    .index('by_org_slug', ['orgId', 'slug']),

  /**
   * companyRelations — ownership between entities. Handles non-binary cases
   * (SCI 50/50, Banco 2 50/50…) and Albo's stake in an SPV.
   * Recommendation: always materialize, even direct 100 % stakes.
   */
  companyRelations: defineTable({
    orgId: v.id('organizations'),
    parentCompanyId: v.id('companies'),
    childCompanyId: v.id('companies'),
    ownershipPct: v.optional(v.number()), // 0 to 100
    sharesHeld: v.optional(v.number()),
    notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_parent', ['orgId', 'parentCompanyId'])
    .index('by_child', ['orgId', 'childCompanyId']),

  /**
   * deals — one investment = one instrument subscribed at a given time.
   * Follow-on = new deal. Instrument pattern: instrument-specific fields
   * are nullable, discriminated by `instrumentKind`.
   *
   * `viaSpvCompanyId`: investment via an SPV (1 row, the SPV as denormalized
   * intermediary). Albo's stake IN the SPV lives in `companyRelations`.
   */
  deals: defineTable({
    orgId: v.id('organizations'),

    // Custom name (optional) — displayed instead of the derived title
    // (instrument / target company) when present.
    name: v.optional(v.string()),

    // Who buys what
    investorCompanyId: v.id('companies'), // group entity (CALTE, Albo…)
    targetCompanyId: v.id('companies'), // invested company
    viaSpvCompanyId: v.optional(v.id('companies')), // optional intermediary

    // Instrument
    instrumentKind,

    // Common financials
    currency: v.string(), // "EUR" by default
    committedAmount: v.optional(v.number()), // commitment (LP/SAFE/OS…)
    paidAmount: v.optional(v.number()), // actually disbursed to date

    // Share-based (share, spv_share, secondary, SCI shares…)
    sharesAcquired: v.optional(v.number()),
    pricePerShare: v.optional(v.number()), // cents

    // Debt (os, oc, convertible_note)
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

    // Valuation at deal time (for share / BSA)
    entryValuation: v.optional(v.number()), // cents
    roundSize: v.optional(v.number()), // cents

    // Lifecycle
    signedDate: v.optional(v.number()),
    closingDate: v.optional(v.number()),
    exitedDate: v.optional(v.number()),
    exitProceeds: v.optional(v.number()), // cents — sale proceeds (exit)
    status: dealStatus,

    // Attio bridge
    attioDealId: v.optional(v.string()),

    // Airtable import anchor (derived key `${companyRecId}:${instrumentKind}`)
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
   * valuations — timestamped history of a deal's valuation. Separate from
   * kpiSnapshots to keep a clean table for MOIC/TVPI computations.
   */
  valuations: defineTable({
    orgId: v.id('organizations'),
    dealId: v.id('deals'),
    asOf: v.number(),
    fairValue: v.number(), // cents
    valuationMethod: v.optional(v.string()), // "last_round", "mark_to_market"…
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
    airtableId: v.optional(v.string()), // Airtable import anchor
  })
    .index('by_deal_asof', ['dealId', 'asOf'])
    .index('by_org_asof', ['orgId', 'asOf'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * kpiSnapshots — portfolio KPI history (ARR, GMV, AUM, headcount…).
   * One row = one metric value at a date for a company.
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

  /**
   * dealProjections — a deal's business plan as dated expected rows
   * (mostly royalties: signed BP vs degraded BP vs reality).
   * `version: 'initial'` = BP at closing, frozen; `'revised'` = latest
   * revision. The "realized" side is NOT here: it lives in the transactions
   * matched to the deal. Uniqueness (dealId, version, period) enforced in
   * the mutation (replaceVersion = delete + insert, cf. convex/projections.ts).
   */
  dealProjections: defineTable({
    orgId: v.id('organizations'),
    dealId: v.id('deals'),
    version: v.union(v.literal('initial'), v.literal('revised')),
    period: v.number(), // ms epoch, period start (month/half-year, free-form)
    amountCents: v.number(), // expected over the period, positive
    direction: txDirection, // 'in' (expected returns) | 'out' (deployment)
    notes: v.optional(v.string()),
  })
    .index('by_deal_version', ['dealId', 'version', 'period'])
    .index('by_org', ['orgId']),

  /**
   * documents — reportings & docs attached to a company (mostly
   * portfolio): investor updates, BP, legal. File stored in native Convex
   * storage (20 MB cap). `source: 'email'` reserved for inbound
   * ingestion (V2) — V1 = manual upload.
   */
  documents: defineTable({
    orgId: v.id('organizations'),
    companyId: v.id('companies'),
    title: v.string(),
    kind: v.union(
      v.literal('reporting'),
      v.literal('bp'),
      v.literal('legal'),
      v.literal('other'),
    ),
    period: v.optional(v.number()), // covered period (ms epoch)
    storageId: v.id('_storage'),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    source: v.union(v.literal('upload'), v.literal('email')),
    uploadedBy: v.optional(v.id('users')),
    uploadedAt: v.number(),
  })
    .index('by_company', ['companyId', 'uploadedAt'])
    .index('by_org', ['orgId']),

  // ─── Liabilities (equity + shareholder current accounts) ──────────────────

  /**
   * equityPositions — equity issued by an org (quasi-static).
   * `orgId` = issuing entity. The holder is EITHER a group org
   * (`holderOrgId`), OR a natural person (`holderPersonId`), OR an
   * external party with a free-form label (`holderLabel`).
   */
  equityPositions: defineTable({
    orgId: v.id('organizations'), // issuing entity
    holderOrgId: v.optional(v.id('organizations')), // holder if group entity
    holderPersonId: v.optional(v.string()), // if natural person
    holderLabel: v.optional(v.string()), // free-form label if external
    type: equityPositionType,
    amountCents: v.number(), // cents EUR
    shares: v.optional(v.number()),
    effectiveDate: v.number(), // ms epoch
    actDriveId: v.optional(v.string()),
    airtableId: v.optional(v.string()), // Airtable import anchor (idempotency)
  })
    .index('by_org', ['orgId'])
    .index('by_holder_org', ['holderOrgId'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * intercompanyLoans — inter-entity shareholder current accounts.
   * ONE shared record per creditor → debtor relation.
   *
   * NO balance field: the balance is always derived from the transactions
   * allocated to it (`transactions.allocation.kind === 'intercompany_loan'`),
   * each org summing ITS own transactions (cf. convex/liabilities.ts
   * `getLiabilities` + KNOWN_ISSUES.md « Passif »).
   */
  intercompanyLoans: defineTable({
    fromOrgId: v.id('organizations'), // creditor
    toOrgId: v.id('organizations'), // debtor
    fromPersonId: v.optional(v.string()), // if counterparty is a natural person
    fromLabel: v.optional(v.string()),
    interestRateBps: v.optional(v.number()), // bps; absent = 0 = non-interest-bearing
    isBlocked: v.boolean(),
    conventionDriveId: v.optional(v.string()),
    openedDate: v.number(), // ms epoch
    airtableId: v.optional(v.string()), // Airtable import anchor (idempotency)
  })
    .index('by_from', ['fromOrgId'])
    .index('by_to', ['toOrgId'])
    .index('by_airtable_id', ['airtableId']),

  // ─── Phase 2 — cash management (tables declared, mutations empty) ─────────

  /**
   * bankAccounts — accounts of the group entities. Powens as the target,
   * manual in the meantime.
   */
  bankAccounts: defineTable({
    orgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'), // must be a "group_*"
    bankName: v.string(), // "Qonto", "Palatine", "Neuflize", "Wormser"
    label: v.string(), // original import/bank name — never overwritten after creation
    // Editable custom name — displayed instead of `label` when present.
    displayName: v.optional(v.string()),
    iban: v.optional(v.string()),
    accountKind: v.optional(v.string()), // "checking", "cto", "dat", "savings"
    currency: v.string(),
    currentBalance: v.optional(v.number()), // cents, last known
    balanceAsOf: v.optional(v.number()),
    powensConnectionId: v.optional(v.string()),
    powensAccountId: v.optional(v.string()),
    airtableId: v.optional(v.string()), // Airtable import anchor
    archivedAt: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_owner', ['orgId', 'ownerCompanyId'])
    .index('by_powens_account', ['powensAccountId'])
    .index('by_airtable_id', ['airtableId']),

  /**
   * transactions — realized bank flow. `dealId` nullable because some
   * movements are operational (taxes, fees, recurring expenses).
   * Reconciliation (matching) goes through `matchStatus` + `dealId`:
   * invariant `matchStatus === 'matched'` ⟺ attached to a deal
   * (`dealId != null`) OR allocated to liabilities (`allocation` equity/
   * shareholder account, `dealId` null — cf. convex/liabilities.ts).
   * `reconciled` is a mirror derived from the DEAL match, kept for existing
   * readers — never write it directly (cf. KNOWN_ISSUES.md « Pointage
   * transaction → deal »).
   *
   * `matchStatus` is optional in the schema (pre-existing docs lack the
   * field until `transactions:backfillMatchStatus` has run);
   * absence = logically 'unmatched'.
   *
   * `searchText` (full-text search) is derived from `rawLabel` +
   * `counterparty`, normalized (lowercase, accents stripped) via
   * `lib/searchText.buildSearchText` — to set on every write. Optional in
   * the schema: pre-existing rows lack it until
   * `transactions:backfillSearchText` has run (they are then invisible
   * to search, not to lists).
   */
  transactions: defineTable({
    orgId: v.id('organizations'),
    bankAccountId: v.id('bankAccounts'),
    dealId: v.optional(v.id('deals')),
    matchStatus: v.optional(txMatchStatus),
    // Generalized matching: deal, equity position or inter-entity loan.
    // Coexists with `dealId`: `dealId != null` ⟺ `allocation.kind === 'deal'`
    // (backfill: transactions:backfillAllocation). `targetId` is the target's
    // _id, stored as a string (no cross-table v.id() union).
    allocation: v.optional(
      v.object({
        kind: allocationKind,
        targetId: v.string(),
      }),
    ),
    direction: txDirection,
    amount: v.number(), // cents, always positive
    // VAT rate in basis points (0/550/1000/2000), set only on the
    // `charge` (deductible VAT) and `product` (collected VAT) statuses —
    // cleared when the transaction leaves these statuses. The VAT amount is
    // derived from the tax-inclusive total (lib/vat.ts), never stored.
    // Absent = « à qualifier ».
    vatRateBps: v.optional(vatRateBpsValidator),
    transactionDate: v.number(),
    rawLabel: v.string(),
    counterparty: v.optional(v.string()),
    searchText: v.optional(v.string()), // derived from rawLabel + counterparty, normalized
    source: txSource,
    powensTxId: v.optional(v.string()),
    memoId: v.optional(v.string()), // Mémo Bank CSV import anchor (idempotency)
    // Import origin metadata (Mémo Bank CSV…) — NEVER in `notes`
    // (reserved for manual matching). Useful for future matching/agent work.
    importMeta: v.optional(
      v.object({
        type: v.optional(v.string()), // e.g. "Virement entrant"
        category: v.optional(v.string()), // e.g. "Logiciels/SaaS", "Intérêts perçus"
        externalRef: v.optional(v.string()), // e.g. "WARO - OC - albo"
      }),
    ),
    reconciled: v.boolean(),
    reconciledBy: v.optional(v.id('users')),
    reconciledAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    airtableId: v.optional(v.string()), // Airtable import anchor
  })
    .index('by_org_date', ['orgId', 'transactionDate'])
    .index('by_account_date', ['bankAccountId', 'transactionDate'])
    .index('by_deal', ['dealId'])
    .index('by_powens_id', ['powensTxId'])
    .index('by_memo_id', ['memoId'])
    .index('by_org_unreconciled', ['orgId', 'reconciled'])
    .index('by_org_matchStatus', ['orgId', 'matchStatus'])
    // Liability balance derivation: transactions of ONE org allocated to a
    // given target (nested path supported by Convex).
    .index('by_org_allocation_target', ['orgId', 'allocation.targetId'])
    .index('by_airtable_id', ['airtableId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['orgId', 'matchStatus', 'bankAccountId'],
    }),

  /**
   * matchingDecisions — append-only history of matching decisions
   * (training dataset for the matching agent, phase 2).
   * Never patched nor deleted. The current state lives on `transactions`
   * (`matchStatus` + `dealId`); here we freeze what the decision-maker
   * saw at decision time (snapshot, never recomputed).
   */
  matchingDecisions: defineTable({
    orgId: v.id('organizations'),
    transactionId: v.id('transactions'),
    decision: matchDecision,
    dealId: v.optional(v.id('deals')), // set iff decision === 'matched'
    source: matchDecisionSource,
    decidedBy: v.id('users'),
    decidedAt: v.number(),

    // Snapshot of the transaction at decision time
    txLabel: v.string(),
    txAmount: v.number(), // cents
    txDate: v.number(), // ms epoch
    txBankAccountId: v.id('bankAccounts'),

    // Derived features (computed when trivially available)
    dealAmountExpected: v.optional(v.number()), // deal.committedAmount, cents
    amountDelta: v.optional(v.number()), // txAmount - dealAmountExpected
    dateDelta: v.optional(v.number()), // txDate - deal.signedDate, ms

    // FX — phase 2, never written in MVP 1
    fxRate: v.optional(v.number()),
    amountInDealCurrency: v.optional(v.number()),
  })
    .index('by_org', ['orgId'])
    .index('by_transaction', ['transactionId']),

  /**
   * forecasts — expected flows (capital calls, distributions, debt
   * maturities, recurring charges). `realizedTransactionId` filled when a
   * real movement extinguishes it.
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
    airtableId: v.optional(v.string()), // Airtable import anchor
    archivedAt: v.optional(v.number()),
  })
    .index('by_org_date', ['orgId', 'expectedDate'])
    .index('by_deal', ['dealId'])
    .index('by_account_date', ['bankAccountId', 'expectedDate'])
    .index('by_airtable_id', ['airtableId']),

  // ─── Cash flow forecast (deterministic forecasting layer) ─────────────────

  /**
   * forecastRules — recurring causes of forecast flows (SCI rents,
   * salaries, debt maturities, subscriptions). The expansion into dated
   * occurrences lives in `forecastEntries` (cf. convex/forecasts.ts:
   * expandRules, idempotent via `derivedKey`).
   */
  forecastRules: defineTable({
    orgId: v.id('organizations'),
    label: v.string(),
    amountCents: v.number(), // cents, always positive; the sign comes from `direction`
    direction: txDirection,
    category: v.optional(v.string()), // "loyer", "salaires", "dette"…
    frequency: forecastFrequency,
    interval: v.number(), // "every N steps" (1 = every month/week/…)
    anchorDay: v.number(), // day of month 1-31 (monthly/quarterly/yearly), ISO day 1-7 (weekly)
    startDate: v.number(), // ms epoch
    endDate: v.optional(v.number()), // ms epoch; absent = no end
    active: v.boolean(),
    sourceType: forecastSourceType,
  }).index('by_org', ['orgId']),

  /**
   * forecastEntries — dated occurrences of an expected flow. Either
   * generated from a rule (`ruleId` + `derivedKey`) or created by hand
   * (both null). `status` is the source of truth for the lifecycle,
   * mirroring `matchStatus` on the transactions side. `overridden` protects
   * a derived occurrence edited manually: expandRules never rewrites
   * it.
   *
   * `derivedKey` = idempotency key for auto rows, format
   * "rule:{ruleId}:{YYYY-MM-DD}" (or "deal:{dealId}:{YYYY-MM-DD}" for the
   * future deriveFromDeals). Null for 100 % manual rows.
   */
  forecastEntries: defineTable({
    orgId: v.id('organizations'),
    date: v.number(), // ms epoch, firm date of the occurrence
    amountCents: v.number(), // cents, always positive; the sign comes from `direction`
    direction: txDirection,
    confidence: forecastEntryConfidence,
    status: forecastEntryStatus,
    label: v.string(),
    category: v.optional(v.string()),
    ruleId: v.optional(v.id('forecastRules')),
    dealId: v.optional(v.id('deals')), // reserved for deriveFromDeals — not written in MVP
    derivedKey: v.optional(v.string()),
    overridden: v.boolean(),
    realizedTransactionId: v.optional(v.id('transactions')), // filled on matching

    // ── Reserved fields, NOT READ by current logic ────────────────────────
    // Present in the schema to avoid a future migration, but no
    // query/mutation uses them yet.
    probabilityPct: v.optional(v.number()), // 0-100 — future probabilistic layer
    counterpartyOrgId: v.optional(v.id('organizations')), // future inter-entity netting at consolidation
    currency: v.string(), // "EUR" — future FX; only EUR is aggregated for now
  })
    .index('by_org', ['orgId'])
    .index('by_org_and_date', ['orgId', 'date'])
    .index('by_derivedKey', ['derivedKey'])
    .index('by_rule', ['ruleId']),
})
