import { httpRouter } from 'convex/server'
import { attioWebhook } from './attioSync'
import { authComponent, createAuth } from './auth'
import { streamOverHttp } from './chat'
import {
  mcpEndpoint,
  mcpMethodNotAllowed,
  mcpOptions,
  protectedResourceMetadata,
} from './mcp/server'
import { powensWebhook } from './powens'
import { reportsIngest, reportsUploadUrl } from './reports'
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

// Attio webhook (deals stage change) — HMAC-SHA256 (hex) signature over the
// raw body verified in the handler (header `Attio-Signature`). The handler
// re-fetches the record and filters server-side on stage. Cf. convex/attioSync.ts.
http.route({
  path: '/attio/webhook',
  method: 'POST',
  handler: attioWebhook,
})

// Telegram bot webhook — secret token (set at setWebhook time) verified in
// the handler. The path must match the URL passed to setWebhook (cf. README
// « Bot Telegram »).
http.route({
  path: '/telegram/webhook',
  method: 'POST',
  handler: telegramWebhook,
})

// Reporting ingestion (the external pipeline pushes parsed portfolio
// reports) — HMAC-SHA256 (hex) over `${X-Albo-Timestamp}.${rawBody}`
// verified in the handlers. `/reports/upload-url` hands out a Convex storage
// upload URL; `/reports/ingest` stores the report envelope + metrics.
// Cf. convex/reports.ts.
http.route({
  path: '/reports/upload-url',
  method: 'POST',
  handler: reportsUploadUrl,
})
http.route({
  path: '/reports/ingest',
  method: 'POST',
  handler: reportsIngest,
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
