/**
 * Who hears what when the report pipeline finishes — the decision alone, so
 * it can be pinned by tests without a deployment (convex/reportNotify.ts does
 * the sending).
 *
 * One rule: EVERYTHING follows the gesture. A member who forwarded a report
 * gets the answer in their own thread, and that answer is the real one —
 * the detailed recap on success, the cause and the queue link on a problem.
 * Nobody else hears about a success; a problem also reaches the members who
 * subscribed to it, as a fresh mail.
 *
 * The `reportIssues` preference deliberately plays NO part here. It gates the
 * UNSOLICITED mail only — the problems of reports you did not forward — and
 * `reportNotify.send` reads it through `listRecipients`. It used to decide the
 * content of the thread reply too, which conflated two questions: "do I want
 * the queue's problems in my inbox?" and "do I want to see what happened to
 * the report I just forwarded?". Answering the first with "no" silenced the
 * second, which is how a forwarder ended up unable to check the company the AI
 * picked.
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
}: {
  kind: RecapKind
  senderIsMember: boolean
}): RecapRoute {
  // Unknown sender: never reply. A quarantined mail (or a row someone
  // assigned by hand from the queue) is reported to the handlers instead.
  if (!senderIsMember) return { reply: null, alertOthers: true }

  // Nobody is told about a success they did not trigger.
  if (kind === 'success') return { reply: 'recap', alertOthers: false }

  return { reply: 'alert', alertOthers: true }
}
