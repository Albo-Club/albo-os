/**
 * The `documentTexts` row of a stored file goes wherever its blob goes.
 *
 * Deleting a document happens in more than one place (`documents:remove`, and
 * the cascade when a deal is deleted in `deals:remove`), and a forgotten call
 * leaves a row of up to 900k characters pointing at a storage id that no
 * longer exists. One helper, called next to every `ctx.storage.delete`.
 */

import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export async function deleteStorageText(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  const row = await ctx.db
    .query('documentTexts')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first()
  if (row) await ctx.db.delete('documentTexts', row._id)
}
