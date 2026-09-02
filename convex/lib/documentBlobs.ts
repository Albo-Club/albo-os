/**
 * A stored file is shared, so it is freed by reference count, never on sight.
 *
 * One blob backs SEVERAL rows: the report fan-out creates one `documents` row
 * per matched entity around a single upload (`reportStore.storeForCompany`),
 * and the source email keeps the same blob on its attachment. Deleting the
 * blob from one of those places blanks the file everywhere else, silently —
 * the row stays, its download URL just resolves to nothing.
 *
 * So every deletion path calls this helper INSTEAD of `ctx.storage.delete`,
 * after removing its own `documents` row: the blob only goes when no row
 * points at it any more. The source email is not a holder — it is emptied
 * along the way (cf. ALB-240): the attachment keeps its name and size, and
 * loses the file the last participation just deleted.
 */

import { deleteStorageText } from './documentTexts'

import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Delete a blob and its extracted text if nothing references it any more.
 * Returns whether the blob was actually deleted.
 *
 * The caller deletes its `documents` row FIRST — the count below is what
 * decides. `inboundEmailId` is the source email of the row being deleted,
 * when it has one; it is re-read here so successive calls in one mutation
 * (one per attachment) each see the previous patch.
 */
export async function releaseStorage(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  opts?: { inboundEmailId?: Id<'inboundEmails'> },
): Promise<boolean> {
  const stillReferenced = await ctx.db
    .query('documents')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first()
  if (stillReferenced) return false

  if (opts?.inboundEmailId) {
    const inbound = await ctx.db.get('inboundEmails', opts.inboundEmailId)
    if (inbound?.attachments.some((att) => att.storageId === storageId)) {
      await ctx.db.patch('inboundEmails', inbound._id, {
        attachments: inbound.attachments.map((att) =>
          att.storageId === storageId ? { ...att, storageId: undefined } : att,
        ),
      })
    }
  }

  await deleteStorageText(ctx, storageId)
  await ctx.storage.delete(storageId)
  return true
}
