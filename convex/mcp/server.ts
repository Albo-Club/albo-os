/**
 * Remote MCP server (Streamable HTTP, stateless) exposing the read-only tool
 * registry (convex/mcp/registry.ts) to external MCP clients — primarily the
 * claude.ai custom connector.
 *
 * Transport: hand-rolled JSON-RPC over POST. The official MCP SDK transports
 * are Node-only and Convex httpActions run in the Convex V8 runtime, so we
 * implement the (tiny) stateless surface ourselves: single JSON object
 * responses, no SSE stream, no session id — all spec-compliant (2025-06-18).
 * GET/DELETE answer 405.
 *
 * Auth: OAuth bearer tokens issued by the Better Auth `mcp` plugin
 * (convex/auth.ts), validated per request via `getMcpSession`. A missing or
 * invalid token gets 401 + `WWW-Authenticate` pointing at the protected
 * resource metadata — that is what triggers the client's OAuth flow
 * (RFC 9728). A static dev token (MCP_DEV_TOKEN + MCP_DEV_EMAIL env vars)
 * allows curl/Inspector testing without OAuth; keep both unset in prod.
 */

import { ConvexError } from 'convex/values'
import { z } from 'zod'

import { httpAction } from '../_generated/server'
import { internal } from '../_generated/api'
import { authComponent, createAuth } from '../auth'
import { consumeLimit } from '../rateLimiters'
import { mcpTools } from './registry'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { McpTool } from './registry'

// Newest first: initialize falls back to the first entry when the client
// requests a version we do not know.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']

const SERVER_INSTRUCTIONS =
  'Read-only access to Albo OS portfolio data (family office CALTE + Albo ' +
  'Club). Monetary amounts are integers in EUR CENTS (100000 = 1 000 €). ' +
  'Rates are in BASIS POINTS (1100 = 11%). Dates are ISO strings or ms ' +
  'epoch. One investment vehicle = one organization: pass the `org` slug ' +
  'to every tool.'

// Permissive CORS so browser-based clients (MCP Inspector) can connect; the
// endpoint is bearer-only, no ambient cookie auth, so this is safe.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

/** Constant-time string comparison (same pattern as convex/telegram.ts). */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const ba = new Uint8Array(da)
  const bb = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}

/**
 * Maps the request's bearer token to an app user id, or null. OAuth tokens
 * resolve through Better Auth, then to our `users` row by betterAuthId with
 * an email fallback (CLAUDE.md dedup rule).
 */
async function resolveActor(
  ctx: ActionCtx,
  request: Request,
): Promise<Id<'users'> | null> {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const devToken = process.env.MCP_DEV_TOKEN
  const devEmail = process.env.MCP_DEV_EMAIL
  if (devToken && devEmail && (await constantTimeEqual(token, devToken))) {
    return await ctx.runQuery(internal.mcp.queries.resolveActor, {
      email: devEmail,
    })
  }

  try {
    const session = await createAuth(ctx).api.getMcpSession({
      headers: request.headers,
    })
    if (!session) return null
    const baUser = await authComponent.getAnyUserById(ctx, session.userId)
    return await ctx.runQuery(internal.mcp.queries.resolveActor, {
      betterAuthId: session.userId,
      email: baUser?.email,
    })
  } catch (err) {
    console.error('[mcp] token validation failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function unauthorized(): Response {
  const metadataUrl = `${process.env.CONVEX_SITE_URL}/.well-known/oauth-protected-resource`
  return new Response(null, {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
    },
  })
}

type RpcId = string | number

function rpcResult(id: RpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(
  id: RpcId | null,
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

/** Tool failures stay in-band (`isError`), per the MCP tools spec. */
function toolErrorResult(text: string): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError: true }
}

function toolErrorText(err: unknown): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data
    return typeof data === 'string' ? data : JSON.stringify(data)
  }
  // Convex argument validation (bad id strings…) and anything unexpected:
  // log server-side, return an opaque code — never leak stack traces.
  console.error('[mcp] tool execution failed', {
    message: err instanceof Error ? err.message : String(err),
  })
  return 'tool_error'
}

function toolJsonSchema(tool: McpTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>
  delete schema.$schema
  return schema
}

type OrgInfo = { slug: string; name: string; role: string }

/** The caller's orgs — injected into schemas/instructions at discovery time. */
async function orgsForActor(
  ctx: ActionCtx,
  actorUserId: Id<'users'>,
): Promise<Array<OrgInfo>> {
  const orgs: Array<OrgInfo> = await ctx.runQuery(
    internal.mcp.queries.listOrgsForUser,
    { actorUserId },
  )
  return orgs
}

function describeOrgs(orgs: Array<OrgInfo>): string {
  return orgs.map((org) => `"${org.slug}" (${org.name})`).join(', ')
}

/**
 * Same as toolJsonSchema, but pins the `org` parameter to the caller's
 * actual org slugs (enum). claude.ai loads only a subset of tools per
 * conversation, so listOrgs may be absent — every tool must be
 * self-sufficient or the model guesses (wrong) slugs. Authorization does
 * NOT rely on this: membership is re-checked server-side on every call.
 */
function orgAwareSchema(
  tool: McpTool,
  orgs: Array<OrgInfo>,
): Record<string, unknown> {
  const schema = toolJsonSchema(tool)
  const properties = schema.properties as
    | Record<string, unknown>
    | undefined
  if (properties?.org && orgs.length > 0) {
    properties.org = {
      type: 'string',
      enum: orgs.map((org) => org.slug),
      description: `Organization slug. Your organizations: ${describeOrgs(orgs)}.`,
    }
  }
  return schema
}

export const mcpEndpoint = httpAction(async (ctx, request) => {
  // Absent on initialize and from older clients (spec: assume 2025-03-26).
  const version = request.headers.get('Mcp-Protocol-Version')
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return jsonResponse(
      rpcError(null, -32600, `Unsupported protocol version: ${version}`),
      400,
    )
  }

  const actorUserId = await resolveActor(ctx, request)
  if (!actorUserId) return unauthorized()

  let message: unknown
  try {
    message = await request.json()
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400)
  }
  // JSON-RPC batching was removed in protocol 2025-06-18.
  if (Array.isArray(message) || typeof message !== 'object' || !message) {
    return jsonResponse(rpcError(null, -32600, 'Invalid request'), 400)
  }

  const { id, method, params } = message as {
    id?: RpcId | null
    method?: string
    params?: Record<string, unknown>
  }

  // Notifications (no id) and client responses (no method) only get an ack.
  if (typeof method !== 'string' || id === undefined || id === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion
      const protocolVersion =
        typeof requested === 'string' &&
        SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0]
      const orgs = await orgsForActor(ctx, actorUserId)
      const instructions =
        orgs.length > 0
          ? `${SERVER_INSTRUCTIONS} Your organizations: ${describeOrgs(orgs)}.`
          : SERVER_INSTRUCTIONS
      return jsonResponse(
        rpcResult(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'albo-os', title: 'Albo OS', version: '1.0.0' },
          instructions,
        }),
      )
    }
    case 'ping':
      return jsonResponse(rpcResult(id, {}))
    case 'tools/list': {
      const orgs = await orgsForActor(ctx, actorUserId)
      return jsonResponse(
        rpcResult(id, {
          tools: mcpTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: orgAwareSchema(tool, orgs),
          })),
        }),
      )
    }
    case 'tools/call': {
      const name = params?.name
      const tool = mcpTools.find((t) => t.name === name)
      if (!tool) {
        return jsonResponse(
          rpcError(id, -32602, `Unknown tool: ${String(name)}`),
        )
      }
      const parsed = tool.inputSchema.safeParse(params?.arguments ?? {})
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        return jsonResponse(
          rpcResult(id, toolErrorResult(`Invalid arguments — ${issues}`)),
        )
      }
      try {
        await consumeLimit(ctx, 'mcpToolCall', actorUserId)
        const result = await tool.run(ctx, actorUserId, parsed.data)
        return jsonResponse(
          rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          }),
        )
      } catch (err) {
        return jsonResponse(rpcResult(id, toolErrorResult(toolErrorText(err))))
      }
    }
    default:
      return jsonResponse(rpcError(id, -32601, `Method not found: ${method}`))
  }
})

/** The server offers no SSE stream and no session: GET/DELETE are 405. */
export const mcpMethodNotAllowed = httpAction(() =>
  Promise.resolve(
    new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' },
    }),
  ),
)

/** CORS preflight for browser-based MCP clients (Inspector). */
export const mcpOptions = httpAction(() =>
  Promise.resolve(new Response(null, { status: 204, headers: CORS_HEADERS })),
)

/**
 * RFC 9728 protected resource metadata, served on the resource host
 * (convex.site). Points OAuth discovery at the app domain, where the Better
 * Auth `mcp` plugin endpoints ride the existing /api/auth/* proxy.
 */
export const protectedResourceMetadata = httpAction(() => {
  const siteUrl = process.env.SITE_URL
  if (!siteUrl) throw new ConvexError('missing_site_url')
  return Promise.resolve(
    Response.json(
      {
        resource: `${process.env.CONVEX_SITE_URL}/mcp`,
        authorization_servers: [siteUrl],
        bearer_methods_supported: ['header'],
      },
      { headers: CORS_HEADERS },
    ),
  )
})
