import { v } from 'convex/values'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * The recurring emails a member can opt out of — alerts, plus the weekly
 * report count, which is a stat rather than an alert but travels in the same
 * Monday mail and deserves the same off switch. Everything else the app sends
 * is transactional (invitation, magic link, the answer to a forwarded report)
 * and is NOT configurable — it is the direct reply to a gesture its recipient
 * just made.
 */
export const NOTIFICATION_KINDS = [
  'cashThreshold',
  'overdueEntries',
  'bankConnection',
  'indexFailure',
  'reportIssues',
  'weeklyReports',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const notificationKindValidator = v.union(
  ...NOTIFICATION_KINDS.map((kind) => v.literal(kind)),
)

/** Backing `userPrefs` field per kind. Stored as an opt-OUT: absent = on. */
const PREF_FIELD = {
  cashThreshold: 'notifyCashThreshold',
  overdueEntries: 'notifyOverdueEntries',
  bankConnection: 'notifyBankConnection',
  indexFailure: 'notifyIndexFailure',
  reportIssues: 'notifyReportIssues',
  weeklyReports: 'notifyWeeklyReports',
} as const satisfies Record<NotificationKind, keyof Doc<'userPrefs'>>

async function prefsOf(ctx: Ctx, userId: Id<'users'>) {
  return ctx.db
    .query('userPrefs')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()
}

/** Does this user still want `kind` in their inbox? Unset prefs = yes. */
export async function wantsAlert(
  ctx: Ctx,
  userId: Id<'users'>,
  kind: NotificationKind,
): Promise<boolean> {
  const prefs = await prefsOf(ctx, userId)
  return prefs?.[PREF_FIELD[kind]] !== false
}

/** Every flag of a user, defaults applied — for the settings matrix. */
export async function readAlertPrefs(
  ctx: Ctx,
  userId: Id<'users'>,
): Promise<Record<NotificationKind, boolean>> {
  const prefs = await prefsOf(ctx, userId)
  return Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [
      kind,
      prefs?.[PREF_FIELD[kind]] !== false,
    ]),
  ) as Record<NotificationKind, boolean>
}

export async function setAlertPref(
  ctx: GenericMutationCtx<DataModel>,
  userId: Id<'users'>,
  kind: NotificationKind,
  enabled: boolean,
): Promise<void> {
  const prefs = await prefsOf(ctx, userId)
  const patch = { [PREF_FIELD[kind]]: enabled }
  if (!prefs) {
    await ctx.db.insert('userPrefs', { userId, ...patch })
    return
  }
  await ctx.db.patch('userPrefs', prefs._id, patch)
}
