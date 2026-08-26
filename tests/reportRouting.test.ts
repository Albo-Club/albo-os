/**
 * Pure tests for the report recap routing (convex/lib/reportRouting.ts), the
 * decision behind `reportNotify.send`: who hears about a forwarded report,
 * through which channel, in which register.
 *
 * The sending itself (AgentMail reply vs fresh mail) needs a running
 * deployment and is covered by the manual checklist in TESTING.md; everything
 * that needs the database (entity scoping, broadcast recipients, the guard on
 * the report-issue list) lives in `convex/regression.reportAudience.test.ts`.
 * These tests pin the decision alone.
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
const ALL: Array<RecapKind> = ['success', 'duplicate', ...PROBLEMS]

describe('routeRecap — a plain forwarder', () => {
  it('learns the verdict, never the diagnosis', () => {
    // Until ALB-115 both branches returned one byte-identical receipt. The
    // discretion was right, the silence about the outcome was not: a report
    // that fell over read as "well received, on its way".
    assert.equal(routeRecap({ kind: 'success', ...forwarder }).reply, 'confirmation')
    for (const kind of PROBLEMS) {
      assert.equal(routeRecap({ kind, ...forwarder }).reply, 'soft')
    }
  })

  it('never gets the quality-control block, even on success', () => {
    // Sources read, target KPIs, unusual values: the signal of whoever fixes
    // things, noise for whoever only forwards.
    assert.equal(routeRecap({ kind: 'success', ...forwarder }).withQuality, false)
  })

  it('does not stop the handlers from being alerted on a problem', () => {
    for (const kind of PROBLEMS) {
      assert.equal(routeRecap({ kind, ...forwarder }).alertOthers, true)
    }
  })
})

describe('routeRecap — a queue handler who forwarded', () => {
  it('gets the confirmation plus the quality block on success', () => {
    assert.deepEqual(routeRecap({ kind: 'success', ...handler }), {
      reply: 'confirmation',
      withQuality: true,
      alertOthers: false,
      broadcast: true,
    })
  })

  it('gets the actionable mail in their thread on a problem, never the soft one', () => {
    for (const kind of PROBLEMS) {
      const route = routeRecap({ kind, ...handler })
      assert.equal(route.reply, 'alert')
      // The other handlers still need it — `send` excludes this sender from
      // that list so they are not mailed twice.
      assert.equal(route.alertOthers, true)
    }
  })
})

describe('routeRecap — the audience follows the event', () => {
  it('announces a first-time report to the rest of the org', () => {
    for (const sender of [forwarder, handler]) {
      assert.equal(routeRecap({ kind: 'success', ...sender }).broadcast, true)
    }
  })

  it('says nothing to anybody else about a duplicate', () => {
    // Two people forwarding the same investor update must not mail the team
    // twice about a report it has already read — ALB-145 through another door.
    const route = routeRecap({ kind: 'duplicate', ...forwarder })
    assert.equal(route.reply, 'duplicate')
    assert.equal(route.broadcast, false)
    assert.equal(route.alertOthers, false)
  })

  it('never announces a problem to the org', () => {
    for (const kind of PROBLEMS) {
      for (const sender of [forwarder, handler]) {
        assert.equal(routeRecap({ kind, ...sender }).broadcast, false)
      }
    }
  })
})

describe('routeRecap — anti-enumeration', () => {
  it('never replies to a non-member, whatever the outcome', () => {
    for (const kind of ALL) {
      assert.equal(
        routeRecap({ kind, ...stranger }).reply,
        null,
        `replied to a stranger on ${kind}`,
      )
    }
  })

  it('never announces their report either — nothing was filed for them', () => {
    for (const kind of ALL) {
      assert.equal(routeRecap({ kind, ...stranger }).broadcast, false)
    }
  })

  it('still reports it to the handlers, including a row assigned by hand', () => {
    // 'success' here = a quarantined mail someone attached manually; the
    // handlers hear how it ended, the unknown sender hears nothing.
    assert.equal(routeRecap({ kind: 'success', ...stranger }).alertOthers, true)
  })
})
