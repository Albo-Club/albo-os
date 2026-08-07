/// <reference types="vite/client" />
/**
 * Regression: the retry budget of a transient model failure
 * (convex/reportInbox.ts:retryAfterTransient).
 *
 * Three properties matter, and only the first is obvious:
 *
 * 1. The budget is bounded. Without an end, an email whose analysis never
 *    succeeds would reschedule itself forever and never reach the user.
 * 2. The row goes back to 'received'. That is the status each brick's claim
 *    mutation requires, so the retry re-enters through the normal door
 *    instead of needing its own path into the pipeline.
 * 3. The budget is PER STEP. Identification and analysis both call the model;
 *    an email that survived two shaky identifications must still get a full
 *    budget for its analysis. Carrying the step next to the counter is what
 *    buys that without a reset to write anywhere in the pipeline — and a
 *    missing reset is exactly the kind of bug that only shows up on the third
 *    incident, months later.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { RETRY_BACKOFFS_MS } from './lib/modelRetry'
import { setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

async function createInboundEmail(t: Harness): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: 'msg-retry',
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject: 'Report',
      receivedAt: Date.now(),
      attachments: [],
      status: 'processing',
    })
  })
}

async function readRow(t: Harness, id: Id<'inboundEmails'>) {
  return await t.run(async (ctx) => await ctx.db.get('inboundEmails', id))
}

describe('retryAfterTransient', () => {
  test('reschedules up to the budget, then hands the failure back', async () => {
    const t = setupHarness()
    const id = await createInboundEmail(t)

    for (let attempt = 1; attempt <= RETRY_BACKOFFS_MS.length; attempt += 1) {
      const retried = await t.mutation(internal.reportInbox.retryAfterTransient, {
        inboundEmailId: id,
        step: 'analyze',
      })
      expect(retried).toBe(true)
      const row = await readRow(t, id)
      expect(row?.retryAttempts).toBe(attempt)
      // Back to the status the claim mutations require.
      expect(row?.status).toBe('received')
    }

    // Budget spent: the caller records the failure as before.
    const exhausted = await t.mutation(internal.reportInbox.retryAfterTransient, {
      inboundEmailId: id,
      step: 'analyze',
    })
    expect(exhausted).toBe(false)
    expect((await readRow(t, id))?.retryAttempts).toBe(RETRY_BACKOFFS_MS.length)
  })

  test('gives each step its own budget', async () => {
    const t = setupHarness()
    const id = await createInboundEmail(t)

    await t.mutation(internal.reportInbox.retryAfterTransient, {
      inboundEmailId: id,
      step: 'identify',
    })
    await t.mutation(internal.reportInbox.retryAfterTransient, {
      inboundEmailId: id,
      step: 'identify',
    })
    expect((await readRow(t, id))?.retryAttempts).toBe(2)

    // Analysis is a different step: it starts its own budget, it does not
    // inherit what identification already spent.
    const retried = await t.mutation(internal.reportInbox.retryAfterTransient, {
      inboundEmailId: id,
      step: 'analyze',
    })
    expect(retried).toBe(true)
    const row = await readRow(t, id)
    expect(row?.retryStep).toBe('analyze')
    expect(row?.retryAttempts).toBe(1)
  })
})
