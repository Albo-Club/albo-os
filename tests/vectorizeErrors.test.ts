import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classifyIndexError } from '../convex/lib/vectorizeErrors'

// Error shapes mirror the AI SDK's real ones: AI_RetryError carries the last
// provider error in `lastError`; AI_APICallError carries `statusCode` when an
// HTTP response came back, none when the call never landed.

function retryError(lastError: unknown) {
  const err = new Error('Failed after 3 attempts.')
  err.name = 'AI_RetryError'
  return Object.assign(err, { lastError })
}

function apiCallError(statusCode?: number) {
  const err = new Error('embedding call failed')
  err.name = 'AI_APICallError'
  return statusCode === undefined ? err : Object.assign(err, { statusCode })
}

describe('classifyIndexError', () => {
  it('finds the provider 429 behind the SDK retry wrapper (the Nebius quota shape)', () => {
    const failure = classifyIndexError(retryError(apiCallError(429)))
    assert.deepEqual(failure, { detail: 'provider_http_429', transient: true })
  })

  it('treats provider 5xx as transient', () => {
    assert.deepEqual(classifyIndexError(apiCallError(502)), {
      detail: 'provider_http_502',
      transient: true,
    })
  })

  it('treats other provider 4xx as permanent', () => {
    assert.deepEqual(classifyIndexError(retryError(apiCallError(400))), {
      detail: 'provider_http_400',
      transient: false,
    })
  })

  it('classifies a call that never got a response as unreachable', () => {
    assert.deepEqual(classifyIndexError(retryError(apiCallError())), {
      detail: 'provider_unreachable',
      transient: true,
    })
  })

  it('classifies an unusable 200 body as a bad response', () => {
    const err = new Error('could not parse embedding payload')
    err.name = 'AI_TypeValidationError'
    assert.deepEqual(classifyIndexError(err), {
      detail: 'provider_bad_response',
      transient: true,
    })
  })

  it('walks error causes when the status hides deeper', () => {
    const failure = classifyIndexError(
      new Error('outer', { cause: retryError(apiCallError(429)) }),
    )
    assert.equal(failure.detail, 'provider_http_429')
  })

  it('falls back to our own write layer for anything else', () => {
    assert.deepEqual(classifyIndexError(new Error('boom')), {
      detail: 'index_write_failed',
      transient: true,
    })
    assert.deepEqual(classifyIndexError(undefined), {
      detail: 'index_write_failed',
      transient: true,
    })
  })
})
