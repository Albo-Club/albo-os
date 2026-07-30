/**
 * Attio search (outbound, read-only) — people and companies.
 *
 * Backend-only search powering the company fiche's identity panel. The Attio
 * API key (`ATTIO_API_KEY`, shared with the deals re-fetch in attioSync.ts)
 * NEVER reaches the browser: the front calls `searchPeople` / `searchCompanies`
 * (actions — only actions do external network), which query Attio's `people` /
 * `companies` objects and return a normalized, capped list of records.
 *
 * Auth: actions have no `ctx.db`, so org membership is checked through the
 * `requireMember` internalQuery (same pattern as internal.chat.actionAuthProbe).
 * A non-member is rejected (throw). Everything else degrades softly to an empty
 * list + an error signal ('config' | 'upstream') so the panel stays usable and
 * the manual-entry path (people, Lot 5b) keeps working. The key is never logged.
 *
 * Read-only: no write to Attio, nothing persisted here — only the record id the
 * user picks, saved by companies.update.
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { action, internalQuery } from './_generated/server'
import { requireOrgMember } from './lib/auth'

const ATTIO_API_BASE = 'https://api.attio.com'
const RESULT_LIMIT = 8
const MIN_QUERY_LENGTH = 2

// ─── Untyped-JSON helpers (Attio query responses) ────────────────────────────
// Same defensive style as convex/attioSync.ts: never trust the shape.

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : []
}

/**
 * Active value of a historized Attio attribute: the entry with
 * `active_until === null`, falling back to the last one (defensive). Mirror of
 * activeEntry() in attioSync.ts (kept local to keep the two files decoupled).
 */
function activeEntry(value: unknown): Record<string, unknown> | null {
  const arr = asArray(value)
  if (arr.length === 0) return null
  const active = arr.find((e) => asRecord(e).active_until == null)
  return asRecord(active ?? arr[arr.length - 1])
}

/** Display name of a company record: the active `name` entry's value. */
function companyName(values: Record<string, unknown>): string | null {
  const entry = activeEntry(values.name)
  const name = entry ? asString(entry.value) : undefined
  return name && name.trim() !== '' ? name : null
}

/**
 * First domain of a company record. Shown next to the name in the picker:
 * company names collide often enough that the name alone can't be picked from
 * with confidence. Absent on companies with no website in Attio.
 */
function companyDomain(values: Record<string, unknown>): string | undefined {
  const entry = activeEntry(values.domains)
  const domain = entry ? asString(entry.domain) : undefined
  return domain && domain.trim() !== '' ? domain : undefined
}

/** Display name of a person record: full_name, else "first last". */
function personName(values: Record<string, unknown>): string | null {
  const entry = activeEntry(values.name)
  if (!entry) return null
  const full = asString(entry.full_name)
  if (full && full.trim() !== '') return full
  const first = asString(entry.first_name) ?? ''
  const last = asString(entry.last_name) ?? ''
  const joined = `${first} ${last}`.trim()
  return joined === '' ? null : joined
}

// ─── Auth probe (actions have no ctx.db) ─────────────────────────────────────

export const requireMember = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgMember(ctx, orgId)
    return null
  },
})

// ─── Search actions ──────────────────────────────────────────────────────────

const resultValidator = v.object({
  results: v.array(v.object({ name: v.string(), attioRecordId: v.string() })),
  error: v.optional(v.union(v.literal('config'), v.literal('upstream'))),
})

export const searchPeople = action({
  args: { orgId: v.id('organizations'), query: v.string() },
  returns: resultValidator,
  handler: async (ctx, { orgId, query }) => {
    // Auth first — a non-member must never reach the Attio call. This throws
    // (security boundary), unlike the soft degradations below.
    await ctx.runQuery(internal.attio.requireMember, { orgId })

    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) return { results: [] }

    const apiKey = process.env.ATTIO_API_KEY
    if (!apiKey) {
      console.warn('[attio] searchPeople: ATTIO_API_KEY not set')
      return { results: [], error: 'config' as const }
    }

    let json: unknown
    try {
      const res = await fetch(
        `${ATTIO_API_BASE}/v2/objects/people/records/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          // Partial match on the personal-name attribute. If Attio ever
          // narrows this more than expected, swap $contains → $starts_with.
          body: JSON.stringify({
            filter: { name: { $contains: q } },
            limit: RESULT_LIMIT,
          }),
        },
      )
      if (!res.ok) {
        // Status only — never the key. A 403/404 here typically means the
        // token lacks read scope on the people object.
        console.warn(`[attio] searchPeople failed: status=${res.status}`)
        return { results: [], error: 'upstream' as const }
      }
      json = await res.json()
    } catch (err) {
      console.warn(
        `[attio] searchPeople transport error: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      )
      return { results: [], error: 'upstream' as const }
    }

    const data = asArray(asRecord(json).data)
    const results = data
      .map((rec) => {
        const recordId = asString(asRecord(asRecord(rec).id).record_id)
        const name = personName(asRecord(asRecord(rec).values))
        return recordId && name ? { name, attioRecordId: recordId } : null
      })
      .filter((r): r is { name: string; attioRecordId: string } => r !== null)
      .slice(0, RESULT_LIMIT)

    return { results }
  },
})

const companyResultValidator = v.object({
  results: v.array(
    v.object({
      name: v.string(),
      attioRecordId: v.string(),
      domain: v.optional(v.string()),
    }),
  ),
  error: v.optional(v.union(v.literal('config'), v.literal('upstream'))),
})

/**
 * Company search, mirror of `searchPeople` on Attio's `companies` object. Feeds
 * the "Fiche Attio" row of the identity panel, where the picked `record_id`
 * becomes `companies.attioCompanyId` — the anchor the deal sync resolves
 * against. Unlike people, a free-typed value is meaningless here: the user can
 * only pick from these results.
 */
export const searchCompanies = action({
  args: { orgId: v.id('organizations'), query: v.string() },
  returns: companyResultValidator,
  handler: async (ctx, { orgId, query }) => {
    // Auth first — a non-member must never reach the Attio call. This throws
    // (security boundary), unlike the soft degradations below.
    await ctx.runQuery(internal.attio.requireMember, { orgId })

    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) return { results: [] }

    const apiKey = process.env.ATTIO_API_KEY
    if (!apiKey) {
      console.warn('[attio] searchCompanies: ATTIO_API_KEY not set')
      return { results: [], error: 'config' as const }
    }

    let json: unknown
    try {
      const res = await fetch(
        `${ATTIO_API_BASE}/v2/objects/companies/records/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: { name: { $contains: q } },
            limit: RESULT_LIMIT,
          }),
        },
      )
      if (!res.ok) {
        // Status only — never the key. A 403/404 here typically means the
        // token lacks read scope on the companies object.
        console.warn(`[attio] searchCompanies failed: status=${res.status}`)
        return { results: [], error: 'upstream' as const }
      }
      json = await res.json()
    } catch (err) {
      console.warn(
        `[attio] searchCompanies transport error: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      )
      return { results: [], error: 'upstream' as const }
    }

    const data = asArray(asRecord(json).data)
    const results = data
      .map((rec) => {
        const values = asRecord(asRecord(rec).values)
        const recordId = asString(asRecord(asRecord(rec).id).record_id)
        const name = companyName(values)
        if (!recordId || !name) return null
        const domain = companyDomain(values)
        return { name, attioRecordId: recordId, ...(domain ? { domain } : {}) }
      })
      .filter(
        (r): r is { name: string; attioRecordId: string; domain?: string } =>
          r !== null,
      )
      .slice(0, RESULT_LIMIT)

    return { results }
  },
})
