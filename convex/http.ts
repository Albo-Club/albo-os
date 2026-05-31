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

// Webhook Powens (CONNECTION_SYNCED) — signature HMAC vérifiée dans le handler.
// Le chemin doit matcher l'URL configurée chez Powens (cf. WEBHOOK_PATH).
http.route({
  path: '/powens/webhook',
  method: 'POST',
  handler: powensWebhook,
})

export default http
