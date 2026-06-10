import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

const LAST_ORG_COOKIE = 'last_org_slug'
const ONE_YEAR = 60 * 60 * 24 * 365

// Le cookie sert de cible de redirection (`/app/$orgSlug`) : on borne son
// contenu à un slug plausible avant de s'en servir.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function sanitize(value: string | null | undefined): string | null {
  return value && SLUG_RE.test(value) ? value : null
}

/**
 * Dernière org visitée sur CE navigateur, lue isomorphiquement (cookie, même
 * pattern que `getLocale`). Fast-path de la redirection `/app` →
 * `/app/$orgSlug` : côté serveur la requête document est redirigée avant tout
 * rendu, côté client on n'attend ni l'auth Convex ni `users.me` juste pour
 * retrouver le slug. La source de vérité cross-device reste
 * `users.lastOrgSlug` (mutation `setLastOrg`) — le cookie n'est qu'un
 * raccourci device-local, re-validé par le layout d'org (non-membre →
 * `clearLastOrgCookie()` puis retour `/app`, sinon boucle de redirection).
 */
export const getLastOrgSlugCookie = createIsomorphicFn()
  .server((): string | null => sanitize(getCookie(LAST_ORG_COOKIE)))
  .client((): string | null => {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${LAST_ORG_COOKIE}=([^;]*)`),
    )
    return sanitize(match ? decodeURIComponent(match[1]) : null)
  })

/** Persiste la dernière org visitée (écrit par le layout d'org, client). */
export function writeLastOrgCookie(slug: string): void {
  document.cookie = `${LAST_ORG_COOKIE}=${slug}; path=/; max-age=${ONE_YEAR}; samesite=lax`
}

/** Efface le cookie — obligatoire AVANT de renvoyer un non-membre sur /app. */
export function clearLastOrgCookie(): void {
  document.cookie = `${LAST_ORG_COOKIE}=; path=/; max-age=0; samesite=lax`
}
