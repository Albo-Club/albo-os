import { literals } from 'convex-helpers/validators'
import { v } from 'convex/values'

/**
 * Single source of truth for company people roles (companies.people[].role).
 * Imported by the schema and the companies mutation — NEVER redeclare.
 */
export const PERSON_ROLES = ['founder', 'board', 'coinvestor'] as const

export type PersonRole = (typeof PERSON_ROLES)[number]

export const personRoleValidator = literals(...PERSON_ROLES)

/** Which Attio object attioRecordId points at. */
export const ATTIO_RECORD_TYPES = ['person', 'company'] as const

export type AttioRecordType = (typeof ATTIO_RECORD_TYPES)[number]

export const attioRecordTypeValidator = literals(...ATTIO_RECORD_TYPES)

/**
 * A person attached to a company. Two modes covered by one shape:
 * linked to Attio (attioRecordId present) or free (name only). We store the
 * Attio record id as an opaque string — the link is built at display time
 * (Lot 5b). linkedin/email are deliberately not stored (reachable via Attio).
 *
 * A co-investor is often a fund, i.e. an Attio `companies` record rather than a
 * `people` one, hence attioRecordType: it decides which deep link is built.
 * Absent means person — every row written before company links existed.
 */
export const personValidator = v.object({
  role: personRoleValidator,
  name: v.string(),
  attioRecordId: v.optional(v.string()),
  attioRecordType: v.optional(attioRecordTypeValidator),
})
