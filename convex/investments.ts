/**
 * Powens Wealth investment positions → Convex ingestion.
 *
 * The securities held inside a compte-titres / contrat de capitalisation /
 * crypto account, pulled from GET /2.0/users/me/investments with the org's
 * permanent Powens token. Each investment links to an account through
 * `id_account` → `bankAccounts.powensAccountId`; rows are replaced wholesale
 * per account at each sync (`replacePositions`), only for the accounts
 * present in the payload.
 *
 * Caveat: the Wealth & Loans product may NOT be enabled on the Powens domain
 * yet (Account-Manager activation) — a 403/404 from the endpoint surfaces as
 * the typed ConvexError `powens_wealth_unavailable`, and the daily cron
 * (`syncAll`) isolates each org in try/catch so it stays a harmless no-op.
 */

import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server'
import { requireOrgMember } from './lib/auth'
import { powensEnv } from './powens'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'

// ─── Normalization helpers (Powens payload = untyped JSON) ───────────────────
// Local re-declarations of the powens.ts helpers (they are not exported).

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : []
}
function asIdStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}
/** Euro float → integer cents. */
function toCents(value: unknown): number | undefined {
  const n = asNumber(value)
  return n === undefined ? undefined : Math.round(n * 100)
}
/** Powens `vdate` comes as "YYYY-MM-DD" (or a datetime) — parsed as UTC. */
function parsePowensDate(value: unknown): number | undefined {
  const s = asString(value)
  if (!s) return undefined
  const withTime = s.includes('T')
    ? s
    : s.includes(' ')
      ? s.replace(' ', 'T')
      : `${s}T00:00:00`
  const hasTz = withTime.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(withTime)
  const ms = Date.parse(hasTz ? withTime : `${withTime}Z`)
  return Number.isNaN(ms) ? undefined : ms
}

/** One normalized Powens investment (validator + TS shape kept in sync). */
const positionFields = {
  powensInvestmentId: v.string(),
  label: v.string(),
  isinCode: v.optional(v.string()),
  quantity: v.optional(v.number()), // units, float
  unitValue: v.optional(v.number()), // cents
  valuation: v.optional(v.number()), // cents
  diff: v.optional(v.number()), // cents, +/- vs cost
  valuationDate: v.optional(v.number()), // ms epoch (vdate)
}
type NormalizedPosition = {
  powensInvestmentId: string
  label: string
  isinCode?: string
  quantity?: number
  unitValue?: number
  valuation?: number
  diff?: number
  valuationDate?: number
}

type SyncSummary = { positions: number; accounts: number; skipped: number }

// ─── Org-facing query ────────────────────────────────────────────────────────

/** Positions of one bank account, sorted by valuation desc — feeds the
 * placement views. */
export const listByAccount = query({
  args: { bankAccountId: v.id('bankAccounts') },
  handler: async (ctx, { bankAccountId }) => {
    const account = await ctx.db.get("bankAccounts", bankAccountId)
    if (!account) throw new ConvexError('not_found')
    await requireOrgMember(ctx, account.orgId)
    const rows = await ctx.db
      .query('investmentPositions')
      .withIndex('by_account', (q) => q.eq('bankAccountId', bankAccountId))
      .collect()
    return rows
      .sort((a, b) => (b.valuation ?? 0) - (a.valuation ?? 0))
      .map((r) => ({
        _id: r._id,
        label: r.label,
        isinCode: r.isinCode ?? null,
        quantity: r.quantity ?? null,
        unitValue: r.unitValue ?? null,
        valuation: r.valuation ?? null,
        diff: r.diff ?? null,
        valuationDate: r.valuationDate ?? null,
        syncedAt: r.syncedAt,
      }))
  },
})

// ─── Sync (pull from Powens) ─────────────────────────────────────────────────

/** Auth for `refresh` — actions have no `ctx.db`, so membership goes through
 * this internalQuery (powensAuthProbe pattern from convex/powens.ts). */
export const refreshAuthProbe = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return { ok: true as const }
  },
})

/** Wholesale replace, per account: resolves each Powens account id to the
 * org's `bankAccounts` row (by_powens_account, org-checked), deletes its
 * existing rows and inserts the fresh ones. Unresolved Powens accounts are
 * skipped and counted; accounts absent from the payload are left alone. */
export const replacePositions = internalMutation({
  args: {
    orgId: v.id('organizations'),
    groups: v.array(
      v.object({
        powensAccountId: v.string(),
        positions: v.array(v.object(positionFields)),
      }),
    ),
  },
  handler: async (ctx, { orgId, groups }) => {
    const summary: SyncSummary = { positions: 0, accounts: 0, skipped: 0 }
    const syncedAt = Date.now()
    for (const group of groups) {
      // The index is not org-scoped — resolve then check the org.
      const candidates = await ctx.db
        .query('bankAccounts')
        .withIndex('by_powens_account', (q) =>
          q.eq('powensAccountId', group.powensAccountId),
        )
        .collect()
      const account = candidates.find((a) => a.orgId === orgId)
      if (!account) {
        summary.skipped += 1
        continue
      }
      const existing = await ctx.db
        .query('investmentPositions')
        .withIndex('by_account', (q) => q.eq('bankAccountId', account._id))
        .collect()
      for (const row of existing) {
        await ctx.db.delete("investmentPositions", row._id)
      }
      for (const position of group.positions) {
        await ctx.db.insert('investmentPositions', {
          orgId,
          bankAccountId: account._id,
          ...position,
          syncedAt,
        })
      }
      summary.accounts += 1
      summary.positions += group.positions.length
    }
    return summary
  },
})

/** Pulls `/users/me/investments` with the org token, normalizes and groups
 * by `id_account`, then hands off to `replacePositions`. Shared helper (not
 * an action-to-action call) between `refresh`, `syncOrg` and `syncAll`. */
async function syncOrgPositions(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
  authToken: string,
): Promise<SyncSummary> {
  const { domain } = powensEnv()
  const res = await fetch(`https://${domain}/2.0/users/me/investments`, {
    headers: { Authorization: `Bearer ${authToken}` },
  })
  if (res.status === 403 || res.status === 404) {
    // Wealth & Loans product not enabled on the Powens domain.
    throw new ConvexError('powens_wealth_unavailable')
  }
  if (!res.ok) throw new ConvexError(`powens_investments_failed:${res.status}`)
  const json = asRecord(await res.json())
  const byAccount = new Map<string, Array<NormalizedPosition>>()
  for (const raw of asArray(json.investments)) {
    const inv = asRecord(raw)
    const powensInvestmentId = asIdStr(inv.id)
    const powensAccountId = asIdStr(inv.id_account)
    if (!powensInvestmentId || !powensAccountId) continue
    const code = asString(inv.code)
    const position: NormalizedPosition = {
      powensInvestmentId,
      label: asString(inv.label) ?? code ?? powensInvestmentId,
      isinCode: asString(inv.code_type) === 'ISIN' ? code : undefined,
      quantity: asNumber(inv.quantity),
      unitValue: toCents(inv.unitvalue),
      valuation: toCents(inv.valuation),
      diff: toCents(inv.diff),
      valuationDate: parsePowensDate(inv.vdate),
    }
    const list = byAccount.get(powensAccountId)
    if (list) list.push(position)
    else byAccount.set(powensAccountId, [position])
  }
  const groups = [...byAccount.entries()].map(
    ([powensAccountId, positions]) => ({ powensAccountId, positions }),
  )
  const summary: SyncSummary = await ctx.runMutation(
    internal.investments.replacePositions,
    { orgId, groups },
  )
  return summary
}

/** Public "sync now" for one org. Throws `powens_no_user` when the org has
 * no Powens user yet, `powens_wealth_unavailable` when the Wealth product
 * is not enabled on the domain. */
export const refresh = action({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<SyncSummary> => {
    await ctx.runQuery(internal.investments.refreshAuthProbe, { orgId })
    const powensUser = await ctx.runQuery(internal.powens.getOrgPowensToken, {
      orgId,
    })
    if (!powensUser) throw new ConvexError('powens_no_user')
    return await syncOrgPositions(ctx, orgId, powensUser.authToken)
  },
})

/** One org's sync — internal entry point (same logic as `refresh`, no auth
 * probe: crons/backfills run without identity). */
export const syncOrg = internalAction({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }): Promise<SyncSummary> => {
    const powensUser = await ctx.runQuery(internal.powens.getOrgPowensToken, {
      orgId,
    })
    if (!powensUser) throw new ConvexError('powens_no_user')
    return await syncOrgPositions(ctx, orgId, powensUser.authToken)
  },
})

/** Daily cron: syncs every org that has a Powens user. Each org is isolated
 * in try/catch — one failing org (or the Wealth product being disabled)
 * never aborts the others. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const users: Array<{ orgId: Id<'organizations'>; authToken: string }> =
      await ctx.runQuery(internal.powens.listPowensUsersForPoll, {})
    const summary = { synced: 0, failed: 0 }
    for (const user of users) {
      try {
        await syncOrgPositions(ctx, user.orgId, user.authToken)
        summary.synced += 1
      } catch (err) {
        summary.failed += 1
        // No token in the message — orgId only.
        console.warn(
          `[investments] positions sync failed (org ${user.orgId}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return summary
  },
})
