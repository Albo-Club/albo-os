/**
 * Public Notion page → text.
 *
 * Two-step chain (see KNOWN_ISSUES.md § "Notion : extraction"):
 * 1. Unofficial loadPageChunk API — DEAD since ~07/2026 (Notion hardened its
 *    internal API: 400 even on public pages, notion-client broken too, no
 *    SSR fallback, crawler UAs blocked). Kept as a cheap first attempt so
 *    the pipeline self-heals if Notion ever reopens it.
 * 2. Headless-browser rendering — provider picked by whichever env key is
 *    set: BROWSERLESS_TOKEN (browserless.io, free tier 1000 units/month)
 *    first, else JINA_API_KEY (r.jina.ai, paid). Without any key this step
 *    is skipped and the old behavior (actionable failure) remains.
 *
 * Always returns '' instead of throwing: a failed Notion source is a
 * NOMINAL outcome for the content router (private page, dead link…).
 */

import { htmlToText } from './reportLinks'

interface NotionBlock {
  value?: {
    type?: string
    alive?: boolean
    properties?: Record<string, Array<Array<unknown>>>
    content?: Array<string>
  }
}

function extractPageId(url: string): string | null {
  const clean = url.split('?')[0]
  // Raw 32-hex id (typical notion.so / notion.site links)…
  const raw = clean.match(/[0-9a-f]{32}(?![0-9a-f])/i)
  if (raw) return raw[0]
  // …or a dashed UUID (some share links embed the id with dashes).
  const dashed = clean.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )
  return dashed ? dashed[0].replace(/-/g, '') : null
}

function formatUuid(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

function flattenTitle(title: Array<Array<unknown>> | undefined): string {
  if (!title) return ''
  return title.map((seg) => (typeof seg[0] === 'string' ? seg[0] : '')).join('')
}

/** Step 1 — unofficial API (currently dead upstream; kept for self-healing). */
async function fetchViaInternalApi(url: string): Promise<string> {
  const pageId = extractPageId(url)
  if (!pageId) return ''
  try {
    const res = await fetch('https://www.notion.so/api/v3/loadPageChunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        pageId: formatUuid(pageId),
        limit: 200,
        cursor: { stack: [] },
        chunkNumber: 0,
        verticalColumns: false,
      }),
    })
    if (!res.ok) {
      console.warn(`[notion] loadPageChunk status=${res.status} for ${url}`)
      return ''
    }
    const data = (await res.json()) as {
      recordMap?: { block?: Record<string, NotionBlock> }
    }
    const blocks = data.recordMap?.block
    if (!blocks) return ''
    const lines: Array<string> = []
    for (const block of Object.values(blocks)) {
      const v = block.value
      if (!v?.alive) continue
      const text = flattenTitle(v.properties?.title)
      if (text.trim()) lines.push(text.trim())
    }
    return lines.join('\n')
  } catch (err) {
    console.warn('[notion] api fetch failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

// Jina prefixes its markdown output with a metadata header; the real
// content starts after this marker.
const JINA_CONTENT_MARKER = 'Markdown Content:'
// Below this, the rendered output is an empty shell (SPA not loaded,
// login wall, generic Notion landing) — treat as a failure.
const MIN_USEFUL_CHARS = 200
// Give the Notion SPA time to render before snapshotting.
const RENDER_WAIT_MS = 30_000
const NOTION_CONTENT_SELECTOR = '.notion-page-content'

/** Step 2a — browserless.io /content rendering (free tier). */
async function fetchViaBrowserless(url: string): Promise<string> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return ''
  const base = process.env.BROWSERLESS_URL ?? 'https://production-sfo.browserless.io'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    const res = await fetch(`${base}/content?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle2', timeout: RENDER_WAIT_MS },
        waitForSelector: { selector: NOTION_CONTENT_SELECTOR, timeout: RENDER_WAIT_MS },
        bestAttempt: true,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.warn(`[notion] browserless status=${res.status} for ${url}`)
      return ''
    }
    const html = await res.text()
    const text = htmlToText(html)
    if (text.length < MIN_USEFUL_CHARS) {
      console.warn(`[notion] browserless returned an empty shell (${text.length} chars) for ${url}`)
      return ''
    }
    return text
  } catch (err) {
    console.warn(
      '[notion] browserless fetch failed:',
      err instanceof Error ? err.message : String(err),
    )
    return ''
  }
}

/** Step 2b — Jina Reader rendering (needs JINA_API_KEY, paid). */
async function fetchViaJinaReader(url: string): Promise<string> {
  const key = process.env.JINA_API_KEY
  if (!key) return ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Return-Format': 'markdown',
        'X-Timeout': '30',
        'X-Wait-For-Selector': NOTION_CONTENT_SELECTOR,
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.warn(`[notion] jina status=${res.status} for ${url}`)
      return ''
    }
    const raw = await res.text()
    const idx = raw.indexOf(JINA_CONTENT_MARKER)
    const content = (idx >= 0 ? raw.slice(idx + JINA_CONTENT_MARKER.length) : raw).trim()
    if (content.length < MIN_USEFUL_CHARS) {
      console.warn(`[notion] jina returned an empty shell (${content.length} chars) for ${url}`)
      return ''
    }
    return content
  } catch (err) {
    console.warn('[notion] jina fetch failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

export async function fetchNotionText(url: string): Promise<string> {
  const viaApi = await fetchViaInternalApi(url)
  if (viaApi) return viaApi
  const viaBrowserless = await fetchViaBrowserless(url)
  if (viaBrowserless) return viaBrowserless
  const viaJina = await fetchViaJinaReader(url)
  if (viaJina) return viaJina
  if (!process.env.BROWSERLESS_TOKEN && !process.env.JINA_API_KEY) {
    console.warn('[notion] no rendering provider configured (BROWSERLESS_TOKEN or JINA_API_KEY)')
  }
  return ''
}
