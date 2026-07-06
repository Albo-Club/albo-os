/**
 * Metrics-shape coercion for the extraction brain (Cerveau 1) fallback path.
 *
 * Pure module (no Convex/SDK import) so it stays testable via node:test.
 *
 * The Zod schema in convex/reportAnalysis.ts expects `metrics` as a
 * {key,value}[] array (structured-output friendly), but EXTRACTION_SYSTEM_PROMPT
 * (ported verbatim from Albo) describes metrics as a flat dict `{ revenue: 123 }`.
 * In the `generateObject` path the schema steers the model, so the array shape
 * comes out. But the `generateText` fallback has no schema to steer it, so the
 * model follows the prompt and emits a dict — which then fails `safeParse` and
 * throws, killing the whole pipeline. `coerceMetrics` bridges that gap by
 * normalizing a dict (or stringified numbers) into the array shape before
 * validation. Arrays pass through untouched; non-numeric values are dropped
 * (the schema requires `value: number`).
 */

/** Parse a metric value into a finite number, or null if not numeric. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    // Strip thousands separators, whitespace and unit symbols (%, currency).
    const cleaned = value.replace(/[\s,%€$]/g, '')
    if (cleaned === '') return null // Number('') is 0, not NaN — guard it.
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * If `parsed.metrics` is a plain object, rewrite it to a {key,value}[] array.
 * Returns the (mutated) input for convenience; non-objects pass through.
 */
export function coerceMetrics(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return parsed
  const obj = parsed as Record<string, unknown>
  const m = obj.metrics
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    obj.metrics = Object.entries(m as Record<string, unknown>)
      .map(([key, value]) => ({ key, value: toNumber(value) }))
      .filter((e): e is { key: string; value: number } => e.value !== null)
  }
  return obj
}
