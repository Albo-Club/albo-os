/**
 * Who hears what when the report pipeline finishes — the decision alone, so
 * it can be pinned by tests without a deployment (convex/reportNotify.ts does
 * the sending).
 *
 * Three axes, deliberately independent:
 * - The CHANNEL follows the gesture: a member who forwarded gets the answer
 *   as a reply IN THEIR OWN THREAD; a member who dropped the file on the fiche
 *   has no thread, so the same answer reaches them as a fresh mail; everyone
 *   else gets a fresh email too.
 * - The CONTENT follows the role: whoever handles the review queue also gets
 *   the quality-control block (sources read, KPI checklist, unusual values)
 *   appended to their confirmation, and the actionable cause when it breaks.
 *   Whoever only forwards gets the same confirmation without that block, and
 *   a failure notice with nothing to act on.
 * - The AUDIENCE follows the event: a report that lands for the first time is
 *   news for the whole organization, so the other members are told. A replay,
 *   a duplicate or a failure is not news — nobody else hears about it.
 *
 * The anti-enumeration guard sits above all of it: a non-member sender is
 * NEVER replied to, so the address can't be probed. Note that it guards the
 * ANSWER only — not the processing. Whether a mail is filed is decided by its
 * content (`reportIdentify`), never by who sent it.
 */

export type RecapKind = 'success' | 'duplicate' | 'failure' | 'quarantine'

/** Body of the answer owed to whoever produced the report, or null. */
export type ThreadReply =
  /** The report is filed: entity, fiche, what it says, where the company is. */
  | 'confirmation'
  /** Already in Albo OS — a second forward of a report that was there. */
  | 'duplicate'
  /** Actionable problem mail: reason + link to the review queue. */
  | 'alert'
  /** Non-actionable problem notice: it did not go through, we are on it. */
  | 'soft'
  | null

/**
 * How that answer reaches its author. The CHANNEL follows the GESTURE: a
 * forward is answered in its own thread; a manual upload has no thread, so the
 * same answer goes out as a fresh mail — the person who dropped the file is
 * owed the same confirmation as the person who forwarded it. A portal
 * publication has no author at all (`vascoNotify` announces it instead).
 */
export type ReplyChannel = 'thread' | 'fresh' | null

export type RecapRoute = {
  reply: ThreadReply
  /** Where `reply` goes — null means it goes nowhere, whatever `reply` says. */
  replyChannel: ReplyChannel
  /**
   * Append the quality-control block to the confirmation. Only for people who
   * handle the queue — it is the signal they act on, and noise for anyone else.
   */
  withQuality: boolean
  /**
   * Send the problem mail to the OTHER queue handlers (the forwarder is
   * excluded — they already got it in their thread).
   */
  alertOthers: boolean
  /**
   * Announce the new report to the other members of the organizations it was
   * filed in. Never on a duplicate: nothing new happened.
   */
  broadcast: boolean
}

export function routeRecap({
  kind,
  origin,
  senderIsMember,
  senderHandlesIssues,
}: {
  kind: RecapKind
  /** Where the report came from — absent means an email (the historical case). */
  origin?: 'email' | 'upload' | 'vasco'
  senderIsMember: boolean
  /** Member AND subscribed to report problems. */
  senderHandlesIssues: boolean
}): RecapRoute {
  // A portal publication has nobody waiting: no forwarder, no uploader, no
  // thread. It is announced by `vascoNotify`, never answered here.
  const channel: ReplyChannel =
    origin === 'vasco' ? null : origin === 'upload' ? 'fresh' : 'thread'
  // Unknown sender: never reply, and never raise an alert either. The report
  // address is open to the outside — a founder writes to it directly, and so
  // does the odd stranger — so a problem mail per unidentified message is the
  // inbox filling up again. What a stranger's mail produces is what it earned:
  // a filed report is news the organization hears about; anything else waits
  // in the queue, silently.
  if (!senderIsMember) {
    return {
      reply: null,
      replyChannel: null,
      withQuality: false,
      alertOthers: false,
      broadcast: kind === 'success',
    }
  }

  if (kind === 'success') {
    return {
      reply: 'confirmation',
      replyChannel: channel,
      withQuality: senderHandlesIssues,
      alertOthers: false,
      broadcast: true,
    }
  }

  // A report that was already filed is not an event: only the person who just
  // forwarded it hears back, and only to say it was already there.
  if (kind === 'duplicate') {
    return { reply: 'duplicate', replyChannel: channel, withQuality: false, alertOthers: false, broadcast: false }
  }

  return {
    reply: senderHandlesIssues ? 'alert' : 'soft',
    replyChannel: channel,
    withQuality: false,
    alertOthers: true,
    broadcast: false,
  }
}
