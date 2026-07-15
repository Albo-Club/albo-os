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
import {
  couponPeriodicityValidator,
  fundTypeValidator,
  instrumentValidator,
  propertyTypeValidator,
  repaymentModalityValidator,
  roundTypeValidator,
  safeTypeValidator,
  termDurationValidator,
} from './lib/instruments'
import { personValidator } from './lib/people'
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
  // Attio Term Sheet: committed but not yet wired (anticipated). Set by the
  // Attio sync (convex/attioSync.ts) and flipped to 'active' on Invested.
  v.literal('pending'),
  v.literal('active'),
  v.literal('partially_exited'),
  v.literal('fully_exited'),
  v.literal('written_off'),
)

// Instrument-archetype enums (dashboard refonte). Consumed only by the
// optional per-archetype columns on `deals`; see convex/lib/instruments.ts
// for the validators (single source) and convex/lib/instrumentMapping.ts for
// the instrumentKind → fields mapping.
const roundType = roundTypeValidator
const safeType = safeTypeValidator
const couponPeriodicity = couponPeriodicityValidator
const repaymentModality = repaymentModalityValidator
const termDuration = termDurationValidator
const fundType = fundTypeValidator
const propertyType = propertyTypeValidator

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

// Statuses a learned categorization rule can replay (never 'matched' — a
// deal match needs human judgment; never 'ignored' — too easy to create a
// silent blind spot from a one-off gesture).
const categoryRuleStatus = v.union(
  v.literal('charge'),
  v.literal('tax'),
  v.literal('product'),
  v.literal('internal_transfer'),
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

  /**
   * vascoConnections — investor-side connections to VASCO (https://vasco.fund),
   * the fund-admin platform backing vehicles like Parallel Invest
   * (`parallel.vasco.fund`). Albo OS pulls the data that only lives on the
   * platform (positions, valuations, documents/reportings, communications) —
   * distinct from the email report pipeline.
   *
   * One row per (VASCO client × Albo OS org): `Parallel → Calte` and
   * `Parallel → Albo` are two rows (same `clientSlug`, different `username` +
   * `orgId`). Adding a vehicle = adding a row. Each connection feeds exactly
   * one org, so the pulled data stays within that org's tenant boundary.
   *
   * INTERNAL: `username`/`password` are secrets at rest, never exposed to the
   * front end. Read/written only by internalQuery/internalMutation
   * (cf. convex/vasco.ts). Do NOT return a raw row from a public query — it
   * would leak the credentials (same rule as `powensUsers`).
   */
  vascoConnections: defineTable({
    orgId: v.id('organizations'), // Albo OS org fed by this connection
    clientSlug: v.string(), // → https://api.<clientSlug>.vasco.fund
    label: v.string(), // human label, e.g. "Parallel — Calte"
    username: v.string(), // login email — secret
    password: v.string(), // login password — secret at rest
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.optional(v.id('users')),
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_client_and_username', ['clientSlug', 'username']),

  /**
   * vascoCommunicationsCache — local copy of the investor communications pulled
   * from VASCO/Parallel, so the UI reads them **instantly** (reactive Convex
   * query) instead of a live login + full pull on every open. VASCO has no
   * webhook for the investor persona (pull-only), so freshness is maintained by
   * a cron (every 48h) plus a manual "refresh" button — cf. KNOWN_ISSUES.md
   * "VASCO API". One row per communication; the set is replaced wholesale per
   * (orgId, clientSlug) on each refresh. A cache, not a source of truth: the
   * document BYTES are still fetched live (`downloadCommunicationDocument`),
   * only metadata is stored here.
   */
  vascoCommunicationsCache: defineTable({
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(),
    communicationId: v.string(), // VASCO communication id
    issuerLabel: v.optional(v.string()),
    title: v.optional(v.string()),
    bodyText: v.optional(v.string()), // plain text (HTML already stripped)
    period: v.optional(v.string()),
    publishDate: v.optional(v.string()),
    documents: v.array(
      v.object({
        documentId: v.string(),
        name: v.optional(v.string()),
        contentType: v.optional(v.string()),
        createdAt: v.optional(v.string()),
      }),
    ),
    fetchedAt: v.number(), // when this row was last pulled
  }).index('by_org', ['orgId']),

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
    // One-line pitch shown in the Participations table. Seeded once for the
    // albo portfolio via migrations/alboOneLinerImport; hand-edited thereafter.
    oneLiner: v.optional(v.string()),
    // Longer 2-3 line summary shown under the entity page header. Hand-filled
    // (albo portfolio first).
    summary: v.optional(v.string()),
    // Origin platform for external SPVs (e.g. "Parallel", "Sezame")
    sponsor: v.optional(v.string()),
    // VASCO / Parallel bridge — links this entity to its VASCO issuer (the SPV)
    // so the issuer's investor communications surface in the entity's Report
    // section. Set together; matched by issuer id, never by name (labels are
    // opaque "SPVn"). cf. KNOWN_ISSUES.md "VASCO API".
    vascoClientSlug: v.optional(v.string()),
    vascoIssuerId: v.optional(v.string()),
    // Portfolio group: consolidates several entities under one line in the
    // Participations view (e.g. the SPVs of "Parallel"). Logical key — a group
    // "exists" as soon as one entity carries its value. Distinct from sponsor.
    group: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Founders / board / co-investors. Display-only list (Lot 5a backend; UI
    // in Lot 5b). Each entry is either Attio-linked (attioRecordId) or free.
    people: v.optional(v.array(personValidator)),
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
    // Organizational nature of the group (badge label only — no KPI impact).
    // Set once at creation (forced choice); reclassifiable on the conso page.
    groupKind: v.optional(v.union(v.literal('sponsor'), v.literal('group'))),
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
    // Royalties custom panel (1 deal = 1 underlying). Declarative scalars
    // edited via the standard dialog; the two lists below are edited via a
    // dedicated UI in RoyaltiesPanel (deals.update patch). All derived figures
    // (degraded BP, royalties, gaps) are computed at display, never stored.
    capitalInvested: v.optional(v.number()), // cents
    depreciationRate: v.optional(v.number()), // bps — BP degradation factor
    // Initial business plan, pasted once (quarter → planned revenue, cents).
    bpPoints: v.optional(
      v.array(v.object({ quarter: v.string(), plannedRevenue: v.number() })),
    ),
    // Actuals, one point added per quarter (quarter → actual revenue, cents).
    actualPoints: v.optional(
      v.array(v.object({ quarter: v.string(), actualRevenue: v.number() })),
    ),
    // Generic contract parameters (user-entered, no business rule baked in).
    // Floor/cap are stored as MULTIPLES of capitalInvested (e.g. 1.25, 2.0);
    // their euro amount is computed at display (multiple × capitalInvested).
    investmentDate: v.optional(v.number()), // ms epoch
    royaltyStartDate: v.optional(v.number()), // ms epoch — informational only, no calc impact
    floorMultiple: v.optional(v.number()), // decimal (e.g. 1.25)
    capMultiple: v.optional(v.number()), // decimal (e.g. 2.0)
    endDate: v.optional(v.number()), // ms epoch

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

    // ─── Instrument-archetype fields (dashboard refonte) ──────────────────
    // All optional, dormant: each deal only fills the columns of its
    // instrumentKind config (see convex/lib/instrumentMapping.ts). Never
    // destroyed when the instrumentKind changes.

    // Equity / round
    roundType: v.optional(roundType),
    preMoneyValuation: v.optional(v.number()), // cents
    postMoneyValuation: v.optional(v.number()), // cents
    ownershipPct: v.optional(v.number()), // bps (pctDetention / pctDetentionResultant)

    // SAFE / convertible
    safeType: v.optional(safeType),
    conversionDeadlineDate: v.optional(v.number()), // ms
    conversionValuation: v.optional(v.number()), // cents

    // Debt (os / dat)
    couponPeriodicity: v.optional(couponPeriodicity),
    repaymentModality: v.optional(repaymentModality),
    termDuration: v.optional(termDuration),
    bankName: v.optional(v.string()),

    // Funds / SPV
    fundType: v.optional(fundType),
    vintageYear: v.optional(v.number()),
    managementCompany: v.optional(v.string()), // shared scpi + fonds
    underlyingTarget: v.optional(v.string()),
    spvOwnershipPct: v.optional(v.number()), // bps
    structuringFees: v.optional(v.number()), // cents
    spvName: v.optional(v.string()), // SPV legal name (text — SPV not modeled as entity)

    // Lead SPV (management revenue as SPV lead — declarative, level 1). The
    // amount actually collected is derived from inbound transactions
    // (received), never stored. See convex/lib/instrumentMapping.ts.
    amountRaised: v.optional(v.number()), // cents — third-party capital raised
    managementFeeRate: v.optional(v.number()), // bps — annual management fee
    hurdleRate: v.optional(v.number()), // bps — preferred return threshold
    carriedRate: v.optional(v.number()), // bps — carried interest share

    // Real estate (scpi / immo)
    distributionRate: v.optional(v.number()), // bps
    enjoymentDelayMonths: v.optional(v.number()),
    acquisitionFees: v.optional(v.number()), // cents
    surfaceSqm: v.optional(v.number()),
    location: v.optional(v.string()),
    propertyType: v.optional(propertyType),
    rentReceived: v.optional(v.number()), // cents

    // BSA (warrants) — own config, split from safe
    grantDate: v.optional(v.number()), // ms — warrant grant date
    warrantsCount: v.optional(v.number()),
    warrantPrice: v.optional(v.number()), // cents — per-warrant acquisition price
    strikePrice: v.optional(v.number()), // cents — exercise price
    warrantParity: v.optional(v.number()), // warrants → shares ratio (decimal)
    exerciseDeadlineDate: v.optional(v.number()), // ms

    // OC (convertible bond) — own config, split from safe. Reuses interestRate
    // + maturityDate (debt block above) and conversionValuation/sharesAcquired/
    // ownershipPct (post-conversion).
    conversionRatio: v.optional(v.number()), // decimal
    conversionDiscount: v.optional(v.number()), // bps

    // Placement (crypto / capitalization_account)
    currentValue: v.optional(v.number()), // cents — current value of a placement

    // Field names edited by hand on the deal sheet. The Airtable re-import
    // (convex/airtableImport.ts:upsertDeals) skips these columns so manual
    // corrections survive a re-run. See KNOWN_ISSUES « Édition manuelle deals ».
    manuallyEditedFields: v.optional(v.array(v.string())),

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
    // ── Email ingestion (AgentMail report pipeline) ───────────────────────
    // Set when the file arrives as an email attachment. `reportId` links the
    // file to its `companyReports` row; `extractedText` holds the OCR/parsed
    // text (deferred — null until OCR is wired); `inline` flags inline images
    // (cid:) which are hidden from the Docs tab. All optional → manual uploads
    // leave them unset.
    reportId: v.optional(v.id('companyReports')),
    extractedText: v.optional(v.string()),
    inline: v.optional(v.boolean()),
  })
    .index('by_company', ['companyId', 'uploadedAt'])
    .index('by_org', ['orgId'])
    .index('by_report', ['reportId']),

  /**
   * companyReports — investor updates ingested by email (AgentMail report
   * pipeline). One row per report. The `orgId` is DERIVED from the matched
   * company (single shared inbox, no per-org inbox). Extracted metrics are a
   * raw JSON snapshot on `metrics` (granular KPI tracking is deferred).
   *
   * Dedup: `agentmailMessageId` (webhook fired twice) and `companyId +
   * reportPeriod` (re-import of the same period → update in place).
   */
  companyReports: defineTable({
    orgId: v.id('organizations'),
    companyId: v.id('companies'),

    // Provenance
    source: v.union(v.literal('email'), v.literal('upload')),
    agentmailInboxId: v.optional(v.string()),
    agentmailMessageId: v.optional(v.string()), // dedup key
    agentmailThreadId: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    subject: v.optional(v.string()),
    emailDate: v.optional(v.number()), // ms epoch

    // Analysis — extraction brain (Cerveau 1)
    title: v.optional(v.string()),
    headline: v.optional(v.string()),
    keyHighlights: v.optional(v.array(v.string())),
    reportPeriod: v.optional(v.string()), // "January 2026", "Q4 2025"
    periodSortDate: v.optional(v.number()), // ms epoch (sorting)
    reportType: v.optional(
      v.union(
        v.literal('monthly'),
        v.literal('bimonthly'),
        v.literal('quarterly'),
        v.literal('semi-annual'),
        v.literal('annual'),
      ),
    ),
    reportAbout: v.optional(
      v.union(
        v.literal('company_self'),
        v.literal('fund_portfolio_company'),
      ),
    ),
    metrics: v.optional(v.any()), // flat canonical map { key: converted number }
    // Full as-written metric snapshot (label, value, seen unit, catalog key) —
    // the audit trail that lets normalization be replayed without the LLM.
    rawMetrics: v.optional(v.any()),

    // Content (input for the synthesis brain)
    rawContent: v.optional(v.string()), // all extracted text combined
    cleanedHtml: v.optional(v.string()), // email HTML (inline imgs rewritten)

    // Pipeline state
    status: v.union(
      v.literal('processing'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    error: v.optional(v.string()),
    pipelineVersion: v.optional(v.string()),
    processedAt: v.optional(v.number()),
  })
    .index('by_company', ['companyId', 'periodSortDate'])
    .index('by_org', ['orgId'])
    .index('by_message_id', ['agentmailMessageId'])
    .index('by_company_period', ['companyId', 'reportPeriod']),

  /**
   * companyIntelligence — one row per company holding the AI synthesis
   * (Cerveau 3) output. Updated after each report ingestion. Equivalent of
   * the `ai_analysis*` fields on Albo's `portfolio_companies`.
   */
  companyIntelligence: defineTable({
    orgId: v.id('organizations'),
    companyId: v.id('companies'),
    aiAnalysis: v.optional(v.any()), // { executive_summary, health_score, top_insights, alerts }
    aiAnalysisStatus: v.optional(
      v.union(
        v.literal('processing'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('no_data'),
      ),
    ),
    aiAnalysisUpdatedAt: v.optional(v.number()),
    latestReportId: v.optional(v.id('companyReports')),
  })
    .index('by_company', ['companyId'])
    .index('by_org', ['orgId']),

  /**
   * inboundEmails — every email received on the AgentMail report inbox,
   * recorded BEFORE any processing (store-first). The pipeline only ever
   * advances `status`; the review-queue page reads this table. No `orgId`:
   * a row is cross-org until a company match assigns the report(s) to org(s).
   *
   * Dedup: `agentmailMessageId`, enforced in `reportInbox.ingest` (Convex has
   * no unique constraints). Body snapshots are truncated (1MB doc cap) —
   * later pipeline stages re-fetch the full body from AgentMail when needed.
   */
  inboundEmails: defineTable({
    // AgentMail provenance
    agentmailInboxId: v.string(),
    agentmailMessageId: v.string(), // dedup key
    agentmailThreadId: v.optional(v.string()),

    // Envelope
    fromEmail: v.string(),
    toEmails: v.array(v.string()),
    ccEmails: v.array(v.string()),
    subject: v.string(),
    receivedAt: v.number(), // ms epoch (email date; fallback: webhook arrival)

    // Content snapshot (may be hydrated async — the webhook can omit bodies)
    bodyText: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    attachments: v.array(
      v.object({
        attachmentId: v.string(),
        filename: v.string(),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        inline: v.optional(v.boolean()),
        // Set by the content router (brick 4) once the file is in storage.
        storageId: v.optional(v.id('_storage')),
      }),
    ),

    // Pipeline state machine
    status: v.union(
      v.literal('received'),
      v.literal('processing'),
      v.literal('processed'),
      v.literal('needs_review'),
      v.literal('rejected'),
    ),
    statusReason: v.optional(v.string()), // machine code, e.g. "unknown_sender"
    // Sender authentication (brick 2): set when fromEmail matches an app user
    // who is a member of ≥1 org. Unknown senders / spam → needs_review, and
    // NEVER get any outbound reply (anti-enumeration).
    senderUserId: v.optional(v.id('users')),
    // Identification (brick 3): the real author extracted from the forward
    // wrapper, and ALL entities representing the matched participation
    // (multi-entity / multi-org fan-out). `matchMethod` says how the LLM pick
    // was corroborated deterministically ('domain' | 'name' | 'domain+name').
    realSenderEmail: v.optional(v.string()),
    matchedCompanies: v.optional(
      v.array(
        v.object({
          companyId: v.id('companies'),
          orgId: v.id('organizations'),
        }),
      ),
    ),
    matchMethod: v.optional(v.string()),
    // Content router outcomes (brick 4) — closed world: every attachment and
    // link ends in exactly one of three states. `detail` is a machine code
    // ('ocr_failed', 'file_too_large', 'notion_unreachable', …).
    sources: v.optional(
      v.array(
        v.object({
          kind: v.string(), // 'body' | 'pdf' | 'excel' | 'image' | 'notion' | 'gdrive' | 'docsend' | 'other'
          label: v.string(), // filename or URL
          state: v.union(v.literal('extracted'), v.literal('stored'), v.literal('failed')),
          detail: v.optional(v.string()),
          chars: v.optional(v.number()),
        }),
      ),
    ),
    // Combined extracted text (bounded) — input for metric extraction (brick 5).
    extractedText: v.optional(v.string()),
    error: v.optional(v.string()),
    // Fan-out targets once matched (one report per company/org) — later bricks
    reportIds: v.optional(v.array(v.id('companyReports'))),
    processedAt: v.optional(v.number()),
    // Recap notification guard (brick 6): set once the recap/quarantine
    // email went out — retries never double-send.
    notifiedAt: v.optional(v.number()),
  })
    .index('by_message_id', ['agentmailMessageId'])
    .index('by_status', ['status']),

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
    // Lifecycle: 'closed' = account closed at the bank, kept for its
    // transaction history (deals still reference it). Absent = active.
    // Distinct from `archivedAt` (import artifacts hidden everywhere).
    accountStatus: v.optional(
      v.union(v.literal('active'), v.literal('closed')),
    ),
    // Pledged/blocked funds (nantissement, escrow, blocked savings): the
    // account stays listed but its balance is excluded from the AVAILABLE
    // balance and from the forecast starting balance. Absent = false.
    pledged: v.optional(v.boolean()),
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
    // Broad treasury category (slug from convex/lib/categories.ts), set only
    // on the `charge` / `product` statuses — cleared when the transaction
    // leaves them (same invariant family as `vatRateBps`). The other
    // statuses derive their analysis bucket from the status itself
    // (deal / equity / intercos / taxes — cf. lib/categories.ts
    // effectiveCategory). Absent = « à qualifier ».
    category: v.optional(v.string()),
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
   * categoryRules — learned auto-categorization rules ("Fygr pattern"):
   * one manual categorization gesture (charge/tax/product/internal transfer,
   * optionally with a category + VAT rate) is memorized as a rule keyed by a
   * normalized label pattern (lib/categories.ts:deriveCategoryPattern), then
   * replayed on newly ingested transactions (Powens webhook, Mémo CSV) and on
   * demand (transactions:applyCategoryRules). One rule per (org, pattern) —
   * the latest gesture wins. Rule applications NEVER write to
   * `matchingDecisions` (machine decision, not a human one).
   */
  categoryRules: defineTable({
    orgId: v.id('organizations'),
    pattern: v.string(), // normalized stable tokens (lib/categories.ts)
    status: categoryRuleStatus, // charge | product | tax | internal_transfer
    category: v.optional(v.string()), // charge/product only
    vatRateBps: v.optional(vatRateBpsValidator), // charge/product only
    createdBy: v.id('users'),
  })
    .index('by_org', ['orgId'])
    .index('by_org_and_pattern', ['orgId', 'pattern']),

  /**
   * dismissedRuleSuggestions — recurring-flow groups the user explicitly
   * declined to turn into a forecast rule ("Ignorer" on the suggested-rules
   * card). Keyed by the same stable label pattern as `categoryRules`
   * (lib/categories.ts deriveCategoryPattern) so the suggestion never nags
   * again. No edit/delete surface in V1 (Convex dashboard, like
   * categoryRules).
   */
  dismissedRuleSuggestions: defineTable({
    orgId: v.id('organizations'),
    pattern: v.string(),
    direction: txDirection,
    createdBy: v.id('users'),
  }).index('by_org', ['orgId']),

  /**
   * forecastSnapshots — monthly photo of the projected balance, captured by
   * cron on the 1st of each month (convex/crons.ts → forecasts.
   * captureSnapshots, idempotent per (orgId, snapshotMonth)). Feeds the
   * forecast-reliability measure: what we projected for a month vs the real
   * end-of-month balance once the month is over. Append-only.
   */
  forecastSnapshots: defineTable({
    orgId: v.id('organizations'),
    snapshotMonth: v.string(), // "YYYY-MM" — the month the capture ran in
    capturedAt: v.number(),
    startingBalanceCents: v.number(),
    /** Projection at capture time (consumption semantics, 12-month horizon). */
    months: v.array(
      v.object({
        monthKey: v.string(),
        committedBalanceCents: v.number(),
        plannedBalanceCents: v.number(),
      }),
    ),
  }).index('by_org_month', ['orgId', 'snapshotMonth']),

  /**
   * cashAlertSettings — one optional row per org: threshold alert on the
   * projected balance (90-day planned scenario) and on the available
   * balance. Evaluated daily by cron (forecasts.checkCashAlerts) with a
   * 7-day cooldown (`lastNotifiedAt`); members are notified by email.
   */
  cashAlertSettings: defineTable({
    orgId: v.id('organizations'),
    thresholdCents: v.number(),
    active: v.boolean(),
    lastNotifiedAt: v.optional(v.number()),
    updatedBy: v.id('users'),
  }).index('by_org', ['orgId']),

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
    // Optional link to the deal this flow belongs to (SCPI rents, coupons,
    // distributions…) — propagated to the derived entries by expandRules
    // and surfaced on the deal page. Same-org enforced in the mutations.
    dealId: v.optional(v.id('deals')),
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
   * "rule:{ruleId}:{YYYY-MM-DD}", "vat:{orgId}:{YYYY-Qn}" (quarterly VAT
   * suggestion — no ruleId, so the row stays a plain editable one-off) or
   * "deal:{dealId}:{YYYY-MM-DD}" for the future deriveFromDeals. Null for
   * 100 % manual rows.
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
    // Optional deal link: copied from the rule by expandRules, or set by
    // hand on a one-off. Feeds the deal page's forecast section.
    dealId: v.optional(v.id('deals')),
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
    .index('by_rule', ['ruleId'])
    .index('by_deal', ['dealId']),
})
