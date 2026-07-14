/**
 * Public Notion page → text.
 *
 * Two-step chain (see KNOWN_ISSUES.md § "Notion : extraction"):
 * 1. Unofficial loadPageChunk API — DEAD since ~07/2026 (Notion hardened its
 *    internal API: 400 even on public pages, notion-client broken too, no
 *    SSR fallback, crawler UAs blocked). Kept as a cheap first attempt so
 *    the pipeline self-heals if Notion ever reopens it.
 * 2. Jina Reader (r.jina.ai) — headless-browser rendering returning
 *    markdown. Requires JINA_API_KEY (anonymous access is blocked for
 *    datacenter IPs); without the key this step is skipped and the old
 *    behavior (actionable failure) remains.
 *
 * Always returns '' instead of throwing: a failed Notion source is a
 * NOMINAL outcome for the content router (private page, dead link…).
 */

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

/** Step 2 — Jina Reader rendering (needs JINA_API_KEY). */
async function fetchViaJinaReader(url: string): Promise<string> {
  const key = process.env.JINA_API_KEY
  if (!key) {
    console.warn('[notion] JINA_API_KEY not set — rendering fallback skipped')
    return ''
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Return-Format': 'markdown',
        // Give the Notion SPA time to render before snapshotting.
        'X-Timeout': '30',
        'X-Wait-For-Selector': '.notion-page-content',
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
  return await fetchViaJinaReader(url)
}
