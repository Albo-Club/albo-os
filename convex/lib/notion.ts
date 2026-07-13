/**
 * Public Notion page → text, via the unofficial loadPageChunk API.
 *
 * Known-fragile by design (80% historical failure rate on real reports:
 * private pages, dead links). Failure is a NOMINAL outcome for the content
 * router — this helper returns '' instead of throwing, and the row surfaces
 * an actionable "share the page publicly" message.
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
  const m = clean.match(/[0-9a-f]{32}(?![0-9a-f])/i)
  return m ? m[0] : null
}

function formatUuid(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

function flattenTitle(title: Array<Array<unknown>> | undefined): string {
  if (!title) return ''
  return title.map((seg) => (typeof seg[0] === 'string' ? seg[0] : '')).join('')
}

export async function fetchNotionText(url: string): Promise<string> {
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
    console.warn('[notion] fetch failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}
