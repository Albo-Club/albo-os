/**
 * Link routing — ported from Albo `parse-email.ts`. Detects external document
 * links (Notion / Google Drive / DocSend) in the email content. For now we
 * only surface them (stored in `rawContent` so the analysis brain sees them);
 * downloading + OCR of these sources is deferred with the Mistral OCR work.
 */

export interface DetectedLinks {
  notion: Array<string>
  googleDrive: Array<string>
  docSend: Array<string>
}

function dedupe(matches: Array<string>): Array<string> {
  return [...new Set(matches.map((m) => m.replace(/[<>"')]+$/, '')))]
}

export function detectLinks(content: string): DetectedLinks {
  const notion = dedupe([
    ...(content.match(/https?:\/\/(www\.)?notion\.so\/[^\s<")']+/gi) || []),
    ...(content.match(/https?:\/\/[a-zA-Z0-9-]+\.notion\.site\/[^\s<")']+/gi) || []),
  ])

  const googleDrive = dedupe([
    ...(content.match(/https?:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+[^\s<")'"]*/gi) || []),
    ...(content.match(/https?:\/\/drive\.google\.com\/open\?id=[a-zA-Z0-9_-]+/gi) || []),
    ...(content.match(/https?:\/\/docs\.google\.com\/(?:document|presentation|spreadsheets)\/d\/[a-zA-Z0-9_-]+[^\s<")'"]*/gi) || []),
  ])

  const docSend = dedupe([
    ...(content.match(/https?:\/\/(www\.)?docsend\.com\/(view|v|d)\/[a-zA-Z0-9_/-]+/gi) || []),
    ...(content.match(/https?:\/\/[a-zA-Z0-9-]+\.docsend\.com\/view\/[a-zA-Z0-9_/-]+/gi) || []),
  ])

  return { notion, googleDrive, docSend }
}

/** Strip HTML to plain text (ported from Albo `clean-email-content.ts`). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
