/**
 * Shared text helpers for matching an email against portfolio companies.
 * Used by the Gmail timeline matching (convex/gmail.ts) and the report
 * identification corroboration (convex/reportIdentify.ts).
 */

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whole-word company-name lookup in the email text, with emails and URLs
 * stripped first (lesson from Albo App: "alboteam" inside
 * report@alboteam.com must not match a company named Alboteam).
 */
export function nameAppearsInText(name: string, subject: string, body: string): boolean {
  if (name.length < 3) return false
  const text = `${subject}\n${body}`
    .toLowerCase()
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/https?:\/\/\S+/g, '')
  return new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`).test(text)
}

/**
 * Platform/service names that live in signatures and footers of ordinary
 * mail — a portfolio company carrying one of these names would link half
 * the inbox (lesson from Albo App's body-mention matching).
 */
export const NAME_MENTION_BLOCKLIST = new Set([
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'youtube',
  'google',
  'microsoft',
  'apple',
  'amazon',
  'slack',
  'zoom',
  'notion',
  'github',
  'stripe',
  'hubspot',
  'salesforce',
])

/** Every distinct email address appearing in a text (body-domain matching:
 * forward blocks, signatures, quoted threads). */
export function extractEmailAddresses(text: string): Array<string> {
  const matches = text.match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []
  return [...new Set(matches.map((a) => a.toLowerCase()))]
}

/** Lenient JSON extraction from a raw model answer (generateText fallback
 * when generateObject fails — some models mishandle structured output). */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('no JSON found in model response')
  }
}
