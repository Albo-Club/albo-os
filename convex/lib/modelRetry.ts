/**
 * Transient vs definitive failure of a model call, and how long to wait.
 *
 * The report pipeline used to treat every failure as final: one aborted
 * request and the mail landed in `needs_review`, with a failure mail sent and
 * a manual re-process as the only way out. A three-second network hiccup cost
 * a human intervention.
 *
 * A transient failure is one where the SAME input would very likely succeed
 * later — the request was cut, the provider was saturated, the gateway
 * answered 5xx. Those are rescheduled. A definitive one — an answer we cannot
 * read — is not retried: the input will not change, and burning twenty
 * minutes of backoff on it only delays telling the user.
 *
 * Classification reads the error MESSAGE, so it can only be trusted on
 * errors we did not author. Callers must therefore raise their own parsing
 * failures as `ModelOutputError` (a report whose `raw_label` reads "timeout"
 * would otherwise classify itself as transient).
 */

/** Raised by callers when the model answered but the answer is unusable. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelOutputError'
  }
}

/**
 * Signatures of a failure that is worth retrying. Kept broad on purpose: a
 * false positive costs one delayed retry, a false negative costs a lost
 * report and a manual round trip.
 */
const TRANSIENT =
  /abort|timed? ?out|timeout|rate.?limit|429|quota|too many requests|overload|unavailable|temporarily|bad gateway|50[234]|fetch failed|network|econnreset|socket hang up|stream/i

/** ~21 minutes of patience, front-loaded: most cuts clear on the first retry. */
export const RETRY_BACKOFFS_MS = [60_000, 300_000, 900_000]

export function isTransientModelError(err: unknown): boolean {
  if (err instanceof ModelOutputError) return false
  const message = err instanceof Error ? err.message : String(err)
  return TRANSIENT.test(message)
}
