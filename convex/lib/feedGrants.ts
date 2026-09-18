/**
 * Read side of `powensFeedGrants` — the authorization for a Powens user of
 * one org to feed bank accounts living in another org of the group.
 *
 * Shared by the ingestion (`convex/powens.ts`), the account move
 * (`convex/cash.ts`) and the grant management (`convex/feedGrants.ts`), so
 * the three never disagree on what "may feed" means: a row in the table,
 * nothing else — never a bank name, never a caller-supplied org.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/** Is `feedOrgId` allowed to feed accounts of `hostOrgId`? An org always
 * feeds its own accounts — no row needed for that. */
export async function hasFeedGrant(
  ctx: QueryCtx,
  feedOrgId: Id<'organizations'>,
  hostOrgId: Id<'organizations'>,
): Promise<boolean> {
  if (feedOrgId === hostOrgId) return true
  const row = await ctx.db
    .query('powensFeedGrants')
    .withIndex('by_feed_and_host', (q) =>
      q.eq('feedOrgId', feedOrgId).eq('hostOrgId', hostOrgId),
    )
    .unique()
  return row !== null
}

/** The orgs whose accounts `feedOrgId` may feed, itself excluded. */
export async function hostOrgsOf(
  ctx: QueryCtx,
  feedOrgId: Id<'organizations'>,
): Promise<Array<Id<'organizations'>>> {
  const rows = await ctx.db
    .query('powensFeedGrants')
    .withIndex('by_feed', (q) => q.eq('feedOrgId', feedOrgId))
    .collect()
  return rows.map((r) => r.hostOrgId)
}

/** The org whose Powens user feeds this account: the org tracking its
 * connection. `null` when the connection is tracked nowhere (an account
 * imported by other means, or a connection the poll has since dropped). */
export async function feedOrgOfAccount(
  ctx: QueryCtx,
  account: Doc<'bankAccounts'>,
): Promise<Id<'organizations'> | null> {
  const connectionId = account.powensConnectionId
  if (!connectionId) return null
  const row = await ctx.db
    .query('powensConnections')
    .withIndex('by_powens_connection', (q) =>
      q.eq('powensConnectionId', connectionId),
    )
    .unique()
  return row?.orgId ?? null
}
