/**
 * Pure tests for the loop guard (convex/lib/reportSenders.ts).
 *
 * The report inbox sits behind a Google group whose members include the inbox
 * itself. If an answer ever goes to the group instead of to the person who
 * forwarded, the group hands it straight back to the inbox, which answers
 * again: a mail loop that spams every member. Two addresses must therefore
 * never be ingested from nor replied to — the group, and the inbox.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { blockedSenderAddresses, isBlockedSender } from '../convex/lib/reportSenders'

const INBOX = 'report-albo-os@agentmail.to'

function withGroups(value: string | undefined) {
  if (value === undefined) delete process.env.REPORT_GROUP_ADDRESSES
  else process.env.REPORT_GROUP_ADDRESSES = value
}

afterEach(() => withGroups(undefined))

describe('isBlockedSender — the two addresses we never talk to', () => {
  it('blocks the inbox answering itself, with no env var set', () => {
    assert.equal(isBlockedSender(INBOX, INBOX), true)
  })

  it('blocks the forwarding group, whatever the casing or spacing', () => {
    withGroups('report@alboteam.com')
    assert.equal(isBlockedSender('report@alboteam.com', INBOX), true)
    assert.equal(isBlockedSender('  Report@Alboteam.com ', INBOX), true)
  })

  it('accepts several groups, comma-separated', () => {
    withGroups('report@alboteam.com, reports@calte.fr')
    assert.equal(isBlockedSender('reports@calte.fr', INBOX), true)
    assert.equal(isBlockedSender('report@alboteam.com', INBOX), true)
  })

  it('lets every genuine sender through — this is not an access filter', () => {
    withGroups('report@alboteam.com')
    for (const sender of [
      'benjamin@alboteam.com',
      'ben.perso@gmail.com',
      'founder@sezame.io',
      // Close but not equal: a member of the group, not the group itself.
      'reporting@alboteam.com',
      'report@alboteam.com.evil.tld',
    ]) {
      assert.equal(isBlockedSender(sender, INBOX), false, `blocked ${sender}`)
    }
  })

  it('ignores empty entries rather than blocking everyone', () => {
    withGroups(' , ,')
    assert.deepEqual([...blockedSenderAddresses(INBOX)], [INBOX])
    assert.equal(isBlockedSender('benjamin@alboteam.com', INBOX), false)
    // An empty From must not match an empty blocklist entry either.
    assert.equal(isBlockedSender('', INBOX), false)
  })

  it('skips a placeholder inbox id — a manual upload is not an address', () => {
    withGroups(undefined)
    assert.deepEqual([...blockedSenderAddresses('manual-upload')], [])
  })
})
