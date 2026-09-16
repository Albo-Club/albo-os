/**
 * Company activity journal — the write side of the « Activité » section of
 * the company sheet (`convex/companyEvents.ts` reads it). Deal events are
 * filed under the deal's target (`logDealEvent`), company events under the
 * company itself (`logCompanyEvent`), on the same table.
 *
 * Two rules keep the feed readable:
 *
 * - **One event per mutation call.** A patch that changes the status, the
 *   exit proceeds and the exit date is ONE gesture (the exit dialog), so
 *   `diffDealPatch` folds it into one `status_changed` event. Priority when a
 *   call touches several kinds of things: conversion > status > fields. The
 *   lower-priority changes of the same call are not logged separately.
 * - **Only real changes.** A patch whose values equal the row's produces no
 *   event: the Attio refresh re-sends the same term sheet on every webhook,
 *   and an edit dialog saved untouched should leave no trace either.
 *
 * Every writer of a journaled table calls the matching logger — `logDealEvent`
 * for what happens to a deal (create/update in `convex/deals.ts`, the agent's
 * internal mutations, the Attio sync, the pointage core, valuations, deal
 * documents, forecast realization, the business plan), `logCompanyEvent` for
 * what happens to the company itself (its creation, identity, people and
 * links in `convex/companies.ts`, reports in `convex/reportStore.ts` /
 * `reportInbox.ts`, the vault in `convex/documents.ts`, KPIs in
 * `convex/kpis.ts`). A new writer must too — `tests/journalGuards.test.ts`
 * fails the build otherwise.
 */
import type { Infer } from 'convex/values'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { companyEvent, companyEventActor } from '../schema'

export type CompanyEventActor = Infer<typeof companyEventActor>
export type CompanyEvent = Infer<typeof companyEvent>

type MutCtx = GenericMutationCtx<DataModel>

/** The deal fields a `fields_changed` event spells out (before → after). */
const CLEAR_FIELDS = ['committedAmount', 'exitProceeds'] as const
type ClearField = (typeof CLEAR_FIELDS)[number]

/** Bookkeeping keys a patch may carry that are not a change the user made. */
const IGNORED_KEYS = new Set(['manuallyEditedFields', 'convertedFromKind'])

/** `null` (client "clear") and `undefined` (absent) are the same absence. */
function norm(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * The single event a patch on `before` amounts to, or `null` when nothing
 * actually changes. `currentValue` is deliberately not compared: a placement
 * balance update logs its own `valuation_added` (cf. `deals.update`).
 */
export function diffDealPatch(
  before: Doc<'deals'>,
  patch: Record<string, unknown>,
): CompanyEvent | null {
  const changed: Array<string> = []
  for (const key of Object.keys(patch)) {
    if (IGNORED_KEYS.has(key) || key === 'currentValue') continue
    const next = norm(patch[key])
    const prev = norm((before as Record<string, unknown>)[key])
    if (next !== prev) changed.push(key)
  }
  if (changed.length === 0) return null

  if (changed.includes('instrumentKind')) {
    return {
      kind: 'converted',
      from: before.instrumentKind,
      to: patch.instrumentKind as Doc<'deals'>['instrumentKind'],
    }
  }
  if (changed.includes('status')) {
    const proceeds = patch.exitProceeds
    return {
      kind: 'status_changed',
      from: before.status,
      to: patch.status as Doc<'deals'>['status'],
      ...(typeof proceeds === 'number' ? { proceedsCents: proceeds } : {}),
    }
  }
  const changes = changed
    .filter((key): key is ClearField =>
      (CLEAR_FIELDS as ReadonlyArray<string>).includes(key),
    )
    .map((field) => ({
      field,
      from: before[field] ?? undefined,
      to: (patch[field] as number | null | undefined) ?? undefined,
    }))
  return {
    kind: 'fields_changed',
    changes,
    otherCount: changed.length - changes.length,
  }
}

/**
 * The single event a patch on a company amounts to, or `null` when nothing
 * changes. Priority when one call touches several things: the Attio link >
 * the people list > the identity fields — each edit surface of the sheet
 * saves one of the three, so the fold only matters for the agent. A rename
 * is spelled out; every other identity field is counted.
 */
export function diffCompanyPatch(
  before: Doc<'companies'>,
  patch: Record<string, unknown>,
): CompanyEvent | null {
  const changed: Array<string> = []
  for (const key of Object.keys(patch)) {
    const next = norm(patch[key])
    const prev = norm((before as Record<string, unknown>)[key])
    if (next !== prev) changed.push(key)
  }
  if (changed.length === 0) return null

  if (changed.includes('attioCompanyId')) {
    return { kind: patch.attioCompanyId ? 'attio_linked' : 'attio_unlinked' }
  }
  if (changed.includes('people')) {
    const names = (list: unknown) =>
      Array.isArray(list)
        ? list.map((p: { name: string }) => p.name.trim())
        : []
    const prev = names(before.people)
    const next = names(patch.people)
    return {
      kind: 'people_changed',
      added: next.filter((n) => !prev.includes(n)),
      removed: prev.filter((n) => !next.includes(n)),
    }
  }
  const renamed = changed.includes('name')
  return {
    kind: 'company_updated',
    ...(renamed
      ? { rename: { from: before.name, to: patch.name as string } }
      : {}),
    otherCount: changed.length - (renamed ? 1 : 0),
  }
}

/** Appends one company-level event (no deal) to the company's journal —
 * on the company row itself, or on an `{ orgId, companyId }` pair when the
 * caller only holds the ids. */
export async function logCompanyEvent(
  ctx: MutCtx,
  target:
    | { orgId: Id<'organizations'>; companyId: Id<'companies'> }
    | Pick<Doc<'companies'>, '_id' | 'orgId'>,
  actor: CompanyEventActor,
  event: CompanyEvent,
  at: number = Date.now(),
): Promise<Id<'companyEvents'>> {
  return await ctx.db.insert('companyEvents', {
    orgId: target.orgId,
    companyId: 'companyId' in target ? target.companyId : target._id,
    at,
    actor,
    event,
  })
}

/** Appends one event to the deal's journal (filed under its target). */
export async function logDealEvent(
  ctx: MutCtx,
  deal: Pick<Doc<'deals'>, '_id' | 'orgId' | 'targetCompanyId'>,
  actor: CompanyEventActor,
  event: CompanyEvent,
  at: number = Date.now(),
): Promise<Id<'companyEvents'>> {
  return await ctx.db.insert('companyEvents', {
    orgId: deal.orgId,
    companyId: deal.targetCompanyId,
    dealId: deal._id,
    at,
    actor,
    event,
  })
}

/**
 * A forecast rule's journal is its deal's: a rule tied to no deal has no
 * sheet to show on, and writes nothing. Returns null in that case.
 */
export async function logRuleEvent(
  ctx: MutCtx,
  rule: Pick<Doc<'forecastRules'>, 'dealId'>,
  actor: CompanyEventActor,
  event: CompanyEvent,
): Promise<Id<'companyEvents'> | null> {
  if (!rule.dealId) return null
  const deal = await ctx.db.get('deals', rule.dealId)
  if (!deal) return null
  return await logDealEvent(ctx, deal, actor, event)
}

/**
 * Journals what a patch on a forecast rule amounts to: nothing when the
 * values are the row's; a move between deals as a departure on the old deal
 * and an arrival on the new one; an `active` flip alone as a toggle; any
 * other change as one `rule_updated`. A key present with `undefined` clears
 * the field (Convex patch semantics), so it counts as a change too.
 */
export async function journalRulePatch(
  ctx: MutCtx,
  before: Doc<'forecastRules'>,
  patch: Record<string, unknown>,
  actor: CompanyEventActor,
): Promise<void> {
  const changed = Object.keys(patch).filter(
    (key) =>
      norm(patch[key]) !== norm((before as Record<string, unknown>)[key]),
  )
  if (changed.length === 0) return
  const label = typeof patch.label === 'string' ? patch.label : before.label
  if (changed.includes('dealId')) {
    await logRuleEvent(ctx, before, actor, {
      kind: 'rule_unlinked',
      label: before.label,
    })
    await logRuleEvent(
      ctx,
      { dealId: patch.dealId as Doc<'forecastRules'>['dealId'] },
      actor,
      { kind: 'rule_linked', label },
    )
    return
  }
  await logRuleEvent(
    ctx,
    before,
    actor,
    changed.length === 1 && changed[0] === 'active'
      ? { kind: 'rule_toggled', label, active: Boolean(patch.active) }
      : { kind: 'rule_updated', label },
  )
}

/** Who a stored report is credited to: the member who forwarded or uploaded
 * it when known, the Parallel portal for a publication, nobody otherwise. */
export function reportActor(
  email: Pick<Doc<'inboundEmails'>, 'origin' | 'senderUserId'>,
): CompanyEventActor {
  if (email.origin === 'vasco') return { kind: 'system', source: 'vasco' }
  if (email.senderUserId) return { kind: 'user', userId: email.senderUserId }
  return { kind: 'unknown' }
}

/** The channel a report came in through, for the journal sentence. */
export function reportChannel(
  email: Pick<Doc<'inboundEmails'>, 'origin'>,
): 'email' | 'upload' | 'vasco' {
  return email.origin === 'vasco' || email.origin === 'upload'
    ? email.origin
    : 'email'
}

/** The actor for a write made by a signed-in user, from the app or through
 * the agent (`viaAgent` only when true, so the row stays small). */
export function userActor(
  userId: Id<'users'>,
  viaAgent = false,
): CompanyEventActor {
  return viaAgent
    ? { kind: 'user', userId, viaAgent: true }
    : { kind: 'user', userId }
}
