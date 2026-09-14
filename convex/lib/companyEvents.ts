/**
 * Company activity journal — the write side of the « Activité » section of
 * the company sheet (`convex/companyEvents.ts` reads it). Every helper here
 * is deal-anchored for now; the company-level families will add their own
 * loggers next to `logDealEvent`, on the same table.
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
 * Every writer of `deals` calls `logDealEvent` (create/update in
 * `convex/deals.ts`, the agent's internal mutations, the Attio sync, the
 * pointage core, valuations, documents, forecast realization). A new writer
 * must too — `tests/journalGuards.test.ts` fails the build otherwise.
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

/** Appends one event to the deal's journal. */
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
