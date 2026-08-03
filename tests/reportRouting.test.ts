/**
 * Pure tests for the report recap routing (convex/lib/reportRouting.ts), the
 * decision behind `reportNotify.send`: who hears about a forwarded report,
 * through which channel, in which register.
 *
 * The sending itself (AgentMail reply vs fresh mail) needs a running
 * deployment and is covered by the manual checklist in TESTING.md — these
 * tests pin the decision.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeRecap } from '../convex/lib/reportRouting'
import type { RecapKind } from '../convex/lib/reportRouting'

/** A member who only forwards reports and never handles the queue. */
const forwarder = { senderIsMember: true, senderHandlesIssues: false }
/** A member who handles the review queue (subscribed to report problems). */
const handler = { senderIsMember: true, senderHandlesIssues: true }
/** Anyone else — the address must not reveal that it exists. */
const stranger = { senderIsMember: false, senderHandlesIssues: false }

const PROBLEMS: Array<RecapKind> = ['failure', 'quarantine']

describe('routeRecap — a plain forwarder', () => {
  it('gets the very same receipt whether the report was filed or not', () => {
    const outcomes: Array<RecapKind> = ['success', ...PROBLEMS]
    for (const kind of outcomes) {
      assert.equal(
        routeRecap({ kind, ...forwarder }).reply,
        'receipt',
        `expected a receipt for ${kind}`,
      )
    }
  })

  it('never gets the detailed recap, even on success', () => {
    assert.notEqual(
      routeRecap({ kind: 'success', ...forwarder }).reply,
      'recap',
    )
  })

  it('does not stop the handlers from being alerted on a problem', () => {
    for (const kind of PROBLEMS) {
      assert.equal(routeRecap({ kind, ...forwarder }).alertOthers, true)
    }
  })
})

describe('routeRecap — a queue handler who forwarded', () => {
  it('gets the detailed recap in their thread on success', () => {
    assert.deepEqual(routeRecap({ kind: 'success', ...handler }), {
      reply: 'recap',
      alertOthers: false,
    })
  })

  it('gets the actionable mail in their thread on a problem, never a receipt', () => {
    for (const kind of PROBLEMS) {
      const route = routeRecap({ kind, ...handler })
      assert.equal(route.reply, 'alert')
      // The other handlers still need it — `send` excludes this sender from
      // that list so they are not mailed twice.
      assert.equal(route.alertOthers, true)
    }
  })
})

describe('routeRecap — anti-enumeration', () => {
  it('never replies to a non-member, whatever the outcome', () => {
    const outcomes: Array<RecapKind> = ['success', ...PROBLEMS]
    for (const kind of outcomes) {
      assert.equal(
        routeRecap({ kind, ...stranger }).reply,
        null,
        `replied to a stranger on ${kind}`,
      )
    }
  })

  it('still reports it to the handlers, including a row assigned by hand', () => {
    // 'success' here = a quarantined mail someone attached manually; the
    // handlers hear how it ended, the unknown sender hears nothing.
    assert.equal(routeRecap({ kind: 'success', ...stranger }).alertOthers, true)
  })
})

describe('routeRecap — a success never notifies a bystander', () => {
  it('leaves alertOthers false for every member sender', () => {
    for (const sender of [forwarder, handler]) {
      assert.equal(
        routeRecap({ kind: 'success', ...sender }).alertOthers,
        false,
      )
    }
  })
})
