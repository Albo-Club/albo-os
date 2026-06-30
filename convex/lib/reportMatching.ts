/**
 * Report matching helpers — ported from Albo `resolve-company.ts` +
 * `metric-aliases.ts` (period parsing).
 *
 * Pure functions only (no DB access): extract a company domain from the email
 * body, candidate company names from the subject, and parse/normalize a
 * report period string into a sortable ms-epoch date. The actual cross-org
 * company lookup lives in `convex/reportPipeline.ts:resolveCompanyInternal`,
 * which scans organizations and uses these helpers.
 *
 * Adaptation vs Albo: a single shared inbox (report-albo-os@agentmail.to) with
 * no per-user workspace scoping — the resolver scans companies across ALL orgs
 * and derives the orgId from the matched company.
 */

// Generic mailbox / own domains that must never be treated as a company domain.
export const IGNORE_DOMAINS = new Set([
  'gmail.com',
  'outlook.com',
  'yahoo.com',
  'hotmail.com',
  'icloud.com',
  'googlemail.com',
  'agentmail.to',
  'alboteam.com',
  'albo.club',
])

// Subject noise words that pollute company-name extraction.
const SUBJECT_NOISE_WORDS = [
  'update', 'message', 'reporting', 'report', 'confidentiel', 'confidential',
  'monthly', 'quarterly', 'annual', 'weekly', 'bimonthly',
  'newsletter', 'news', 'bilan', 'performances', 'ambitions', 'draft',
  'investors', 'investisseurs', 'actionnaires', 'shareholders',
  'rapport', 'gestion', 'activité', 'information',
  'au', 'aux', 'du', 'de', 'des', 'la', 'le', 'les', 'd', 'l', 'n', 'et',
  'fwd', 'fw', 're', 'tr',
  'q1', 'q2', 'q3', 'q4',
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  '2024', '2025', '2026', '2027',
]

// Platform / service names that appear in signatures & footers but are not
// portfolio companies — excluded from body-mention matching.
export const BODY_MENTION_BLOCKLIST = new Set([
  'linkedin', 'twitter', 'facebook', 'instagram', 'youtube',
  'google', 'microsoft', 'apple', 'amazon', 'slack', 'zoom',
  'notion', 'github', 'stripe', 'hubspot', 'salesforce',
])

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract the first plausible company domain from the email body: any email
 * address whose domain is neither generic (IGNORE_DOMAINS) nor the sender's.
 */
export function extractCompanyDomain(
  bodyText: string,
  senderEmail: string,
): string | null {
  const senderDomain = senderEmail.split('@')[1]?.toLowerCase()
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g
  const allEmails = bodyText.match(emailRegex) || []

  for (const email of allEmails) {
    const domain = email.split('@')[1]?.toLowerCase()
    if (domain && !IGNORE_DOMAINS.has(domain) && domain !== senderDomain) {
      return domain
    }
  }
  return null
}

/**
 * Extract candidate company names from the subject, most precise first.
 * e.g. "Fwd: Update Caeli - Confidentiel" → ["Caeli"]
 *      "Fwd: EUTOPIA CO INVEST | REPORTING Q4 2025" → ["EUTOPIA CO INVEST"]
 */
export function extractCompanyNamesFromSubject(subject: string): Array<string> {
  let cleaned = subject
    .replace(/^(Fwd:|Re:|Fw:|Tr:)\s*/gi, '')
    .replace(/[-–—|·:]/g, ' ')
    .replace(/['']/g, ' ')
    .replace(/\d{2}\/\d{2}/g, '')
    .trim()

  const noiseRx = new RegExp(`\\b(${SUBJECT_NOISE_WORDS.join('|')})\\b`, 'gi')
  cleaned = cleaned.replace(noiseRx, ' ').replace(/\s+/g, ' ').trim()

  if (cleaned.length < 2) return []

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0)
  const candidates: Array<string> = []

  if (words.length > 0) candidates.push(words.slice(0, 4).join(' ').trim())
  if (words.length > 1 && words[0].length >= 3) candidates.push(words[0])

  return candidates.filter((c) => c.length >= 2)
}

/**
 * Strip emails + URLs from text before body-mention matching, to avoid false
 * positives (e.g. "albo" inside report@alboteam.com).
 */
export function buildBodyMentionText(subject: string, bodyText: string): string {
  return `${subject}\n${bodyText}`
    .toLowerCase()
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/https?:\/\/[^\s]+/g, '')
}

/** A company name (≥3 chars, not blocklisted) appears as a whole word. */
export function nameAppearsInText(name: string, text: string): boolean {
  if (!name || name.length < 3) return false
  if (BODY_MENTION_BLOCKLIST.has(name.toLowerCase())) return false
  const rx = new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`, 'i')
  return rx.test(text)
}

// ── Period parsing (ported from metric-aliases.ts, returns ms epoch) ─────────

const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/**
 * Parse a report_period string into a sortable ms-epoch timestamp (UTC,
 * first day of the period). Handles "January 2026", "Q4 2025", "2025",
 * "November - December 2025", "September_-_Q3_2025", bare month/quarter.
 * Returns null if unparseable.
 */
export function parsePeriodToSortMs(
  period: string,
  nowYear = new Date().getUTCFullYear(),
): number | null {
  if (!period) return null
  const p = period.replace(/_/g, ' ').trim()

  // "Month ... Year" (first month + FIRST year)
  const monthYearMatch =
    p.match(/^([a-z]+)\s.*?(\d{4})/i) || p.match(/^([a-z]+)\s+(\d{4})$/i)
  if (monthYearMatch) {
    const monthNum = MONTH_TO_NUM[monthYearMatch[1].toLowerCase()]
    const year = parseInt(monthYearMatch[2])
    if (monthNum && year) return Date.UTC(year, monthNum - 1, 1)
  }

  // "Q1 2025"
  const qMatch = p.match(/^Q(\d)\s+(\d{4})$/i)
  if (qMatch) {
    const month = (parseInt(qMatch[1]) - 1) * 3
    return Date.UTC(parseInt(qMatch[2]), month, 1)
  }

  // "Q1" alone → current year
  const qAlone = p.match(/^Q(\d)$/i)
  if (qAlone) {
    const month = (parseInt(qAlone[1]) - 1) * 3
    return Date.UTC(nowYear, month, 1)
  }

  // "2025"
  const yearMatch = p.match(/^(\d{4})$/)
  if (yearMatch) return Date.UTC(parseInt(yearMatch[1]), 0, 1)

  // "Month" alone → current year
  const monthAlone = MONTH_TO_NUM[p.toLowerCase()]
  if (monthAlone) return Date.UTC(nowYear, monthAlone - 1, 1)

  return null
}

/** Normalize a report_period string for display consistency. */
export function normalizePeriodDisplay(period: string): string {
  return period
    .replace(/_/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
}
