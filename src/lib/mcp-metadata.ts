/**
 * RFC 9728 protected resource metadata for the MCP endpoint served on the
 * app domain (`/mcp`, see src/routes/mcp.ts).
 *
 * The canonical MCP resource is the *app* domain: a client connects to
 * https://os.alboteam.com/mcp, so `resource` must be that URL — not the
 * convex.site origin that actually runs the JSON-RPC handler. The origin is
 * read from the request so preview deployments and localhost describe
 * themselves correctly.
 *
 * Convex serves its own copy of this document (convex/mcp/server.ts) that
 * still advertises convex.site; the two coexist on purpose so a connector
 * registered against the old URL keeps working.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const

export function protectedResourceMetadata(request: Request): Response {
  const origin = new URL(request.url).origin
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
    },
    { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' } },
  )
}

export function protectedResourceOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
