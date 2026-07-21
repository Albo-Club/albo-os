/**
 * Server-side Better Auth bridge (TanStack Start integration of
 * @convex-dev/better-auth). Shared by the /api/auth proxy route and the
 * root route's SSR session preload — import it only from server code
 * (route handlers, createServerFn handlers).
 */
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

export const { handler, getToken } = convexBetterAuthReactStart({
  convexUrl: import.meta.env.VITE_CONVEX_URL,
  convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
})
