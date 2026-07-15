/**
 * Link detection for the report content router (brick 4).
 *
 * Detects Notion / Google Drive / DocSend links in the email body, plus
 * tracking-wrapped links (SendGrid, Mailchimp…) that hide the real URL
 * behind a redirect — resolved only when no direct link was found.
 */

export interface DetectedLinks {
  notion: Array<string>
  googleDrive: Array<{ url: string; fileId: string }>
  docSend: Array<string>
  tracking: Array<string>
}

const NOTION_PATTERNS = [
  /https?:\/\/(?:www\.)?notion\.so\/[^\s<>"')\]]+/gi,
  /https?:\/\/[a-zA-Z0-9-]+\.notion\.site\/[^\s<>"')\]]+/gi,
  // notion.com — Notion's current domain (share links like
  // app.notion.com/p/<workspace>/<Page-32hex>). Requiring the 32-hex page id
  // keeps marketing pages (notion.com/blog, /pricing…) out of the sources.
  /https?:\/\/(?:[a-zA-Z0-9-]+\.)?notion\.com\/[^\s<>"')\]]*[0-9a-f]{32}[^\s<>"')\]]*/gi,
]

const GDRIVE_PATTERNS: Array<{ rx: RegExp; grp: number }> = [
  { rx: /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)[^\s<>"')\]]*/gi, grp: 1 },
  { rx: /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/gi, grp: 1 },
  {
    rx: /https?:\/\/docs\.google\.com\/(?:document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]+)[^\s<>"')\]]*/gi,
    grp: 1,
  },
]

const DOCSEND_PATTERNS = [
  /https?:\/\/(?:www\.)?docsend\.com\/(?:view|v|d)\/[a-zA-Z0-9_/-]+/gi,
  /https?:\/\/[a-zA-Z0-9-]+\.docsend\.com\/view\/[a-zA-Z0-9_/-]+/gi,
]

// Email tracking services that wrap real links behind redirects.
const TRACKING_PATTERNS = [
  /\.ct\.sendgrid\.net\/ls\/click/i,
  /list-manage\.com\/track\/click/i,
  /click\.mailchimp\.com/i,
  /hubspotemail\.net/i,
  /sendinblue\.com\/track/i,
  /mandrillapp\.com\/track/i,
]

function matchAll(text: string, rx: RegExp): Array<string> {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  rx.lastIndex = 0
  while ((m = rx.exec(text)) !== null) {
    out.add(m[0].replace(/[<>"')\]]+$/, ''))
  }
  return [...out]
}

export function detectLinks(text: string): DetectedLinks {
  const notion = NOTION_PATTERNS.flatMap((rx) => matchAll(text, rx))

  const gdriveSeen = new Map<string, string>()
  for (const { rx, grp } of GDRIVE_PATTERNS) {
    let m: RegExpExecArray | null
    rx.lastIndex = 0
    while ((m = rx.exec(text)) !== null) {
      const fileId = m[grp]
      if (!gdriveSeen.has(fileId)) {
        gdriveSeen.set(fileId, m[0].replace(/[<>"')\]]+$/, ''))
      }
    }
  }

  const docSend = DOCSEND_PATTERNS.flatMap((rx) => matchAll(text, rx))

  // href URLs that belong to a tracking service (candidates for resolution).
  const tracking: Array<string> = []
  const hrefRx = /href=["']([^"']+)["']/gi
  let hm: RegExpExecArray | null
  while ((hm = hrefRx.exec(text)) !== null) {
    const url = hm[1]
    if (url.startsWith('http') && TRACKING_PATTERNS.some((rx) => rx.test(url))) {
      tracking.push(url)
    }
  }

  return {
    notion: [...new Set(notion)],
    googleDrive: [...gdriveSeen].map(([fileId, url]) => ({ url, fileId })),
    docSend: [...new Set(docSend)],
    tracking: [...new Set(tracking)],
  }
}

/**
 * Follow a tracking redirect to uncover the real URL. Returns null when the
 * redirect can't be resolved (timeout, error) — the link is then dropped
 * silently, per design.
 */
export async function resolveTrackingUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.url && res.url !== url ? res.url : null
  } catch {
    return null
  }
}

/** Minimal HTML → text (good enough for link detection + LLM input). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
