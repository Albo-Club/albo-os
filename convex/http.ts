import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'
import { streamOverHttp } from './chat'
import {
  mcpEndpoint,
  mcpMethodNotAllowed,
  mcpOptions,
  protectedResourceMetadata,
} from './mcp/server'
import { powensWebhook } from './powens'
import { telegramWebhook } from './telegram'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)

http.route({
  path: '/api/chat',
  method: 'POST',
  handler: streamOverHttp,
})

// Powens webhook (CONNECTION_SYNCED) — HMAC signature verified in the handler.
// The path must match the URL configured on the Powens side (cf. WEBHOOK_PATH).
http.route({
  path: '/powens/webhook',
  method: 'POST',
  handler: powensWebhook,
})

// Telegram bot webhook — secret token (set at setWebhook time) verified in
// the handler. The path must match the URL passed to setWebhook (cf. README
// « Bot Telegram »).
http.route({
  path: '/telegram/webhook',
  method: 'POST',
  handler: telegramWebhook,
})

// Remote MCP server (claude.ai custom connector) — OAuth bearer verified in
// the handler. Stateless Streamable HTTP: POST only, GET/DELETE answer 405.
http.route({ path: '/mcp', method: 'POST', handler: mcpEndpoint })
http.route({ path: '/mcp', method: 'GET', handler: mcpMethodNotAllowed })
http.route({ path: '/mcp', method: 'DELETE', handler: mcpMethodNotAllowed })
http.route({ path: '/mcp', method: 'OPTIONS', handler: mcpOptions })

// RFC 9728 discovery for the MCP resource — both the root form and the
// path-suffix variant some clients probe.
http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'GET',
  handler: protectedResourceMetadata,
})
http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  handler: protectedResourceMetadata,
})

export default http
