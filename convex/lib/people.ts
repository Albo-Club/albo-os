import { literals } from 'convex-helpers/validators'
import { v } from 'convex/values'

/**
 * Single source of truth for company people roles (companies.people[].role).
 * Imported by the schema and the companies mutation — NEVER redeclare.
 */
export const PERSON_ROLES = ['founder', 'board', 'coinvestor'] as const

export type PersonRole = (typeof PERSON_ROLES)[number]

export const personRoleValidator = literals(...PERSON_ROLES)

/**
 * A person attached to a company. Two modes covered by one shape:
 * linked to Attio (attioRecordId present) or free (name only). We store the
 * Attio record id as an opaque string — the link is built at display time
 * (Lot 5b). linkedin/email are deliberately not stored (reachable via Attio).
 */
export const personValidator = v.object({
  role: personRoleValidator,
  name: v.string(),
  attioRecordId: v.optional(v.string()),
})
