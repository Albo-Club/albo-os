import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'
import { streamOverHttp } from './chat'
import { accountsWebhook, transactionsWebhook } from './powens'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)

http.route({
  path: '/api/chat',
  method: 'POST',
  handler: streamOverHttp,
})

// Powens → n8n → Convex bank-data ingestion (HMAC-signed, see convex/powens.ts).
http.route({
  path: '/api/powens/accounts',
  method: 'POST',
  handler: accountsWebhook,
})
http.route({
  path: '/api/powens/transactions',
  method: 'POST',
  handler: transactionsWebhook,
})

export default http
