import { ConvexError } from 'convex/values'

import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * Scope d'un thread agent : `${orgId}:${userId}` (cf. convex/chat.ts).
 * L'action de streaming n'a pas d'identité auth → chaque outil parse le scope
 * puis re-vérifie l'appartenance via `readMembership`.
 */
export function parseScope(scope: string | undefined | null): {
  orgId: Id<'organizations'>
  userId: Id<'users'>
} {
  if (!scope) throw new ConvexError('agent_tools_missing_scope')
  const idx = scope.indexOf(':')
  if (idx <= 0) throw new ConvexError('agent_tools_invalid_scope')
  return {
    orgId: scope.slice(0, idx) as Id<'organizations'>,
    userId: scope.slice(idx + 1) as Id<'users'>,
  }
}

export async function readMembership(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
): Promise<Doc<'organizationMembers'>> {
  const member = await ctx.db
    .query('organizationMembers')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', userId),
    )
    .unique()
  if (!member) throw new ConvexError('agent_tools_forbidden')
  return member
}
