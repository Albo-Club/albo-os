/**
 * Regression: a cut request must not cost a report (lib/modelRetry).
 *
 * GOODVEST came back with `The operation was aborted` — the request to the
 * model was cut in flight, nothing was wrong with the email. The pipeline
 * treated it as final: needs_review, a failure mail, and a manual re-process
 * as the only way out. A three-second hiccup cost a human intervention.
 *
 * The classification below is what separates "reschedule silently" from
 * "tell the user". It reads the error message, so the one thing it must not
 * do is call our OWN parsing failures transient — a report whose `raw_label`
 * reads "timeout" would otherwise loop through the whole backoff for nothing.
 * That is what `ModelOutputError` guards, and what the last case pins.
 */
import { describe, expect, it } from 'vitest'
import { ModelOutputError, isTransientModelError } from './lib/modelRetry'

describe('isTransientModelError', () => {
  it('recognizes the failure that lost GOODVEST', () => {
    expect(isTransientModelError(new Error('The operation was aborted'))).toBe(true)
  })

  it('recognizes the other ways a provider fails under load', () => {
    expect(isTransientModelError(new Error('429 Too Many Requests'))).toBe(true)
    expect(isTransientModelError(new Error('rate limit exceeded'))).toBe(true)
    expect(isTransientModelError(new Error('503 Service Unavailable'))).toBe(true)
    expect(isTransientModelError(new Error('request timed out'))).toBe(true)
    expect(isTransientModelError(new Error('fetch failed'))).toBe(true)
  })

  it('does not retry an answer we simply cannot read', () => {
    expect(isTransientModelError(new ModelOutputError('no JSON found in model response'))).toBe(
      false,
    )
    // The guard that matters: our own error wins over its wording.
    expect(isTransientModelError(new ModelOutputError('metric "timeout" is unreadable'))).toBe(
      false,
    )
  })

  it('does not retry an unrelated failure', () => {
    expect(isTransientModelError(new Error('not_found'))).toBe(false)
  })
})
