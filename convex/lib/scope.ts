import { ConvexError } from 'convex/values'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * Résout le `holdingScope` (albo | calte) d'une entité investisseuse du
 * groupe. Utilisé par les mutations create/update de deal pour figer le
 * scope dénormalisé sur `deals`.
 *
 * Throw si la company n'existe pas, n'est pas une `group_*`, ou n'a pas de
 * `holdingScope` (cas impossible en pratique : tout `group_*` en a un).
 */
export async function resolveScope(
  ctx: Ctx,
  investorCompanyId: Id<'companies'>,
): Promise<'albo' | 'calte'> {
  const company = await ctx.db.get(investorCompanyId)
  if (!company) throw new ConvexError('investor_company_not_found')
  if (!company.kind.startsWith('group_')) {
    throw new ConvexError('investor_must_be_group_entity')
  }
  if (!company.holdingScope) throw new ConvexError('investor_missing_scope')
  return company.holdingScope
}
