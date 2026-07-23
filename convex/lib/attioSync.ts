/**
 * Pure decision logic for the Attio → Albo OS deal sync. The Convex module
 * (convex/attioSync.ts) is a thin shell that reads/writes the DB around these
 * functions; the invariants live here so they can be unit-tested without a
 * Convex harness (tests/attioSync.test.ts) — same split as lib/recurrence.ts.
 */

import type { InstrumentKind } from './instruments'

/** Attio deal-stage status ids the sync acts on (match on id, never the label). */
export const TERM_SHEET_STATUS_ID = 'bb580481-f95e-42f7-a21e-ee974ac6a7cc'
export const INVESTED_STATUS_ID = 'b59066ed-7ae6-4893-949e-a5540abdaf13'

/** Attio `albo_or_calte` select option id → Albo OS org slug. */
const ORG_OPTION_TO_SLUG = new Map<string, string>([
  ['18a7bf8e-bc09-4750-9b07-0539f2179ac1', 'calte'], // 🛩️ Calte
  ['77b86c7e-ced4-4c34-b2e2-3278591ad00f', 'albo'], // 🌍 Albo
])
export function orgSlugFromOption(optionId: string | null): string | undefined {
  return optionId ? ORG_OPTION_TO_SLUG.get(optionId) : undefined
}

/** Attio `type_d_invest` option title → instrumentKind. */
const INSTRUMENT_MAP = new Map<string, InstrumentKind>([
  ['Share', 'share'],
  ['Fund', 'fund_lp'],
  ['OCA', 'oc'],
  ['Obligation', 'os'],
  ['BSA', 'bsa'],
  ['BSA Air', 'bsa_air'],
  ['CCA', 'cca'],
  ['Royalties', 'royalty'],
  // A secondary is an equity deal: the `share` instrument carries the buy,
  // the "secondary" nature lives on the round type (secondaryRoundFromInstrumentRaw).
  ['Secondary Shares', 'share'],
  ['Convertible Note', 'convertible_note'],
  ['SPV SAFE', 'safe'],
  ['SPV Share', 'spv_share'],
])

/** Absent / unmapped Attio instrument → 'unknown' (never guesses). */
export function resolveInstrumentKind(title: string | null): InstrumentKind {
  return (title ? INSTRUMENT_MAP.get(title) : undefined) ?? 'unknown'
}

/**
 * 'Secondary Shares' maps to the `share` instrument (see INSTRUMENT_MAP), with
 * the secondary nature carried by the round type. Returns the round to preset,
 * or undefined. Applied on create only — never overwrites a later manual edit.
 */
export function secondaryRoundFromInstrumentRaw(
  title: string | null,
): 'secondary' | undefined {
  return title === 'Secondary Shares' ? 'secondary' : undefined
}

/**
 * On patch: replace the instrument only when the incoming one is known and
 * different. A missing Attio instrument (`unknown`) must never downgrade a
 * known instrument on an existing deal.
 */
export function shouldReplaceInstrument(
  incoming: InstrumentKind,
  current: InstrumentKind,
): boolean {
  return incoming !== 'unknown' && incoming !== current
}

/** Placeholder name for a sync-created target company with no Attio identity. */
export const ATTIO_STUB_COMPANY_NAME = 'Société (Attio)'

/**
 * Identity patch for the deal's target company on a Term Sheet refresh, or
 * null when nothing should change. Renames ONLY sync-created stubs — a stub
 * is a company still named after the deal (or the generic placeholder), i.e.
 * the name the create path gave it when the Attio company identity was
 * unavailable. Any other name is user data and is never overwritten. The
 * domain is only ever filled when missing, never replaced.
 */
export function companyIdentityPatch(opts: {
  companyName: string | null
  companyDomain: string | null
  current: { name: string; domain?: string | null }
  /** Deal names the stub may carry (DB name, incoming Attio deal name). */
  stubNames: ReadonlyArray<string | null | undefined>
}): { name?: string; domain?: string } | null {
  const patch: { name?: string; domain?: string } = {}

  const incomingName = opts.companyName?.trim()
  const isStub =
    opts.current.name === ATTIO_STUB_COMPANY_NAME ||
    opts.stubNames.some((n) => n != null && n.trim() === opts.current.name)
  if (incomingName && incomingName !== opts.current.name && isStub) {
    patch.name = incomingName
  }

  const incomingDomain = opts.companyDomain?.trim()
  if (incomingDomain && !opts.current.domain) {
    patch.domain = incomingDomain
  }

  return Object.keys(patch).length > 0 ? patch : null
}

export type DealStatus =
  | 'pending'
  | 'active'
  | 'partially_exited'
  | 'fully_exited'
  | 'written_off'

/** Lifecycle rank — status is forward-only (never moves to a lower rank). */
const STATUS_RANK: Record<DealStatus, number> = {
  pending: 0,
  active: 1,
  partially_exited: 2,
  fully_exited: 3,
  written_off: 3,
}

/** Forward-only: true iff `to` is a strictly higher lifecycle rank than `from`. */
export function advancesStatus(from: DealStatus, to: DealStatus): boolean {
  return STATUS_RANK[to] > STATUS_RANK[from]
}

/**
 * One stable forecast entry per deal. The key omits the date on purpose so it
 * survives the Term Sheet → Invested date change (the date lives in the entry).
 */
export function dealForecastKey(dealId: string): string {
  return `deal:${dealId}`
}

/**
 * What the sync should do for a stage event, given the deal already in Albo OS
 * (`null` = none). Pure — the DB work happens in the caller. Encodes the two
 * invariants the whole feature rests on:
 *   1. a deal is CREATED only on Term Sheet, NEVER on Invested → an Invested
 *      event with no matching deal is skipped, so the deals already invested in
 *      Albo OS (one-shot import, Airtable, manual) can never be duplicated;
 *   2. a Term Sheet event never overwrites a deal Albo OS already owns (any
 *      status past `pending` = post-signature, Albo OS is the source of truth).
 */
export type SyncAction =
  | { kind: 'skip'; reason: string }
  | { kind: 'invested' }
  | { kind: 'termsheet_create' }
  | { kind: 'termsheet_refresh' }

export function decideSyncAction(
  stage: string,
  existingStatus: DealStatus | null,
): SyncAction {
  if (stage === INVESTED_STATUS_ID) {
    return existingStatus === null
      ? { kind: 'skip', reason: 'invested_no_deal' }
      : { kind: 'invested' }
  }
  if (stage === TERM_SHEET_STATUS_ID) {
    if (existingStatus === null) return { kind: 'termsheet_create' }
    return existingStatus === 'pending'
      ? { kind: 'termsheet_refresh' }
      : { kind: 'skip', reason: 'termsheet_on_owned_deal' }
  }
  return { kind: 'skip', reason: 'unhandled_stage' }
}
