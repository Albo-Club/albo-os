import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'
import { streamOverHttp } from './chat'
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

export default http
