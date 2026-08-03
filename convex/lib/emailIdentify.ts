/**
 * Shared text helpers for matching an email against portfolio companies.
 * Used by the report identification corroboration (convex/reportIdentify.ts).
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
 * The distinct participations explicitly named in the mail, across the whole
 * candidate list (not just the model's picks). Identity key = domain when
 * present, else the lowercased name — the same rule as the ambiguity check
 * in convex/reportIdentify.ts, so several entities of one participation
 * count once.
 */
export function namedIdentities(
  candidates: Array<{ name: string; domain: string | null }>,
  subject: string,
  body: string,
): Set<string> {
  const out = new Set<string>()
  for (const c of candidates) {
    if (nameAppearsInText(c.name, subject, body)) out.add(c.domain ?? c.name.toLowerCase())
  }
  return out
}

/**
 * Should a corroborated identification be accepted?
 *
 * Corroboration is deterministic (author domain == company domain, or the
 * company name written in the mail): without it, nothing is ever matched.
 * The model's own `confidence` never overrides that evidence — it only
 * breaks the tie when the evidence is ambiguous, i.e. when the mail names
 * MORE THAN ONE participation.
 *
 * Why: a founder forwarding from a personal address (gmail…) makes domain
 * corroboration structurally impossible, and the model is instructed never
 * to guess — so it answers "low" on exactly the mails where the name is the
 * only available proof. Letting that feeling veto a verified name sent every
 * such report to the review queue.
 */
export function acceptIdentification({
  corroboratedCount,
  namedCount,
  confidence,
}: {
  corroboratedCount: number
  namedCount: number
  confidence: 'high' | 'low'
}): boolean {
  if (corroboratedCount === 0) return false
  return confidence === 'high' || namedCount <= 1
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
