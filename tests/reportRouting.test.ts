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

/** Any member of an organisation — the only sender whose forward is processed. */
const member = { senderIsMember: true }
/** Anyone else — the address must not reveal that it exists. */
const stranger = { senderIsMember: false }

const PROBLEMS: Array<RecapKind> = ['failure', 'quarantine']
const ALL: Array<RecapKind> = ['success', ...PROBLEMS]

describe('routeRecap — a member who forwarded', () => {
  it('gets the detailed recap in their thread on success', () => {
    assert.deepEqual(routeRecap({ kind: 'success', ...member }), {
      reply: 'recap',
      alertOthers: false,
    })
  })

  it('gets the actionable mail in their thread on a problem', () => {
    for (const kind of PROBLEMS) {
      const route = routeRecap({ kind, ...member })
      assert.equal(route.reply, 'alert')
      // The other subscribers still need it — `send` excludes this sender
      // from that list so they are not mailed twice.
      assert.equal(route.alertOthers, true)
    }
  })

  it('never stays silent on a member, whatever the outcome', () => {
    // The whole point of the routing: what a forwarder reads back depends on
    // nothing but their membership. No preference, no role, no opt-out.
    for (const kind of ALL) {
      assert.notEqual(
        routeRecap({ kind, ...member }).reply,
        null,
        `stayed silent on a member for ${kind}`,
      )
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

  it('still reports it to the subscribers, including a row assigned by hand', () => {
    // 'success' here = a quarantined mail someone attached manually; the
    // subscribers hear how it ended, the unknown sender hears nothing.
    assert.equal(routeRecap({ kind: 'success', ...stranger }).alertOthers, true)
  })
})

describe('routeRecap — a success never notifies a bystander', () => {
  it('leaves alertOthers false for a member sender', () => {
    assert.equal(routeRecap({ kind: 'success', ...member }).alertOthers, false)
  })
})
