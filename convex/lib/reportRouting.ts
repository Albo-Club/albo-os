/**
 * Who hears what when the report pipeline finishes — the decision alone, so
 * it can be pinned by tests without a deployment (convex/reportNotify.ts does
 * the sending).
 *
 * Two axes, deliberately independent:
 * - The CHANNEL follows the gesture: a member who forwarded gets the answer
 *   as a reply IN THEIR OWN THREAD; everyone else gets a fresh email.
 * - The CONTENT follows the role: whoever handles the review queue gets the
 *   actionable version (cause + link); whoever only forwards gets a receipt
 *   that is byte-for-byte the SAME whatever the outcome — someone who is not
 *   in charge of fixing anything should not have to read a verdict.
 *
 * The anti-enumeration guard sits above all of it: a non-member sender is
 * NEVER replied to, so the address can't be probed.
 */

export type RecapKind = 'success' | 'failure' | 'quarantine'

/** Body to reply with in the forward's thread, or null to stay silent. */
export type ThreadReply =
  /** Full success recap: companies, KPIs, sources, unusual values. */
  | 'recap'
  /** Actionable problem mail: reason + link to the review queue. */
  | 'alert'
  /** Neutral "well received", identical on success and on failure. */
  | 'receipt'
  | null

export type RecapRoute = {
  reply: ThreadReply
  /**
   * Send the problem mail to the OTHER queue handlers (the forwarder is
   * excluded — they already got it in their thread).
   */
  alertOthers: boolean
}

export function routeRecap({
  kind,
  senderIsMember,
  senderHandlesIssues,
}: {
  kind: RecapKind
  senderIsMember: boolean
  /** Member AND subscribed to report problems. */
  senderHandlesIssues: boolean
}): RecapRoute {
  // Unknown sender: never reply. A quarantined mail (or a row someone
  // assigned by hand from the queue) is reported to the handlers instead.
  if (!senderIsMember) return { reply: null, alertOthers: true }

  if (kind === 'success') {
    // Nobody is told about a success they did not trigger.
    return {
      reply: senderHandlesIssues ? 'recap' : 'receipt',
      alertOthers: false,
    }
  }

  return {
    reply: senderHandlesIssues ? 'alert' : 'receipt',
    alertOthers: true,
  }
}
