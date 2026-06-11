import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'
import { streamOverHttp } from './chat'
import { powensWebhook } from './powens'

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

export default http
