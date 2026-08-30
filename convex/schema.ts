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
  placementLiquidityValidator,
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

/**
 * Only the `group_*` / `portfolio` split carries behaviour: a deal's investor
 * and a bank account's owner must be `group_*`, and the app splits the two
 * lists on the same test (`kind.startsWith('group_')`). `group_root` is the
 * one group value read on its own — it is how an org finds its own company
 * (Attio term sheets, the Passif page, the migrations).
 *
 * The former sub-types (`group_operating` / `group_sci` / `group_spv` /
 * `group_manco`) described the nature of the company and nothing ever read
 * them; they are being collapsed into `group_entity` by
 * `migrations/collapseGroupKinds`, and will be dropped from this union once
 * no row carries them (purge-then-narrow — cf. KNOWN_ISSUES.md).
 */
const companyKind = v.union(
  // Root of the org (the investment holding: CALTE in the Calte org,
  // Albo Club in the Albo org)
  v.literal('group_root'),
  // Any other legal entity of the org (SPVs…)
  v.literal('group_entity'),
  // DEPRECATED — collapsed into `group_entity`, kept until the data is clean.
  v.literal('group_operating'),
  v.literal('group_sci'),
  v.literal('group_spv'),
  v.literal('group_manco'),
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
  v.literal('fully_exited'),
  v.literal('written_off'),
  // Deal called off after the funds were wired and refunded: the flows exist
  // (and stay matchable) but there never was a position, so it is neither an
  // exit nor a write-off. Terminal, and kept out of every performance ratio.
  v.literal('cancelled'),
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
const placementLiquidity = placementLiquidityValidator

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
  // discarded: transfer between two accounts of the SAME entity (subtype of
  // « écarté »). Paired to its counter-leg through `allocation.kind ===
  // 'transfer'`; absent allocation = transfer still missing its counter-leg.
  v.literal('internal_transfer'),
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

// ─── Bank debt enums (loans / loanRates) ────────────────────────────────────

// How the capital of a loan is repaid. Exported for the public mutations
// (convex/loans.ts); the pure engine mirrors it as a TS union
// (convex/lib/amortization.ts `AmortizationKind`).
//
// `revolving` is the odd one out: no schedule, no fixed duration — its
// `principalCents` is the CURRENT OUTSTANDING, entered by hand. It is the
// module's one assumed exception to "nothing derivable is stored".
export const amortizationKind = v.union(
  v.literal('constant_annuity'),
  v.literal('constant_capital'),
  v.literal('bullet'),
  v.literal('revolving'),
)

// A fixed-rate loan has NO `loanRates` row at all — nothing to enter,
// nothing to maintain.
export const loanRateKind = v.union(v.literal('fixed'), v.literal('variable'))

export const loanPaymentFrequency = v.union(
  v.literal('monthly'),
  v.literal('quarterly'),
)

// Deferred amortization: `partial` = the interest is paid, `total` = it
// capitalizes (the amortized capital then starts ABOVE the principal).
export const loanDeferralKind = v.union(
  v.literal('partial'),
  v.literal('total'),
)

export const loanStatus = v.union(
  v.literal('active'),
  v.literal('repaid'),
  v.literal('cancelled'),
)

// Nature of a dated rate step: `actual` = a revision that happened,
// `forecast` = a steering assumption. Instalments beyond the last `actual`
// are flagged as projected — the app does not pretend to know the 2029 rate.
export const loanRateStepKind = v.union(
  v.literal('actual'),
  v.literal('forecast'),
)

// ─── Guarantee enums (guarantees) ───────────────────────────────────────────

// The FORM of a security interest — what kind of hold it gives the lender.
// Independent of its subject and of its guarantor (SPEC D17): a single field
// could not say « caution given by CALTE over its own shares ».
export const guaranteeForm = v.union(
  v.literal('nantissement'),
  v.literal('hypotheque'),
  v.literal('ppd'),
  v.literal('caution'),
  v.literal('garantie_organisme'),
)

// The SUBJECT the security bites on. `external` covers what is not ours at
// all — an institution's guarantee (Saccef), or a third party's asset.
export const guaranteeSubjectKind = v.union(
  v.literal('placement'),
  v.literal('property'),
  v.literal('shares'),
  v.literal('external'),
)

// ─── Property enums (properties) ────────────────────────────────────────────

// Named `propertyAssetType` and not `propertyType`: that name is already
// taken at module level by the INSTRUMENT field of a real-estate deal
// (residentiel / commercial / bureau / autre, cf. lib/instruments.ts). Two
// different axes, two different vocabularies — the table field below keeps
// the natural name.
export const propertyAssetType = v.union(
  v.literal('appartement'),
  v.literal('maison'),
  v.literal('immeuble'),
  v.literal('local_commercial'),
  v.literal('terrain'),
)

// What the property is USED for. `marchand_de_biens` is a usage, not a
// separate object (SPEC D29): 80 % of the fields are shared with a rental,
// and a property can change usage. When it is set, the UI hides the
// operating result and puts the cost basis and the exit IRR forward.
export const propertyUsage = v.union(
  v.literal('locatif_nu'),
  v.literal('locatif_meuble'),
  v.literal('colocation'),
  v.literal('saisonnier'),
  v.literal('commercial'),
  v.literal('marchand_de_biens'),
  v.literal('residence_secondaire'),
)

export const propertyStatus = v.union(v.literal('held'), v.literal('sold'))

// The three cost-basis line items of a property. They are the only ones that
// enter the cost price; `charges` / `loyer` / `revente` are flow categories
// (see `allocationCategory`) and never a line item.
export const propertyCostPoste = v.union(
  v.literal('acquisition'),
  v.literal('frais_acquisition'),
  v.literal('travaux'),
)

// Where a cost-basis line item takes its amount from — ONE source per item,
// chosen per item (SPEC D43). `manual` = the entered amount stands;
// `flows` = the sum of the transactions allocated to this property with this
// category. NEVER the addition of the two: that is a bug, not a feature.
export const propertyCostSource = v.union(
  v.literal('manual'),
  v.literal('flows'),
)

// Target of a generalized allocation (`transactions.allocation`). Coexists
// with `dealId`: a deal match writes both (cf. convex/transactions.ts).
//
// `transfer` is the odd one out: it is the ONLY kind that does NOT imply
// `matchStatus === 'matched'`. Both legs of an internal transfer keep
// `matchStatus: 'internal_transfer'` (a « écarté » subtype, excluded from the
// analysis) and carry `allocation.kind === 'transfer'` pointing at their
// shared `transfers` row — cf. KNOWN_ISSUES.md « Virements internes ».
//
// `loan` targets a BANK loan (`loans`), not a shareholder current account —
// `intercompany_loan` keeps that meaning. The two are unrelated: one is a
// debt to a bank, the other an advance between two group companies.
//
// `property` targets a real-estate asset (`properties`). It is the only kind
// that carries an `allocation.category` — see `allocationCategory`.
const allocationKind = v.union(
  v.literal('deal'),
  v.literal('equity'),
  v.literal('intercompany_loan'),
  v.literal('transfer'),
  v.literal('loan'),
  v.literal('property'),
)

// Nature of a flow on a property (SPEC D42) — six values, and a transaction
// carries exactly ONE. A transaction is never split: a notary transfer
// covering the price AND the duties goes whole into `acquisition`; keeping
// the detail on an old property is what the `manual` cost source is for.
//
// Three of them feed the cost basis (`acquisition`, `frais_acquisition`,
// `travaux` — the values of `propertyCostPoste`), two the operating result
// (`charges` out, `loyer` in), and one the realized capital gain
// (`revente`).
export const allocationCategory = v.union(
  v.literal('acquisition'),
  v.literal('frais_acquisition'),
  v.literal('travaux'),
  v.literal('charges'),
  v.literal('loyer'),
  v.literal('revente'),
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
  /**
   * userPrefs — per-user mutable state, deliberately OUT of the `users` row
   * (cf. KNOWN_ISSUES « Hot `users` row »). The `notify*` flags are email
   * alert opt-OUTS: absent means subscribed, so adding one needs no
   * backfill and a new member is subscribed by default. They are GLOBAL
   * (they apply to every org the user belongs to), even though the editing
   * surface lives inside an org's settings.
   */
  userPrefs: defineTable({
    userId: v.id('users'),
    lastOrgSlug: v.optional(v.string()),
    notifyCashThreshold: v.optional(v.boolean()),
    notifyOverdueEntries: v.optional(v.boolean()),
    notifyBankConnection: v.optional(v.boolean()),
    notifyIndexFailure: v.optional(v.boolean()),
    notifyReportIssues: v.optional(v.boolean()),
    notifyReportAdded: v.optional(v.boolean()),
    notifyWeeklyReports: v.optional(v.boolean()),
  }).index('by_user', ['userId']),

  /**
   * Secondary addresses a member forwards reports from — a personal Gmail, a
   * work address at another company. NOT a login: an alias only attributes an
   * INBOUND email to a member, so the report pipeline can reply to them with
   * the full confirmation instead of staying silent.
   *
   * It is not an access filter either: anyone may write to the report inbox
   * and the content analysis decides whether the mail is filed. The alias only
   * decides who is entitled to an answer.
   */
  userEmailAliases: defineTable({
    userId: v.id('users'),
    /** Lowercased, like `users.email` and the normalized `fromEmail`. */
    email: v.string(),
    addedBy: v.id('users'),
    addedAt: v.number(),
  })
    .index('by_email', ['email'])
    .index('by_user', ['userId']),

  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id('_storage')),
    createdBy: v.id('users'),
    createdAt: v.number(),
    // Months without a received report past which a participation is flagged
    // as silent (unset = DEFAULT_SILENCE_MONTHS, cf. lib/reportFreshness.ts).
    reportSilenceMonths: v.optional(v.number()),
    // Modules turned on BY HAND for this org (slugs from lib/modules.ts). A
    // module already showing because it holds something is not listed here —
    // this is the explicit override, not a display cache (SPEC D37).
    //
    // Bounded by construction: at most one entry per known module. The list
    // is deliberately NOT the source of what is visible; `modules:list`
    // derives that from « holds something OR is listed here ».
    enabledModules: v.optional(v.array(v.string())),
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
   * powensConnections — sync-health monitoring of each Powens bank
   * connection (one row per connection). Fed by BOTH the CONNECTION_SYNCED
   * webhook (push, immediate) and a 6h polling cron (pull, catches the
   * silence when webhooks stop arriving). `state` mirrors the Powens
   * connection state: null/absent = last sync OK; wrongpass, SCARequired,
   * webauthRequired, actionNeeded, passwordExpired,
   * additionalInformationNeeded = user must re-authenticate (webview
   * reconnect). Health is DERIVED at read time (cf. connectionHealth in
   * convex/powens.ts), never stored — except `notifiedHealth`, the
   * anti-spam memory of the last emailed degraded health.
   */
  powensConnections: defineTable({
    orgId: v.id('organizations'),
    powensConnectionId: v.string(),
    connectorName: v.optional(v.string()), // bank label, e.g. "Palatine"
    state: v.optional(v.string()), // Powens state code; absent = OK
    errorMessage: v.optional(v.string()), // institution hint, user-facing
    lastSuccessfulSyncAt: v.optional(v.number()), // Powens `last_update`
    nextTryAt: v.optional(v.number()), // Powens `next_try`
    active: v.optional(v.boolean()), // Powens `active` (auto-sync on/off)
    lastWebhookAt: v.optional(v.number()), // last CONNECTION_SYNCED received
    lastPolledAt: v.optional(v.number()), // last successful cron poll
    // Last degraded health emailed ('stale' | 'action_required') — cleared
    // when the connection is healthy again, so the next incident re-alerts.
    notifiedHealth: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_powens_connection', ['powensConnectionId']),

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
   * gmailAccounts — LEGACY, declared but inert. Belonged to the retired
   * emails feature (Gmail-synced portfolio email timeline); the whole
   * browsing/sync surface was removed to be rethought later. Kept declared
   * with its data until the purge-then-narrow cleanup (same convention as
   * the legacy `forecasts` table). Read by nothing.
   * `refreshToken` remains secret at rest — never expose rows publicly.
   */
  gmailAccounts: defineTable({
    orgId: v.optional(v.id('organizations')), // org fed by this mailbox
    userId: v.id('users'), // who connected the mailbox
    email: v.string(), // mailbox address, lowercase — upsert key with orgId
    refreshToken: v.string(), // OAuth refresh token — secret
    historyId: v.optional(v.string()), // incremental sync cursor
    status: v.union(
      v.literal('connected'),
      v.literal('reauth_required'),
      v.literal('error'),
    ),
    lastError: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    // Anti-spam guard of the reauth alert email: set when the alert for the
    // current incident went out, cleared on reconnect (cf. Powens
    // `notifiedHealth`, same convention).
    reauthNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_and_email', ['orgId', 'email'])
    .index('by_user', ['userId']),

  /**
   * gmailOAuthStates — LEGACY, declared but inert (retired emails feature,
   * same convention as `gmailAccounts`). Short-lived anti-CSRF tokens of the
   * removed Gmail OAuth flow. Read by nothing.
   */
  gmailOAuthStates: defineTable({
    orgId: v.optional(v.id('organizations')),
    userId: v.id('users'),
    state: v.string(),
    returnTo: v.string(), // in-app path to land back on after the callback
    createdAt: v.number(),
  }).index('by_state', ['state']),

  /**
   * externalConnections — org-scoped connections to external platforms whose
   * auth kind is `credentials` (cf. `convex/lib/connectors.ts`, the registry).
   * Generic storage managed by the common core `convex/connections.ts`;
   * `platform` is the registry key ('vasco', …), `config` holds the platform's
   * non-secret settings (e.g. `clientSlug`), `credentials` its secrets. The
   * shape of both records is validated against the registry declaration
   * (`parseConnection`), never hand-checked per platform.
   *
   * One row per connection per org: e.g. `vasco/Parallel → Calte` and
   * `vasco/Parallel → Albo` are two rows. Each connection feeds exactly one
   * org, so pulled data stays within that org's tenant boundary.
   *
   * INTERNAL: `credentials` is secret at rest, never exposed to the front
   * end. Read/written only by internalQuery/internalMutation
   * (cf. convex/connections.ts). Do NOT return a raw row from a public
   * query — it would leak the credentials (same rule as `powensUsers`).
   */
  externalConnections: defineTable({
    orgId: v.id('organizations'), // Albo OS org fed by this connection
    platform: v.string(), // registry key — cf. convex/lib/connectors.ts
    label: v.string(), // human label, e.g. "Parallel — Calte"
    config: v.optional(v.record(v.string(), v.string())), // non-secret settings
    credentials: v.optional(v.record(v.string(), v.string())), // secrets at rest
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.optional(v.id('users')),
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_and_platform', ['orgId', 'platform'])
    .index('by_platform', ['platform']),

  /**
   * vascoConnections — LEGACY, declared but inert. Superseded by
   * `externalConnections` (platform 'vasco') via the one-shot
   * `migrations/externalConnections:migrateVascoConnections` — cf.
   * `MIGRATIONS.md`. Kept declared until the purge-then-narrow cleanup
   * (same convention as the legacy `forecasts` table). Read by nothing.
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

  /**
   * vascoPortfolioIssuers — the SPVs (issuers) the org actually HOLDS on
   * VASCO/Parallel, derived from `Account.portfolio.active`
   * (`ActiveParticipation.issuerId`), independent of any communication. Lets a
   * held SPV be linked even before it has emitted a single communication (e.g.
   * a freshly closed SPV). `issuerId` is the issuer's Company id — the **same**
   * id space as `Communication.issuer.id` — so a link made from here catches
   * that issuer's future communications. (The direct `portfolio.active` scalars
   * are used because `accountSecurityContracts.security.company` is masked to
   * the investor persona — cf. KNOWN_ISSUES.md "VASCO API".) Same cache
   * discipline as `vascoCommunicationsCache`: reactive read, replaced wholesale
   * per (orgId, clientSlug) on each refresh.
   */
  vascoPortfolioIssuers: defineTable({
    orgId: v.id('organizations'),
    clientSlug: v.string(),
    issuerId: v.string(), // issuer Company id (== Communication.issuer.id)
    issuerLabel: v.optional(v.string()),
    securityName: v.optional(v.string()), // reserved (unused with portfolio.active)
    fetchedAt: v.number(),
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
    // Fiche KPI cible: metric-catalog keys tracked for this company. Drives
    // the report-extraction grid and the recap checklist (✅/⚠️ per target).
    // Absent/empty → fall back to the implicit memory (metrics already seen).
    // Keys validated against the catalog in mutations (sanitizeKpiTargets).
    kpiTargets: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    // Founders / board / co-investors. Display-only list (Lot 5a backend; UI
    // in Lot 5b). Each entry is either Attio-linked (attioRecordId) or free.
    people: v.optional(v.array(personValidator)),
    archivedAt: v.optional(v.number()),
    // ── Report freshness (denormalized from `companyReports`) ──────────────
    // Reception date of the most recent report, and the most recent period it
    // covered. Both are DERIVED — the authoritative rows stay in
    // `companyReports`. They live here because silence detection needs two
    // numbers per company, and Convex reads whole rows: scanning the reports
    // to recompute them re-read every report's `rawContent`/`cleanedHtml` on
    // every render of the participations list.
    //
    // Maintained on BOTH sides of the table's lifecycle (lib/reportFreshness):
    // `recordReportOnCompany` at ingestion, monotonic (max) so a back-dated
    // report never rewinds them; `recomputeReportFreshness` on detach, which
    // rebuilds from what is left — a monotonic write cannot walk back, and
    // detaching the last report has to put the entity back in silence.
    // `migrations/backfillReportFreshness` rebuilds both if they ever drift.
    // Absent = no report yet.
    lastReportAt: v.optional(v.number()), // ms epoch
    lastReportCoverageAt: v.optional(v.number()), // ms epoch
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

    // Share-based (share, spv_share, SCI shares…)
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
    // Placement liquidity override; default derived from instrumentKind.
    liquidity: v.optional(placementLiquidity),
    // The bank account backing a treasury placement — envelope link for
    // Powens Wealth positions (cf. investmentPositions).
    bankAccountId: v.optional(v.id('bankAccounts')),

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
   *
   * A row with `dealId` set is a DEAL document (term sheet, pacte,
   * subscription form…). It shows on BOTH surfaces: the deal sheet lists its
   * own (`by_deal`), and the company timeline lists everything filed under the
   * entity, deal documents included — a pacte binds the legal entity, so
   * hiding it from the entity would be the trap. One row, two views: `dealId`
   * is a label, never a second copy.
   *
   * `companyId` is OPTIONAL since the Dette & Garanties module: a loan deed
   * has no portfolio company to hang off, and no honest value to give the
   * field. `orgId` — never optional — is what carries the tenancy; the
   * anchors (`companyId` / `dealId` / `loanId` / `guaranteeId` /
   * `propertyId`) are labels on top of it, and `documents:create` requires
   * at least one of them to resolve the org.
   *
   * ⚠️ A row with no `companyId` is INVISIBLE to the `by_company` index (a
   * missing value never equals an id), so it never shows on a company sheet.
   * That is intended: it is reachable from its own anchor's sheet, from the
   * org-wide semantic search, and from `by_org`.
   */
  documents: defineTable({
    orgId: v.id('organizations'),
    companyId: v.optional(v.id('companies')),
    dealId: v.optional(v.id('deals')),
    // Bank loan this deed hangs off (offer letter, amortization table).
    loanId: v.optional(v.id('loans')),
    // Guarantee deed (nantissement, hypothèque, acte de caution).
    guaranteeId: v.optional(v.id('guarantees')),
    // Real-estate deed (acte de vente, compromis, devis de travaux).
    propertyId: v.optional(v.id('properties')),
    title: v.string(),
    // Company kinds first, then the deal-specific ones. One widened union
    // rather than two columns: which subset is offered is a UI concern.
    kind: v.union(
      v.literal('reporting'),
      v.literal('bp'),
      v.literal('legal'),
      v.literal('other'),
      v.literal('term_sheet'),
      v.literal('pacte'),
      v.literal('subscription'),
      v.literal('attestation'),
      // Debt & guarantees deeds — no company target at all.
      v.literal('acte_pret'),
      v.literal('acte_garantie'),
    ),
    // Company docs: covered period (month). Deal docs: the document's own
    // date (signature…). Same storage, the label differs per surface.
    period: v.optional(v.number()), // ms epoch
    storageId: v.id('_storage'),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    source: v.union(v.literal('upload'), v.literal('email')),
    uploadedBy: v.optional(v.id('users')),
    uploadedAt: v.number(),
    // ── Email ingestion (AgentMail report pipeline) ───────────────────────
    // Set when the file arrives as an email attachment. `reportId` links the
    // file to its `companyReports` row; `inline` flags inline images (cid:)
    // which are hidden from the Docs tab. All optional → manual uploads
    // leave them unset.
    reportId: v.optional(v.id('companyReports')),
    inline: v.optional(v.boolean()),
    // ── Text extraction (Mistral OCR / parsers) ───────────────────────────
    // Reading state of the file, surfaced per document in the front:
    // 'pending' = queued, 'extracted' = text obtained, 'skipped' = nothing to
    // read (logo-sized image, unsupported format), 'failed' = tried and
    // failed. `ocrDetail` is a machine code from the SAME vocabulary as
    // `inboundEmails.sources[].detail` ('ocr_failed', 'small_image_skipped',
    // …) so the front and the recap email speak the same language. The text
    // itself lives in `documentTexts` — see that table for why. Undefined on
    // rows predating the feature (displayed as "not analysed").
    ocrState: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('extracted'),
        v.literal('skipped'),
        v.literal('failed'),
      ),
    ),
    ocrDetail: v.optional(v.string()),
    ocrChars: v.optional(v.number()),
    // ── Semantic indexing (vectorize.ts) ──────────────────────────────────
    // Same trace mechanic as `ocrState`, one pipeline layer further down:
    // 'pending' = queued or retrying, 'indexed' = searchable, 'skipped' =
    // nothing to index (email rows live in their report's entry, inline
    // images, no extracted text), 'failed' = indexing failed after retries
    // (org members get an email — never a silent failure). `vectorDetail`
    // is a machine code naming the failing layer (cf. vectorize.ts
    // `classifyIndexError`). Undefined on rows never submitted for indexing.
    vectorState: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('indexed'),
        v.literal('skipped'),
        v.literal('failed'),
      ),
    ),
    vectorDetail: v.optional(v.string()),
    // LEGACY — read by nothing, written by nothing in this repo, but prod rows
    // carry it (the text was put there out-of-band, before `documentTexts`
    // existed). Removing it fails `convex deploy` on schema validation:
    // "Object contains extra field `extractedText` that is not in the
    // validator". Purge the data first, then drop the field — cf. MIGRATIONS.md.
    extractedText: v.optional(v.string()),
  })
    .index('by_company', ['companyId', 'uploadedAt'])
    .index('by_deal', ['dealId', 'uploadedAt'])
    .index('by_loan', ['loanId', 'uploadedAt'])
    .index('by_guarantee', ['guaranteeId', 'uploadedAt'])
    .index('by_property', ['propertyId', 'uploadedAt'])
    .index('by_org', ['orgId'])
    .index('by_report', ['reportId'])
    // Reading states, oldest first — read by the sweeper that picks up the
    // documents whose extraction never came back (documentsExtract.ts
    // `sweepStalePending`). Low cardinality on the first field is fine: the
    // sweeper only ever ranges over the 'pending' bucket.
    .index('by_ocr_state', ['ocrState', 'uploadedAt']),

  /**
   * documentTexts — the extracted text of a stored file. ONE row per storage
   * blob, NOT per document: the report fan-out creates one `documents` row
   * per matched entity around a single shared blob, and the extracted text
   * is a property of the file, not of the row pointing at it.
   *
   * Kept out of `documents` on purpose: Convex reads whole rows, so a
   * ~900k-char field there would be re-read for every row on every Documents
   * tab open. Here it is only read when the user opens the text.
   * `truncated` marks a file whose text hit MAX_DOCUMENT_CHARS.
   */
  documentTexts: defineTable({
    storageId: v.id('_storage'),
    text: v.string(),
    truncated: v.boolean(),
  }).index('by_storage', ['storageId']),

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
    // Back-link to the row that produced this report, so detaching an entity
    // can correct the queue side too (cf. reportInbox.detachCompany). Unset on
    // rows stored before the field existed: an email-sourced one is found back
    // through `agentmailMessageId`, an upload has no way home.
    inboundEmailId: v.optional(v.id('inboundEmails')),
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
      v.union(v.literal('company_self'), v.literal('fund_portfolio_company')),
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
    // Semantic indexing of `rawContent` — same trace as documents.vectorState
    // (cf. that field's comment; reports have no per-row UI, the backfill
    // retries their failures).
    vectorState: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('indexed'),
        v.literal('skipped'),
        v.literal('failed'),
      ),
    ),
    vectorDetail: v.optional(v.string()),
    // Provenance anchor of the one-shot Albo app import: the uuid of the
    // Supabase `company_reports` row this came from. Sole idempotency key of
    // that import — cf. `convex/migrations/alboReportsImport.ts`. Unset on
    // every row born from the email pipeline or a manual upload.
    alboReportId: v.optional(v.string()),
  })
    .index('by_company', ['companyId', 'periodSortDate'])
    .index('by_org', ['orgId'])
    .index('by_message_id', ['agentmailMessageId'])
    .index('by_company_period', ['companyId', 'reportPeriod'])
    .index('by_albo_report', ['alboReportId']),

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
   *
   * A row can also be born from a MANUAL upload (`origin: 'upload'`, created
   * by `reportInbox.createFromUpload` from the company sheet): same table so
   * the whole pipeline downstream of identification runs unchanged. Those
   * rows carry no real AgentMail message — never call AgentMail with their
   * ids (cf. the guard in `reportNotify.send`).
   */
  inboundEmails: defineTable({
    // Absent = email (the historical case). 'upload' = manual upload from the
    // front: the AgentMail ids below are placeholders, the company is already
    // matched, and the pipeline starts at extraction (brick 4).
    origin: v.optional(v.union(v.literal('email'), v.literal('upload'))),

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
          state: v.union(
            v.literal('extracted'),
            v.literal('stored'),
            v.literal('failed'),
          ),
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
    // Outcome the last notification announced. A manual replay ("Retraiter" /
    // "Rattacher") no longer clears `notifiedAt`, so this is what decides
    // whether a REPLAY may speak again: only a row whose last word was a
    // problem earns one more mail, and only to say it finally went through.
    // Absent on rows notified before this field existed — treated as final
    // (silence), because the bug this closes was an excess of mail.
    notifiedKind: v.optional(
      v.union(
        v.literal('success'),
        v.literal('duplicate'),
        v.literal('failure'),
        v.literal('quarantine'),
      ),
    ),
    // Automatic recovery from a TRANSIENT model failure (aborted request,
    // provider saturation). The step is carried alongside the counter so each
    // brick gets its own budget without anyone having to reset it: a failure
    // on a step other than `retryStep` starts back at 1.
    retryStep: v.optional(v.union(v.literal('identify'), v.literal('analyze'))),
    retryAttempts: v.optional(v.number()),
  })
    .index('by_message_id', ['agentmailMessageId'])
    .index('by_status', ['status']),

  /**
   * companyEmails — LEGACY, declared but inert (retired emails feature).
   * Was the portfolio email timeline: one row per message, deduplicated
   * across mailboxes by the RFC `Message-ID` header, stored in full with
   * attachments in Convex storage. Kept declared with its data until the
   * purge-then-narrow cleanup (same convention as the legacy `forecasts`
   * table). Read by nothing.
   */
  companyEmails: defineTable({
    headerMessageId: v.string(), // RFC Message-ID — dedup key
    gmailMessageId: v.optional(v.string()), // Gmail id of the first sighting
    gmailThreadId: v.optional(v.string()), // thread of the first sighting
    subject: v.string(),
    snippet: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmails: v.array(v.string()),
    ccEmails: v.array(v.string()),
    sentAt: v.number(), // ms epoch (Gmail internalDate)
    direction: v.union(v.literal('incoming'), v.literal('outgoing')),
    accountEmails: v.array(v.string()), // connected mailboxes that saw it
    // Downloaded attachments (matched messages only, ≤ 20 MB each, inline
    // signature images skipped). Bounded: a mail carries a handful of files.
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.optional(v.string()),
          size: v.optional(v.number()),
          storageId: v.id('_storage'),
        }),
      ),
    ),
  }).index('by_header_message_id', ['headerMessageId']),

  /**
   * companyEmailLinks — LEGACY, declared but inert (retired emails feature,
   * same convention as `companyEmails`). Join table email ↔ matched company.
   * Read by nothing.
   */
  companyEmailLinks: defineTable({
    companyId: v.id('companies'),
    orgId: v.id('organizations'),
    emailId: v.id('companyEmails'),
    sentAt: v.number(),
    // How the link was found: 'participant_domain' | 'body_domain' |
    // 'name_mention' | 'llm_direct' | 'llm_indirect'. Absent on links
    // created before the matching cascade shipped.
    matchMethod: v.optional(v.string()),
  })
    .index('by_company_and_sentAt', ['companyId', 'sentAt'])
    .index('by_org_and_sentAt', ['orgId', 'sentAt'])
    .index('by_email', ['emailId']),

  // ─── Bank debt (loans + dated rate series) ────────────────────────────────

  /**
   * loans — a bank loan taken out by a group company. `orgId` is the
   * BORROWING company (one legal entity = one org).
   *
   * NO "capital outstanding" field, by the same philosophy as the current
   * account balances (KNOWN_ISSUES.md § Passif): a stored figure drifts, a
   * derived one cannot. The schedule is recomputed on every read by the pure
   * engine `convex/lib/amortization.ts` — nothing about it is stored either,
   * not even a table of instalments.
   *
   * The ONE exception: on a `revolving` (lombard) credit there is no schedule
   * to derive anything from, so `principalCents` holds the CURRENT
   * OUTSTANDING, entered by hand. Documented limitation, not an oversight.
   */
  loans: defineTable({
    orgId: v.id('organizations'), // borrowing company
    label: v.string(), // "Prêt Palatine 2021"
    lenderName: v.string(), // free text — no lender registry (cf. SPEC Q-D)
    // Amount borrowed. On a `revolving`: the current outstanding (see above).
    principalCents: v.number(),
    signedDate: v.number(), // ms epoch
    firstPaymentDate: v.number(), // ms epoch — anchors the whole schedule
    // TOTAL duration, deferral included. Absent on a revolving only.
    durationMonths: v.optional(v.number()),
    amortizationKind,
    creditLimitCents: v.optional(v.number()), // revolving: authorized ceiling
    rateBps: v.number(), // rate AT SIGNATURE (1100 = 11 %)
    rateKind: loanRateKind,
    insuranceMonthlyCents: v.optional(v.number()), // OUTSIDE the instalment
    paymentFrequency: loanPaymentFrequency,
    deferralMonths: v.optional(v.number()),
    deferralKind: v.optional(loanDeferralKind),
    // Bound of the interest projection of a revolving, when the credit has a
    // known end. Absent = projected up to the forecast horizon.
    endDate: v.optional(v.number()),
    bankAccountId: v.optional(v.id('bankAccounts')), // direct-debit account, same org
    status: loanStatus,
    notes: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_status', ['orgId', 'status'])
    .index('by_bank_account', ['bankAccountId']),

  /**
   * loanRates — dated revisions of a VARIABLE rate. A table rather than an
   * array on the loan: over twenty years of quarterly revisions the series
   * grows without bound, and `loans` is read as a list on the Passif page —
   * exactly the anti-pattern of CLAUDE.md (Convex reads and bills the whole
   * row).
   *
   * Rule of the rate applicable to a date: the last step whose
   * `fromDate <= date`, falling back to `loans.rateBps`. A fixed-rate loan
   * therefore has NO row here.
   */
  loanRates: defineTable({
    orgId: v.id('organizations'),
    loanId: v.id('loans'),
    fromDate: v.number(), // ms epoch, effective date
    rateBps: v.number(),
    kind: loanRateStepKind,
    notes: v.optional(v.string()),
  }).index('by_loan_from', ['loanId', 'fromDate']),

  /**
   * loanAmendments — dated amendments to a loan's terms, the « Mettre à jour
   * au JJ/MM » gesture (SPEC D35).
   *
   * NOT to be confused with the two neighbours it sits between:
   * - « Corriger » (`loans:update`) OVERWRITES the terms, as if the previous
   *   ones had never existed. That is for a typo — the app cannot tell one
   *   from an amendment, so the user says which it is.
   * - `loanRates` carries the revisions of a VARIABLE rate that the contract
   *   itself provides for. Revising a rate as planned is not amending the
   *   contract.
   *
   * An amendment KEEPS the history: the instalments already run under the
   * old terms stay as they were, and the new terms apply to the capital that
   * remains. Only the fields it changes are set; the rest carries over.
   *
   * Nothing derivable is stored here either — `outstandingCents` is the ONE
   * optional exception, for when the lender restates the capital at the
   * effective date and its figure must win over the derived one.
   */
  loanAmendments: defineTable({
    orgId: v.id('organizations'),
    loanId: v.id('loans'),
    effectiveDate: v.number(), // ms epoch
    rateBps: v.optional(v.number()),
    durationMonths: v.optional(v.number()), // REMAINING from the effective date
    amortizationKind: v.optional(amortizationKind),
    paymentFrequency: v.optional(loanPaymentFrequency),
    insuranceMonthlyCents: v.optional(v.number()),
    outstandingCents: v.optional(v.number()), // restated by the lender
    notes: v.optional(v.string()),
  }).index('by_loan_from', ['loanId', 'effectiveDate']),

  /**
   * guarantees — the link between a debt and the security that covers it.
   * The central table of the Dette & Garanties module.
   *
   * ONE row, THREE independent pieces of information (SPEC D17), and hence
   * three readings of the very same row (D13) — nothing is stored twice:
   * - `form` — the kind of hold: nantissement, hypothèque, PPD, caution,
   *   garantie d'organisme.
   * - `subject*` — what is pledged. Read from the ASSET's sheet: « this
   *   contract is pledged for the benefit of SCI Chapelle ».
   * - `pledgor*` — who commits. Read from the GUARANTOR's page: « I stood
   *   surety for RDB ».
   *
   * The polymorphic pattern is `equityPositions`' (several optional fields
   * discriminated by a nature field), NOT `transactions.allocation`'s, whose
   * untyped `targetId: string` would lose the referential integrity that
   * matters most here.
   *
   * A guarantee may cross two orgs (the loan in `sci-chapelle`, the asset in
   * `calte`), so `requireOrgMember` is not enough on its own:
   * `requireGuaranteeParty` (convex/guarantees.ts) requires membership of at
   * least ONE of the parties, mirroring `requireLoanParty`. Orgs stay flat —
   * no inheritance of rights.
   *
   * The beneficiary can be OUTSIDE the group (`borrowerLabel`, SPEC D-QA):
   * without those rows the available margin on our own asset would be
   * overstated — an error in our disfavour, and an invisible one.
   */
  guarantees: defineTable({
    // ── Beneficiary: EITHER a group loan, OR an outside borrower ──────────
    loanId: v.optional(v.id('loans')),
    // Denormalized from the loan, never taken from an argument — it is what
    // the `by_borrower_org` index reads.
    borrowerOrgId: v.optional(v.id('organizations')),
    borrowerLabel: v.optional(v.string()), // "SARL Bremontier"

    // ── The guarantor: a group company, a free label, or unknown ──────────
    // Unknown is a real case: the source deeds name a caution without saying
    // who stands it (SPEC Q-B). A personal caution is a LABEL, never a
    // person object — no natural person exists in Albo OS (D1, D46).
    pledgorOrgId: v.optional(v.id('organizations')),
    pledgorLabel: v.optional(v.string()), // "Saccef", "Clément Alteresco"

    // ── The subject ───────────────────────────────────────────────────────
    subjectKind: guaranteeSubjectKind,
    subjectDealId: v.optional(v.id('deals')), // 'placement'
    subjectPropertyId: v.optional(v.id('properties')), // 'property'
    subjectCompanyId: v.optional(v.id('companies')), // 'shares'
    // Org the subject lives in, denormalized from it — a party for the
    // authorization check.
    subjectOrgId: v.optional(v.id('organizations')),
    subjectLabel: v.optional(v.string()), // 'external'

    // ── The pledge ────────────────────────────────────────────────────────
    form: guaranteeForm,
    rank: v.optional(v.number()), // 1 = first rank, 2 = second… (D48)
    // Absent = not quantified (an unlimited caution). EXCLUDED from the
    // pledged total and listed apart: showing it as 0 would lie (C3).
    pledgedAmountCents: v.optional(v.number()),
    actDate: v.optional(v.number()),
    // Mainlevée. Absent = active. The row STAYS (history) but leaves the
    // pledged total (C6).
    releasedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index('by_loan', ['loanId'])
    .index('by_borrower_org', ['borrowerOrgId'])
    .index('by_pledgor_org', ['pledgorOrgId'])
    .index('by_subject_deal', ['subjectDealId'])
    .index('by_subject_property', ['subjectPropertyId'])
    .index('by_subject_company', ['subjectCompanyId']),

  // ─── Real estate (properties + their valuations) ──────────────────────────

  /**
   * properties — a real-estate asset held by a group company.
   *
   * A first-class object because a PPD or a mortgage has to bite on
   * something (SPEC D20), and because « what does this SCI own, what is it
   * worth, what does it earn » had no answer in the app.
   *
   * NO amount is entered outside `costBasis`. The `purchasePriceCents` /
   * `notaryFeesCents` / `worksCents` columns of the first draft are gone:
   * they duplicated the matched flows (D43). Rents and charges are likewise
   * never entered — they are the transactions allocated to the property.
   *
   * No `detention` field either: the property lives in the org that holds
   * it, and a second place to say so would be a second truth.
   *
   * Every amount of a property is TAX-INCLUSIVE (D49). They come from bank
   * flows, and a bank flow is tax-inclusive by nature.
   */
  properties: defineTable({
    orgId: v.id('organizations'), // holding company (D20)
    name: v.string(), // "18 rue de la Chapelle"
    address: v.string(),
    propertyType: propertyAssetType,
    usage: propertyUsage,
    surfaceSqm: v.optional(v.number()),
    // Date of acquisition, for the sheet's subtitle and the exit IRR anchor.
    acquiredDate: v.optional(v.number()), // ms epoch

    /**
     * Cost basis, ONE source per line item (D43) — and the choice is per
     * item, because a property bought in 2019 (before the bank connection)
     * needs `manual` on its price while its 2024 works come from `flows`.
     * A global switch would force sacrificing one or the other.
     *
     * Bounded by construction: at most one row per `propertyCostPoste`, so
     * three — this array can never grow into the anti-pattern of an
     * unbounded list on a row read in a list.
     *
     * `manualAmountCents` is KEPT when the source is `flows`, so switching
     * back does not mean re-typing it. It is simply not read.
     */
    costBasis: v.array(
      v.object({
        poste: propertyCostPoste,
        source: propertyCostSource,
        manualAmountCents: v.optional(v.number()),
      }),
    ),

    status: propertyStatus,
    saleDate: v.optional(v.number()),
    salePriceCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_status', ['orgId', 'status']),

  /**
   * propertyValuations — the value of a property over time.
   *
   * A table of its own rather than `valuations`, which requires a `dealId`.
   * Same shape, same « last known value » reading. No automatic estimate:
   * no PriceHubble, no third-party API (D20) — `source` is a free label
   * ("estimation agence", "notaire", "à dire d'expert").
   */
  propertyValuations: defineTable({
    orgId: v.id('organizations'),
    propertyId: v.id('properties'),
    asOf: v.number(), // ms epoch
    valueCents: v.number(),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index('by_property_asof', ['propertyId', 'asOf'])
    .index('by_org_asof', ['orgId', 'asOf']),

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
    // Ownership share in BASIS POINTS (6000 = 60 %). The % lives HERE and
    // nowhere else (SPEC D33): the issuing company's cap table is the truth,
    // and the equity deal on CALTE's side READS it instead of re-entering it.
    // Two entries would diverge.
    ownershipBps: v.optional(v.number()),
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
   * investmentPositions — mirrors of Powens Wealth investments: the
   * securities held inside a compte-titres / contrat de capitalisation /
   * crypto account (`bankAccounts` row resolved via `powensAccountId`).
   * Rows are replaced wholesale per account at each sync (convex/
   * investments.ts) — no uniqueness constraint needed.
   */
  investmentPositions: defineTable({
    orgId: v.id('organizations'),
    bankAccountId: v.id('bankAccounts'),
    powensInvestmentId: v.string(),
    label: v.string(),
    isinCode: v.optional(v.string()),
    quantity: v.optional(v.number()), // units, float
    unitValue: v.optional(v.number()), // cents
    valuation: v.optional(v.number()), // cents
    diff: v.optional(v.number()), // cents, +/- vs cost
    valuationDate: v.optional(v.number()), // ms epoch (vdate)
    syncedAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_account', ['bankAccountId']),

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
    // Generalized matching: deal, equity position, inter-entity loan or
    // internal transfer. Coexists with `dealId`: `dealId != null` ⟺
    // `allocation.kind === 'deal'` (backfill: transactions:backfillAllocation).
    // `targetId` is the target's _id, stored as a string (no cross-table
    // v.id() union). `kind === 'transfer'` is the only kind that leaves
    // `matchStatus` at 'internal_transfer' instead of 'matched'.
    //
    // `category` says WHAT the flow is on its target — used by `property`
    // only, where it decides whether the amount enters the cost basis, the
    // operating result or the capital gain. Do NOT confuse it with the
    // top-level `category` below, which is the treasury slug of a
    // charge/product and is CLEARED by every allocation.
    allocation: v.optional(
      v.object({
        kind: allocationKind,
        targetId: v.string(),
        category: v.optional(allocationCategory),
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
    // Ledger filters by nature of the attachment ("mes investissements", "mes
    // mouvements de compte courant") — `matchStatus` alone cannot tell them
    // apart, they all sit under 'matched'.
    .index('by_org_allocation_kind', ['orgId', 'allocation.kind'])
    .index('by_airtable_id', ['airtableId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['orgId', 'matchStatus', 'bankAccountId'],
    }),

  /**
   * transfers — internal transfer between two bank accounts of the SAME legal
   * entity (`bankAccounts.ownerCompanyId`), possibly across banks. One row per
   * transfer; its two legs are the transactions carrying
   * `allocation = { kind: 'transfer', targetId: <transferId> }`, both kept at
   * `matchStatus: 'internal_transfer'` so they stay excluded from the analysis
   * (`lib/categories.ts:effectiveCategory` → null).
   *
   * DELIBERATELY almost empty: amount, dates, amount gap (bank fees) and
   * in-transit delay are ALWAYS derived from the two legs, never stored —
   * same principle as the C/C balances (`convex/liabilities.ts`). A row with
   * a single allocated leg IS the representation of an incomplete transfer:
   * nothing extra to flag it.
   *
   * `ownerCompanyId` is the invariant anchor: both legs must sit on accounts
   * owned by this entity. A movement between two DIFFERENT entities is not an
   * internal transfer — it is pointed to that entity like a deal
   * (cf. KNOWN_ISSUES.md « Virements internes »).
   */
  transfers: defineTable({
    orgId: v.id('organizations'),
    ownerCompanyId: v.id('companies'), // must be a "group_*"
    createdBy: v.id('users'),
  }).index('by_org', ['orgId']),

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
   * balance. Evaluated weekly by cron (forecasts.sendWeeklyDigest), which
   * emails the members subscribed to that alert. `lastNotifiedAt` records
   * the last breach reported — the weekly cadence IS the anti-spam, so it
   * no longer gates anything.
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
   * "rule:{ruleId}:{YYYY-MM-DD}", "loan:{loanId}:{YYYY-MM-DD}" (an
   * instalment derived from a bank loan's computed schedule — cf.
   * convex/forecasts.ts:expandLoanSchedules), "vat:{orgId}:{YYYY-Qn}" (quarterly VAT
   * suggestion — no ruleId, so the row stays a plain editable one-off),
   * "airtable:{recordId}" (one-shot port of the Airtable forecast tables —
   * cf. convex/migrations/airtableForecastsToEntries.ts, likewise a plain
   * one-off) or "deal:{dealId}:{YYYY-MM-DD}" for the future deriveFromDeals.
   * Null for 100 % manual rows.
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
    // Optional bank-loan link, symmetric to `dealId`: an instalment derived
    // from a loan's schedule (`derivedKey` "loan:{loanId}:{YYYY-MM-DD}").
    loanId: v.optional(v.id('loans')),
    derivedKey: v.optional(v.string()),
    overridden: v.boolean(),
    realizedTransactionId: v.optional(v.id('transactions')), // filled on matching
    // Attio-synced deal entry with no `date_de_l_investissement`: the `date` is
    // a placeholder (end of the creation month) and the UI prompts for a real
    // one. Cleared when a date is set (Attio resync or manual edit).
    dateMissing: v.optional(v.boolean()),

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
    .index('by_deal', ['dealId'])
    .index('by_loan', ['loanId']),

  /**
   * todos — manual tasks of the « To do » tab (convex/todo.ts). Only the
   * hand-written items live here: the automatic signals of that tab
   * (transactions to reconcile, degraded bank connections, overdue forecast
   * entries, silent portfolio companies) are DERIVED at read time from their
   * own tables and never stored.
   */
  todos: defineTable({
    orgId: v.id('organizations'),
    title: v.string(),
    status: v.union(
      v.literal('open'),
      v.literal('in_progress'),
      v.literal('done'),
    ),
    createdBy: v.id('users'),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    assigneeUserId: v.optional(v.id('users')),
    companyId: v.optional(v.id('companies')),
  }).index('by_org', ['orgId']),
})
