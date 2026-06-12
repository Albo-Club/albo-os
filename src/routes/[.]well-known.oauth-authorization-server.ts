import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'

/**
 * RFC 8414 authorization server metadata at the issuer root. The Better Auth
 * `mcp` plugin serves it under the auth basePath
 * (/api/auth/.well-known/oauth-authorization-server) but OAuth clients
 * (claude.ai connector) derive the URL from the issuer (= SITE_URL) with no
 * path component — so we re-expose it here by proxying the Convex route.
 */
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: async () => {
        const upstream = `${import.meta.env.VITE_CONVEX_SITE_URL}/api/auth/.well-known/oauth-authorization-server`
        const res = await fetch(upstream)
        const body = await res.text()
        return new Response(body, {
          status: res.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        })
      },
    },
  },
})
