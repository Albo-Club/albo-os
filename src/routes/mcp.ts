import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Canonical MCP endpoint on the app domain. The JSON-RPC server itself lives
 * in convex/mcp/server.ts and runs on convex.site; this route is a thin
 * reverse proxy so the connector URL a user pastes into claude.ai is
 * `https://os.alboteam.com/mcp` — same origin as the OAuth authorization
 * server, and derivable in the UI from `window.location.origin`.
 *
 * Everything is passed through verbatim except two headers:
 *  - `WWW-Authenticate` is rewritten to point at *this* domain's RFC 9728
 *    document, so the advertised `resource` matches the URL the client is
 *    actually talking to. Convex keeps advertising convex.site for a
 *    connector registered against the old URL — hence the rewrite here
 *    rather than a change over there.
 *  - `Cache-Control: no-store`, because Vercel honours upstream cache
 *    headers on proxied responses and a cached 405 or tool result would be
 *    a nasty surprise.
 */
const CONVEX_SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL

// Host / Cookie / Accept-Encoding / Content-Length are dropped on purpose:
// the endpoint is bearer-only (no ambient cookie auth, a deliberate security
// property) and fetch recomputes the framing headers.
const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
  'mcp-session-id',
  'user-agent',
]

// Hop-by-hop, plus the ones undici already consumed decoding the body.
const SKIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

// `new Response(body, { status })` throws on these even for an empty string,
// and the upstream answers 204 on OPTIONS.
const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
} as const

function challenge(request: Request): string {
  const origin = new URL(request.url).origin
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
}

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        if (!CONVEX_SITE_URL) {
          console.error('[mcp-proxy] VITE_CONVEX_SITE_URL is not set')
          return new Response('mcp_upstream_not_configured', { status: 500 })
        }

        const method = request.method.toUpperCase()

        // Anonymous probes get the same answer the upstream would give,
        // without spending a round trip on them.
        if (method === 'POST' && !request.headers.get('authorization')) {
          return new Response(null, {
            status: 401,
            headers: {
              ...CORS_HEADERS,
              'WWW-Authenticate': challenge(request),
            },
          })
        }

        const headers = new Headers()
        for (const name of FORWARDED_REQUEST_HEADERS) {
          const value = request.headers.get(name)
          if (value) headers.set(name, value)
        }

        // Buffer the body first: a streaming request body (`duplex: 'half'`)
        // throws on Vercel's Node runtime — same gotcha as the Better Auth
        // proxy, see src/routes/api/auth/$.ts.
        let body: ArrayBuffer | undefined
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          const buffered = await request.arrayBuffer()
          if (buffered.byteLength > 0) body = buffered
        }

        const upstream = await fetch(`${CONVEX_SITE_URL}/mcp`, {
          method,
          headers,
          body,
          redirect: 'manual',
        })

        const out = new Headers()
        upstream.headers.forEach((value, key) => {
          if (!SKIPPED_RESPONSE_HEADERS.has(key)) out.set(key, value)
        })
        if (out.has('www-authenticate')) {
          out.set('www-authenticate', challenge(request))
        }
        out.set('cache-control', 'no-store')

        const payload = NULL_BODY_STATUS.has(upstream.status)
          ? null
          : await upstream.arrayBuffer()

        return new Response(payload, { status: upstream.status, headers: out })
      },
    },
  },
})
