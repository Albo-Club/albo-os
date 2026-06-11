import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

const LAST_ORG_COOKIE = 'last_org_slug'
const ONE_YEAR = 60 * 60 * 24 * 365

// The cookie is used as a redirect target (`/app/$orgSlug`): bound its
// contents to a plausible slug before using it.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function sanitize(value: string | null | undefined): string | null {
  return value && SLUG_RE.test(value) ? value : null
}

/**
 * Last org visited on THIS browser, read isomorphically (cookie, same pattern
 * as `getLocale`). Fast-path for the `/app` → `/app/$orgSlug` redirect: on the
 * server the document request is redirected before any render, on the client
 * we don't wait for Convex auth nor `users.me` just to recover the slug. The
 * cross-device source of truth stays `users.lastOrgSlug` (mutation
 * `setLastOrg`) — the cookie is only a device-local shortcut, re-validated by
 * the org layout (non-member → `clearLastOrgCookie()` then back to `/app`,
 * otherwise a redirect loop).
 */
export const getLastOrgSlugCookie = createIsomorphicFn()
  .server((): string | null => sanitize(getCookie(LAST_ORG_COOKIE)))
  .client((): string | null => {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${LAST_ORG_COOKIE}=([^;]*)`),
    )
    return sanitize(match ? decodeURIComponent(match[1]) : null)
  })

/** Persist the last visited org (written by the org layout, client-side). */
export function writeLastOrgCookie(slug: string): void {
  document.cookie = `${LAST_ORG_COOKIE}=${slug}; path=/; max-age=${ONE_YEAR}; samesite=lax`
}

/** Clear the cookie — mandatory BEFORE sending a non-member back to /app. */
export function clearLastOrgCookie(): void {
  document.cookie = `${LAST_ORG_COOKIE}=; path=/; max-age=0; samesite=lax`
}
