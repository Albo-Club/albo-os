/**
 * Does a freshly analysed report describe a document the company already has
 * on file?
 *
 * Storage keys a report on (company, period), and the period is read by the
 * MODEL. Two forwards of the same WARO update, three minutes apart, were read
 * "S1 2026" and "no period at all" (09/2026): two keys, two rows, two
 * announcements. Identity cannot rest on a non-deterministic field, and it
 * cannot rest on the period slot either — the twin has to be looked for in the
 * company's NEIGHBOURHOOD, whatever period each reading landed on.
 *
 * So the document is identified by what it says. The master signal is the
 * source text itself (the mail body plus what was read from its files), which
 * is the same bytes on both forwards; the forwarding wrapper each mail client
 * prepends is dropped first, and the rest is compared on 5-word shingles so a
 * re-flowed line or a signature block cannot flip the verdict. Metrics and
 * title back it up when the text cannot be compared — a file that OCR'd on one
 * forward and failed on the other.
 *
 * Three outcomes, on purpose: `duplicate` (certain, filed silently in place),
 * `doubt` (NOTHING is filed — the mail waits in the review queue for a human),
 * and `new`. The bar for `duplicate` is deliberately high: being wrong there
 * loses a real report, while being wrong on `doubt` only costs one click.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Past this delay the same document is a new one. Same bound, and the same
 * reason, as the period-less dedup of `reportStore.isSameDocument`: the yearly
 * courrier at an identical subject («Convocation AG») must not be mistaken for
 * last year's.
 */
export const COMPARE_WINDOW_MS = 30 * DAY_MS

/** Words per shingle. Long enough that boilerplate sentences don't collide. */
const SHINGLE = 5

/** Jaccard above which two texts ARE the same document. */
const SAME_DOCUMENT = 0.9

/** Jaccard above which two texts look alike enough to ask a human. */
const SUSPICIOUS = 0.6

/**
 * Jaccard above which the SOURCE is unchanged, so the re-send brings nothing.
 * Not 1: the OCR runs again on each forward and its provider is free to word a
 * scanned page slightly differently. Below it, the document itself moved — a
 * corrected re-send — and that IS news (cf. `reportStore.reportContentChanged`).
 */
const SAME_SOURCE = 0.98

/** Compared text is capped: the tail of a very long report decides nothing. */
const MAX_COMPARE_CHARS = 40_000

/**
 * `Re:` / `Fwd:` / `Tr:` chains a mail client prepends — noise added by the
 * delivery, never by the document. Kept in sync with `reportStore`, which
 * applies the same rule to the period-less dedup.
 */
const FORWARD_PREFIXES = /^(?:\s*(?:re|ré|fw|fwd|tr|trans(?:fert)?)\s*:\s*)+/i

/**
 * Where the forwarded document starts. Everything above is the wrapper: the
 * forwarder's own note and their client's separator — different on every
 * forward of the same document, which is exactly what must not be compared.
 * The LAST marker wins: forwarding a forward nests them, and the innermost one
 * is where the document really begins.
 */
const FORWARD_MARKERS = [
  /-+\s*forwarded message\s*-+/gi,
  /-+\s*message transféré\s*-+/gi,
  /begin forwarded message\s*:/gi,
  /-+\s*original message\s*-+/gi,
  /-+\s*message d'origine\s*-+/gi,
]

/**
 * The header block a forward reproduces under its separator. `To:` names the
 * forwarder, so it differs on every forward of the SAME document — the one
 * part of the quoted mail that must not be compared.
 */
const HEADER_LINE =
  /^\s*>*\s*(?:de|from|exp[ée]diteur|date|envoy[ée]|sent|objet|subject|[àa]|to|cc|cci|bcc|r[ée]pondre [àa]|reply-to)\s*:/i

function skipHeaders(text: string): string {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && (lines[i].trim() === '' || HEADER_LINE.test(lines[i]))) i++
  return lines.slice(i).join('\n')
}

function stripWrapper(text: string): string {
  let start = 0
  for (const marker of FORWARD_MARKERS) {
    marker.lastIndex = 0
    for (let m = marker.exec(text); m; m = marker.exec(text)) {
      start = Math.max(start, m.index + m[0].length)
    }
  }
  // Also from the top: some clients quote the headers with no separator line
  // at all, and then there is no marker to cut on.
  return skipHeaders(text.slice(start))
}

/** Lowercased words only: punctuation, line breaks and quote markers are layout. */
function normalize(text: string): string {
  return text
    .slice(0, MAX_COMPARE_CHARS)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function shingles(text: string): Set<string> {
  const words = normalize(stripWrapper(text)).split(' ').filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    out.add(words.slice(i, i + SHINGLE).join(' '))
  }
  return out
}

/** Jaccard of the two shingle sets, or null when a text is too short to say. */
function similarity(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null
  const setA = shingles(a)
  const setB = shingles(b)
  if (setA.size === 0 || setB.size === 0) return null
  let shared = 0
  for (const s of setA) if (setB.has(s)) shared++
  return shared / (setA.size + setB.size - shared)
}

function squash(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function subjectKey(subject: string | undefined): string {
  return squash((subject ?? '').replace(FORWARD_PREFIXES, ''))
}

/** Key-sorted, because the extraction rebuilds the map on every run. */
function metricsKey(metrics: unknown): string {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return ''
  const entries = Object.entries(metrics as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return entries.length === 0 ? '' : JSON.stringify(entries)
}

function metricsCount(metrics: unknown): number {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return 0
  return Object.keys(metrics).length
}

/** A report already on file, reduced to what identifies its document. */
export interface ComparableReport {
  reportId: string
  title?: string
  subject?: string
  emailDate?: number
  reportPeriod?: string
  rawContent?: string
  metrics?: unknown
}

/** The report that just came out of the analysis. */
export interface IncomingDocument {
  title: string
  subject: string
  receivedAt: number
  rawContent?: string
  metrics?: unknown
}

/** Machine codes — dev-facing, never rendered as such. */
export type DuplicateReason =
  | 'same_text'
  | 'same_metrics_and_title'
  | 'similar_text'
  | 'same_title'
  | 'same_subject'

export type DuplicateVerdict =
  | { kind: 'new' }
  | {
      kind: 'duplicate' | 'doubt'
      reportId: string
      reason: DuplicateReason
      similarity: number | null
      /** Certain AND unchanged at the source: the re-send announces nothing. */
      sameSource: boolean
    }

/** Rank so the best candidate wins: a certainty beats a doubt, then closeness. */
function rank(v: Exclude<DuplicateVerdict, { kind: 'new' }>): number {
  return (v.kind === 'duplicate' ? 10 : 0) + (v.similarity ?? 0)
}

function compareOne(
  incoming: IncomingDocument,
  candidate: ComparableReport,
): DuplicateVerdict {
  if (candidate.emailDate === undefined) return { kind: 'new' }
  if (Math.abs(candidate.emailDate - incoming.receivedAt) > COMPARE_WINDOW_MS) {
    return { kind: 'new' }
  }

  const sim = similarity(incoming.rawContent, candidate.rawContent)
  const titleEq = squash(incoming.title) === squash(candidate.title) && squash(incoming.title) !== ''
  const subjectEq =
    subjectKey(incoming.subject) === subjectKey(candidate.subject) && subjectKey(incoming.subject) !== ''
  const sameSource = sim !== null && sim >= SAME_SOURCE
  const base = { reportId: candidate.reportId, similarity: sim, sameSource }

  if (sim !== null && sim >= SAME_DOCUMENT) {
    return { ...base, kind: 'duplicate', reason: 'same_text' }
  }
  // Text unusable on one side — a file read on one forward, failed on the
  // other. Identical figures under an identical title say the same thing.
  if (
    titleEq &&
    metricsCount(incoming.metrics) >= 2 &&
    metricsKey(incoming.metrics) === metricsKey(candidate.metrics)
  ) {
    return { ...base, kind: 'duplicate', reason: 'same_metrics_and_title' }
  }
  if (sim !== null && sim >= SUSPICIOUS) {
    return { ...base, kind: 'doubt', reason: 'similar_text' }
  }
  if (titleEq) return { ...base, kind: 'doubt', reason: 'same_title' }
  if (subjectEq) return { ...base, kind: 'doubt', reason: 'same_subject' }
  return { kind: 'new' }
}

/** The best verdict the candidates can produce for this incoming document. */
export function findDuplicate(
  incoming: IncomingDocument,
  candidates: Array<ComparableReport>,
): DuplicateVerdict {
  let best: Exclude<DuplicateVerdict, { kind: 'new' }> | null = null
  for (const candidate of candidates) {
    const verdict = compareOne(incoming, candidate)
    if (verdict.kind === 'new') continue
    if (!best || rank(verdict) > rank(best)) best = verdict
  }
  return best ?? { kind: 'new' }
}
