/**
 * Domain normalisation — reduce a messy user- or import-provided value to a
 * bare hostname usable both for the logo hotlink (logo.dev) and for the
 * website auto-enrichment fetch (`https://<domain>`).
 *
 * Handles the corruption seen in the Calte import (cf. KNOWN_ISSUES.md
 * "Domaines corrompus"): markdown links `[www.x.com](https://www.x.com)`,
 * full URLs with protocol, path, query string and tracking params, and a
 * leading `www.`.
 *
 * Returns the cleaned bare domain, or `null` when the input can't be reduced
 * to a plausible hostname (no dot, spaces left over) — callers decide whether
 * to keep the raw value or flag it.
 */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  // Markdown link [text](url) → prefer the url, fall back to the text.
  const md = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(s)
  if (md) s = md[2] || md[1]
  s = s
    .replace(/^https?:\/\//i, '') // protocol
    .replace(/[/?#].*$/, '') // path / query / fragment
    .replace(/^www\./i, '') // leading www.
    .trim()
    .toLowerCase()
  // Must look like a hostname: a dot, no whitespace, no leftover brackets.
  if (!s || /[\s[\]()]/.test(s) || !s.includes('.')) return null
  return s
}

/**
 * Hotlinked company logo, same source as the app's `CompanyLogo`. Null without
 * a domain or a token — callers then fall back to the company's initial, so a
 * missing env var costs a letter, never a broken image.
 */
export function companyLogoUrl(domain: string | undefined): string | null {
  const token = process.env.LOGO_DEV_TOKEN ?? process.env.VITE_LOGO_DEV_TOKEN
  if (!domain || !token) return null
  return `https://img.logo.dev/${domain}?token=${token}&size=128&format=png`
}
