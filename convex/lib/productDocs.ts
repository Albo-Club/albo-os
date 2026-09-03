/**
 * The product documentation (`docs/produit/*.md`) as data, plus a keyword
 * search over it. Pure module (no Convex/SDK import) shared by the in-app
 * reader and ⌘K (`src/lib/produitDocs.ts` re-exports it), by the agent tools
 * (`convex/agentToolsProductDocs.ts`), by the MCP registry and by
 * tests/productDocs.test.ts.
 *
 * The pages come from `productDocs.generated.ts`, written by
 * `scripts/gen-product-docs.mjs` — see that script for why the folder is not
 * imported directly.
 *
 * The search is deliberately explainable: fold accents and case, drop stop
 * words, count the query terms per line, weigh the title and the headings,
 * count body hits per 1 000 characters so a long page does not win by volume.
 * No stemming, no ranking model — 19 pages do not need one, and a result has
 * to be predictable to be trusted.
 */

import { PRODUCT_DOCS } from './productDocs.generated'
import type { ProductDocSource } from './productDocs.generated'

export type ProductDoc = ProductDocSource

/** The summary page (`README.md`) — the index, not an entry of the list. */
export const productDocsSummary: ProductDoc = PRODUCT_DOCS.find(
  (doc) => doc.slug === 'README',
) ?? { slug: 'README', title: 'Documentation', markdown: '' }

/** Every page except the summary, in reading order (file names are numbered). */
export const productDocs: Array<ProductDoc> = PRODUCT_DOCS.filter(
  (doc) => doc.slug !== 'README',
)

export function getProductDoc(slug: string): ProductDoc | undefined {
  return productDocs.find((doc) => doc.slug === slug)
}

/** One line per page, `slug — title`, for the agent's system prompt. */
export const PRODUCT_DOC_INDEX = productDocs
  .map((doc) => `${doc.slug} — ${doc.title}`)
  .join('\n')

// ─── Search ─────────────────────────────────────────────────────────────────

/** Lower-case, accents stripped: « Prévisionnel » → `previsionnel`. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Words that carry no subject — articles, question words — in the two
 * languages the docs are queried in. Without this, « annuler un deal » is
 * won by the page that says « un » the most.
 */
const STOP_WORDS = new Set([
  // French
  'un',
  'une',
  'le',
  'la',
  'les',
  'l',
  'd',
  'de',
  'des',
  'du',
  'et',
  'ou',
  'en',
  'au',
  'aux',
  'a',
  'ce',
  'cet',
  'cette',
  'ces',
  'mon',
  'ma',
  'mes',
  'je',
  'il',
  'elle',
  'on',
  'qui',
  'que',
  'quoi',
  'quel',
  'quelle',
  'est',
  'sont',
  'pour',
  'par',
  'avec',
  'sans',
  'dans',
  'sur',
  'pas',
  'ne',
  'se',
  'sa',
  'son',
  'ses',
  'comment',
  'marche',
  'fonctionne',
  'faire',
  // English
  'the',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'are',
  'do',
  'does',
  'how',
  'what',
  'work',
  'works',
  'my',
])

/**
 * The query's folded terms — split on anything that is not a letter or a
 * digit — minus stop words and anything under 2 characters.
 */
export function queryTerms(query: string): Array<string> {
  return fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2 && !STOP_WORDS.has(term))
}

export type ProductDocHit = {
  slug: string
  title: string
  /** Nearest H2/H3 above the excerpt; absent when the match sits before one. */
  heading?: string
  excerpt: string
}

const HEADING = /^(#{1,3})\s+(.+)$/
/** A term in the H1 names the page's subject: that page comes first. */
const TITLE_WEIGHT = 50
/** A term in an H2/H3 weighs this much; body hits weigh 1 per 1 000 chars. */
const HEADING_WEIGHT = 8
/** Characters kept on each side of the matched term in an excerpt. */
const EXCERPT_RADIUS = 90

type IndexedLine = {
  /** Display text: markdown markers stripped. */
  text: string
  folded: string
  /** 1–3 for a heading line, 0 for body. */
  level: number
}

type IndexedDoc = { doc: ProductDoc; lines: Array<IndexedLine> }

/** Leading list/quote/heading markers and bold markers, for readable excerpts. */
function displayText(line: string): string {
  return line
    .replace(/^[\s#>*-]+/, '')
    .replace(/\*\*/g, '')
    .trim()
}

let corpus: Array<IndexedDoc> | undefined

/**
 * Folded once, on the first search rather than at module load: the module
 * is bundled into the org layout (⌘K), so the fold must not tax app startup.
 */
function getCorpus(): Array<IndexedDoc> {
  corpus ??= productDocs.map((doc) => ({
    doc,
    lines: doc.markdown.split('\n').map((line) => {
      const heading = line.match(HEADING)
      const text = heading ? heading[2].trim() : displayText(line)
      return {
        text,
        folded: fold(text),
        level: heading ? heading[1].length : 0,
      }
    }),
  }))
  return corpus
}

function occurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Pages ranked by relevance for a keyword query. Score of a page = per term,
 * TITLE_WEIGHT if the H1 carries it + HEADING_WEIGHT × occurrences in H2/H3
 * lines + body occurrences per 1 000 characters of the page; a page carrying
 * every term outranks one stuffed with a single term. Score 0 is dropped;
 * ties keep reading order.
 */
export function searchProductDocs(
  query: string,
  limit = 8,
): Array<ProductDocHit> {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const scored: Array<{ entry: IndexedDoc; score: number }> = []
  for (const entry of getCorpus()) {
    let score = 0
    let missing = false
    const perKilo = 1000 / entry.doc.markdown.length
    for (const term of terms) {
      let termScore = 0
      for (const line of entry.lines) {
        const n = occurrences(line.folded, term)
        if (n === 0) continue
        if (line.level === 1) termScore += TITLE_WEIGHT
        else if (line.level > 0) termScore += n * HEADING_WEIGHT
        else termScore += n * perKilo
      }
      if (termScore === 0) missing = true
      score += termScore
    }
    if (score === 0) continue
    if (!missing && terms.length > 1) score *= 2
    scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ entry }) => hitOf(entry, terms))
}

/**
 * The excerpt shows the longest term (the most specific one) in the first
 * line carrying it below the H1 — the H1 is already the hit's title. A match
 * on a heading yields that heading and the first line of its section; a term
 * found only in the title yields the page's first paragraph.
 */
function hitOf(entry: IndexedDoc, terms: Array<string>): ProductDocHit {
  const { slug, title } = entry.doc
  const key = terms.reduce((a, b) => (b.length > a.length ? b : a))
  let heading: string | undefined
  const { lines } = entry
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.level === 1) continue
    const index = line.folded.indexOf(key)
    if (line.level > 0) {
      if (index !== -1) {
        const first = lines.slice(i + 1).find((l) => l.level === 0 && l.text)
        return {
          slug,
          title,
          heading: line.text,
          excerpt: first ? excerptAround(first.text, 0, 0) : line.text,
        }
      }
      heading = line.text
      continue
    }
    if (index !== -1) {
      return {
        slug,
        title,
        heading,
        excerpt: excerptAround(line.text, index, key.length),
      }
    }
  }
  const first = lines.find((l) => l.level === 0 && l.text)
  return {
    slug,
    title,
    excerpt: first ? excerptAround(first.text, 0, 0) : title,
  }
}

/** ±EXCERPT_RADIUS characters around [index, index + length), cut on words. */
function excerptAround(text: string, at: number, length: number): string {
  const index = Math.min(at, text.length)
  let start = Math.max(0, index - EXCERPT_RADIUS)
  let end = Math.min(text.length, index + length + EXCERPT_RADIUS)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < index) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > index + length) end = space
  }
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return `${head}${text.slice(start, end)}${tail}`
}

export type ExcerptSegment = { text: string; match: boolean }

/**
 * Splits `text` into matched / unmatched runs of the terms (accent- and
 * case-insensitive), for the UI to <mark> the hits. The fold preserves string
 * length for French text (é → e); on the rare character where it does not,
 * the whole text comes back unmarked rather than marked at the wrong offset.
 */
export function splitByTerms(
  text: string,
  terms: Array<string>,
): Array<ExcerptSegment> {
  if (text === '') return []
  const folded = fold(text)
  if (folded.length !== text.length || terms.length === 0) {
    return [{ text, match: false }]
  }
  const flags = new Array<boolean>(text.length).fill(false)
  for (const term of terms) {
    let index = folded.indexOf(term)
    while (index !== -1) {
      flags.fill(true, index, index + term.length)
      index = folded.indexOf(term, index + term.length)
    }
  }
  const segments: Array<ExcerptSegment> = []
  let from = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || flags[i] !== flags[from]) {
      segments.push({ text: text.slice(from, i), match: flags[from] })
      from = i
    }
  }
  return segments
}
