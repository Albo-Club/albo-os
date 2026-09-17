/**
 * One-shot: release the inbound emails stuck on 'processing'.
 *
 * Why it exists: the extraction action (`reportExtract.run`) claims a row by
 * writing 'processing' and only ever leaves that status through
 * `setExtraction`. When the runtime kills the action instead — the case
 * fixed alongside this module was a 79 MB Drive video read whole into a
 * 64 MiB runtime, cf. KNOWN_ISSUES.md « Un lien Drive vers une vidéo tue
 * l'extraction » — no catch runs, no mutation follows, and the row keeps
 * 'processing'. Nothing revisits it (`retryAfterTransient` only covers the
 * two model bricks) and the queue offers no way out: « Retraiter » refuses a
 * processing row, and its Delete button is hidden.
 *
 * This is that way out, once: every row still 'processing' for an email
 * received more than `olderThanMinutes` ago goes to 'needs_review' with the
 * reason `stuck_processing`. « Retraiter » then re-runs the whole pipeline
 * on the deployed code. No notification: releasing is our gesture, not the
 * forwarder's.
 *
 * `receivedAt` is the email's date, not the claim's: the pipeline records no
 * claim time, and a mail is processed within minutes of arriving, so an
 * hour-old one still 'processing' is dead. Run it AFTER the merge (`convex
 * run --prod` calls the deployed code) — and only after the fix is live,
 * otherwise « Retraiter » dies on the same file again:
 *   pnpm exec convex run --prod migrations/releaseStuckInboundEmails:run
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

const DEFAULT_OLDER_THAN_MINUTES = 60

export const run = internalMutation({
  args: { olderThanMinutes: v.optional(v.number()) },
  handler: async (ctx, { olderThanMinutes }) => {
    const cutoff = Date.now() - (olderThanMinutes ?? DEFAULT_OLDER_THAN_MINUTES) * 60_000
    const processing = await ctx.db
      .query('inboundEmails')
      .withIndex('by_status', (q) => q.eq('status', 'processing'))
      .collect()

    const released: Array<{ subject: string; receivedAt: string }> = []
    for (const row of processing) {
      if (row.receivedAt > cutoff) continue
      await ctx.db.patch('inboundEmails', row._id, {
        status: 'needs_review',
        statusReason: 'stuck_processing',
      })
      released.push({ subject: row.subject, receivedAt: new Date(row.receivedAt).toISOString() })
    }
    return { released }
  },
})
