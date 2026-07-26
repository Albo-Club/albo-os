import { z } from 'zod'

// Shared guard for return-URL search params (`?redirect=`): the value is
// eventually handed to a navigation, so it must be constrained to a path on
// our own origin. Left unconstrained, `/login?redirect=https://evil.com` sends
// the visitor off-site right after they proved they trust the page.
//
// Do NOT rewrite this as a regex. The predicate that comes naturally —
// "starts with `/` but not `//`" — is bypassable, because the WHATWG URL
// parser strips tab/LF/CR before resolving (see KNOWN_ISSUES.md). Resolving
// against a probe origin delegates normalisation to the very parser the
// navigation will use.
const PROBE_ORIGIN = 'https://redirect-probe.invalid'

export function isInternalPath(value: string): boolean {
  // `startsWith('/')` is still needed: a bare `app` resolves onto the probe
  // origin yet is not an absolute internal path.
  if (!value.startsWith('/')) return false
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
  } catch {
    return false
  }
}

// `.catch(undefined)` rather than a throw: a hostile value degrades to "no
// redirect" and the page renders normally. An error screen would tell the
// attacker their probe was noticed.
export const internalRedirectSearch = z
  .string()
  .refine(isInternalPath)
  .optional()
  .catch(undefined)
