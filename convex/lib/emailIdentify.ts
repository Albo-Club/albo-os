/**
 * Shared helpers for matching an email against portfolio companies: text
 * lookup, and the identity rule that decides what "the same participation"
 * means. Used by the report identification corroboration
 * (convex/reportIdentify.ts) and by the manual attach (convex/reportInbox.ts).
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

export interface IdentityCandidate {
  name: string
  domain: string | null
}

export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Domains carried by MORE THAN ONE participation — a sponsor domain
 * (hellosezame.com, parallel-invest.com, anaxago.com…) where each vehicle is
 * its own participation. Such a domain says who writes, never which vehicle,
 * so it must not identify one.
 */
export function sharedDomains(candidates: Array<IdentityCandidate>): Set<string> {
  const namesByDomain = new Map<string, Set<string>>()
  for (const c of candidates) {
    const domain = c.domain?.toLowerCase().trim()
    if (!domain) continue
    const names = namesByDomain.get(domain) ?? new Set<string>()
    names.add(normalizeName(c.name))
    namesByDomain.set(domain, names)
  }
  const shared = new Set<string>()
  for (const [domain, names] of namesByDomain) {
    if (names.size > 1) shared.add(domain)
  }
  return shared
}

/**
 * What a candidate identifies. The domain, when it belongs to a single
 * participation — two entities of the same company (across orgs, or twice in
 * one) then share a key and fan out together. On a shared domain the name is
 * the only per-entity signal left, so it becomes the key.
 */
export function identityKey(candidate: IdentityCandidate, shared: Set<string>): string {
  const domain = candidate.domain?.toLowerCase().trim()
  if (domain && !shared.has(domain)) return domain
  return normalizeName(candidate.name)
}

/**
 * The distinct participations explicitly named in the mail, across the whole
 * candidate list (not just the model's picks) — the same identity rule as the
 * ambiguity check in convex/reportIdentify.ts, so several entities of one
 * participation count once.
 */
export function namedIdentities(
  candidates: Array<IdentityCandidate>,
  subject: string,
  body: string,
  shared: Set<string>,
): Set<string> {
  const out = new Set<string>()
  for (const c of candidates) {
    if (nameAppearsInText(c.name, subject, body)) out.add(identityKey(c, shared))
  }
  return out
}

/**
 * Makes corroborated picks specific on a shared domain.
 *
 * The author's domain proves the sponsor, not the vehicle: when several
 * vehicles live on it, only a name hit selects one. So within such a group,
 * name-corroborated picks win; and with none, the pick is replaced by EVERY
 * entity of the domain — the mail really is about one of them and we cannot
 * tell which, which the caller's ambiguity check turns into a review.
 */
export function resolveOnSharedDomains<TCandidate extends IdentityCandidate>(
  corroborated: Array<{ candidate: TCandidate; method: string }>,
  candidates: Array<TCandidate>,
  shared: Set<string>,
): Array<{ candidate: TCandidate; method: string }> {
  const out: Array<{ candidate: TCandidate; method: string }> = []
  const done = new Set<string>()
  for (const entry of corroborated) {
    const domain = entry.candidate.domain?.toLowerCase().trim()
    if (!domain || !shared.has(domain)) {
      out.push(entry)
      continue
    }
    if (done.has(domain)) continue
    done.add(domain)
    const named = corroborated.filter(
      (e) => e.candidate.domain?.toLowerCase().trim() === domain && e.method.includes('name'),
    )
    if (named.length > 0) {
      out.push(...named)
    } else {
      out.push(
        ...candidates
          .filter((c) => c.domain?.toLowerCase().trim() === domain)
          .map((candidate) => ({ candidate, method: 'domain' })),
      )
    }
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
