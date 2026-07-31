/**
 * Failure classification for the semantic-indexing pipeline (vectorize.ts):
 * map a thrown error to the pipeline layer that broke, so `vectorDetail`
 * answers "where did it fail?" without opening the logs.
 *
 * Layers (cf. vectorize.ts header): our data → request out → provider →
 * provider response → our write. The AI SDK wraps the last provider error in
 * AI_RetryError (`lastError`) and nests causes, so the classifier walks the
 * chain until something carries an HTTP status.
 */

export interface IndexFailure {
  /** Machine code stored in `vectorDetail` (names the failing layer). */
  detail: string
  /** Transient failures retry; permanent ones fail (and notify) at once. */
  transient: boolean
}

export function classifyIndexError(err: unknown): IndexFailure {
  let cur: unknown = err
  for (let depth = 0; cur && depth < 6; depth++) {
    const e = cur as {
      statusCode?: unknown
      name?: unknown
      lastError?: unknown
      cause?: unknown
    }
    if (typeof e.statusCode === 'number') {
      // The provider answered with an HTTP error. 408/429 (shared token
      // quota) and 5xx recover on their own; other 4xx never will.
      return {
        detail: `provider_http_${e.statusCode}`,
        transient:
          e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500,
      }
    }
    if (e.name === 'AI_TypeValidationError' || e.name === 'AI_JSONParseError') {
      // The provider answered 200 with an unusable body.
      return { detail: 'provider_bad_response', transient: true }
    }
    if (e.name === 'AI_APICallError') {
      // The call never got an HTTP response (network, DNS, TLS).
      return { detail: 'provider_unreachable', transient: true }
    }
    cur = e.lastError ?? e.cause
  }
  // Our own code (typically the Convex write after embedding succeeded).
  return { detail: 'index_write_failed', transient: true }
}
